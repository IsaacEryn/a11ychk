import {
  AXE_RUN_TAGS,
  aggregateScan,
  customFindingsFromSignals,
  getManualCheckItems,
  getRuleEntry,
  normalizeAxeResults,
  type AxeRunResults,
  type Impact,
  type PageCheckSignals,
} from "@a11ychk/core/catalog";

// 빌드 시 esbuild define으로 치환됨
declare const process: { env: { A11YCHK_SITE_ORIGIN: string; A11YCHK_AXE_VERSION: string } };
const SITE_ORIGIN = process.env.A11YCHK_SITE_ORIGIN;
const AXE_VERSION = process.env.A11YCHK_AXE_VERSION;

interface StoredSession {
  accessToken: string;
  expiresAt: number;
  email?: string;
}

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

async function getActiveTab(): Promise<chrome.tabs.Tab | undefined> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function getSession(): Promise<StoredSession | null> {
  const { a11ychk_session } = await chrome.storage.local.get("a11ychk_session");
  const s = a11ychk_session as StoredSession | undefined;
  if (s && s.accessToken && s.expiresAt > Date.now()) return s;
  return null;
}

/** 비로그인 일일 무료 검사 횟수 (로컬 집계 — 가입 유도) */
const ANON_DAILY_LIMIT = 3;

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

async function getAnonUsage(): Promise<number> {
  const { anon_usage } = await chrome.storage.local.get("anon_usage");
  const u = anon_usage as { day: string; count: number } | undefined;
  return u && u.day === todayKey() ? u.count : 0;
}

async function bumpAnonUsage(): Promise<number> {
  const next = (await getAnonUsage()) + 1;
  await chrome.storage.local.set({ anon_usage: { day: todayKey(), count: next } });
  return next;
}

/** 사용량 안내/가입 유도 문구 갱신 */
function setUsageNote(html: { text: string; cta?: boolean; err?: boolean }) {
  const el = $("usage");
  el.innerHTML = "";
  const span = document.createElement("span");
  if (html.err) span.className = "err";
  span.textContent = html.text;
  el.appendChild(span);
  if (html.cta) {
    el.appendChild(document.createTextNode(" "));
    const a = document.createElement("a");
    a.href = `${SITE_ORIGIN}/ko/login`;
    a.target = "_blank";
    a.rel = "noopener";
    a.textContent = "무료 가입하기 →";
    el.appendChild(a);
  }
}

const IMPACTS: Impact[] = ["critical", "serious", "moderate", "minor"];
const IMPACT_LABEL: Record<Impact, string> = {
  critical: "치명적",
  serious: "심각",
  moderate: "보통",
  minor: "경미",
};

/** MAIN world에서 axe 실행 — 단순 표현식이라 번들러 헬퍼 오염 위험 없음 */
function runAxeInPage(tags: string[]): Promise<AxeRunResults> {
  // @ts-expect-error axe는 vendor 스크립트로 주입됨
  return window.axe.run(document, {
    runOnly: { type: "tag", values: tags },
    resultTypes: ["violations", "passes", "incomplete"],
  });
}

/**
 * 자체 커스텀 검사 신호 수집 (ISOLATED world에서 실행).
 * ⚠️ 서버 스캐너의 BASE_SCRIPT(packages/core/src/scanner/customChecks.ts)와
 * 동일한 신호를 수집해야 한다 — 판정은 공용 customFindingsFromSignals가 담당.
 * 자기 완결 함수여야 함 (chrome.scripting이 함수 소스를 직렬화해 주입).
 */
function collectPageSignals(): PageCheckSignals {
  const res: PageCheckSignals = {
    inlineClickNonInteractive: [], focusSampled: 0, focusNoOutline: 0, focusExamples: [],
    hasMedia: false, altSampled: 0, altFilename: [], altGeneric: [], autoplay: [], genericLinks: 0,
    smallTargets: [], targetSampled: 0,
  };
  function cssPath(el: Element): string {
    try {
      if (el.id) return "#" + el.id;
      const parts: string[] = [];
      let cur: Element | null = el;
      let depth = 0;
      while (cur && cur.nodeType === 1 && depth < 4) {
        let sel = cur.tagName.toLowerCase();
        const cn = cur.getAttribute("class");
        if (cn) { const c = cn.trim().split(/\s+/)[0]; if (c) sel += "." + c; }
        parts.unshift(sel);
        cur = cur.parentElement;
        depth++;
      }
      return parts.join(" > ");
    } catch { return el.tagName ? el.tagName.toLowerCase() : "?"; }
  }
  try { res.hasMedia = !!document.querySelector("video, audio"); } catch { /* 무시 */ }
  try {
    // 1.1.1 — alt가 파일명(F30) 또는 의미 없는 일반어인 이미지
    const FILE = /\.(jpe?g|png|gif|webp|svg|bmp|ico|tiff?)\s*$/i;
    const GENERIC_ALT = /^(이미지|사진|그림|아이콘|배너|image|img|photo|picture|graphic|icon|banner|untitled|spacer|\*|-)$/i;
    const imgs = document.querySelectorAll("img[alt]");
    for (let ia = 0; ia < imgs.length; ia++) {
      const img = imgs[ia];
      if (!img) continue;
      const alt = (img.getAttribute("alt") || "").trim();
      if (!alt) continue;
      res.altSampled++;
      if (FILE.test(alt) && res.altFilename.length < 8)
        res.altFilename.push({ selector: cssPath(img), html: img.outerHTML.slice(0, 300), alt });
      else if (GENERIC_ALT.test(alt) && res.altGeneric.length < 8)
        res.altGeneric.push({ selector: cssPath(img), html: img.outerHTML.slice(0, 300), alt });
    }
  } catch { /* 무시 */ }
  try {
    // 1.4.2 — 음소거 없이 자동 재생되는 미디어
    const med = document.querySelectorAll<HTMLMediaElement>("video[autoplay], audio[autoplay]");
    for (let m = 0; m < med.length && res.autoplay.length < 4; m++) {
      const mediaEl = med[m];
      if (!mediaEl || mediaEl.hasAttribute("muted") || mediaEl.muted) continue;
      res.autoplay.push({ selector: cssPath(mediaEl), html: mediaEl.outerHTML.slice(0, 300) });
    }
  } catch { /* 무시 */ }
  try {
    // 2.4.4 — 목적을 알기 어려운 일반어 링크 텍스트
    const GENERIC_LINK = /^(여기|여기를?\s*클릭|클릭(하세요)?|더\s*보기|더보기|자세히(\s*보기)?|바로\s*가기|바로가기|here|click\s*here|click|more|read\s*more|learn\s*more|go|link)$/i;
    const as2 = document.querySelectorAll("a[href]");
    for (let l = 0; l < as2.length; l++) {
      const t2 = (as2[l]?.textContent || "").replace(/\s+/g, " ").trim();
      if (t2 && GENERIC_LINK.test(t2)) res.genericLinks++;
    }
  } catch { /* 무시 */ }
  try {
    // 2.5.8 — 24×24px 미만 타깃 (인라인 링크 예외)
    const targets = document.querySelectorAll("a[href], button, input:not([type=hidden]), [role=button]");
    const limit2 = Math.min(targets.length, 60);
    for (let s = 0; s < limit2; s++) {
      const el2 = targets[s];
      if (!el2) continue;
      const st = getComputedStyle(el2);
      if (st.display === "inline") continue;
      const r = el2.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) continue;
      res.targetSampled++;
      if ((r.width < 24 || r.height < 24) && res.smallTargets.length < 6) {
        res.smallTargets.push({
          selector: cssPath(el2),
          html: el2.outerHTML.slice(0, 200),
          size: Math.round(r.width) + "×" + Math.round(r.height),
        });
      }
    }
  } catch { /* 무시 */ }
  try {
    // 2.1.1 — 인라인 onclick이 붙은 비대화형·비초점 요소
    const NATIVE = /^(A|BUTTON|INPUT|SELECT|TEXTAREA|SUMMARY)$/;
    const INTERACTIVE_ROLE = /^(button|link|checkbox|menuitem|menuitemcheckbox|menuitemradio|tab|switch|radio|option|slider|spinbutton|textbox)$/;
    const clickers = document.querySelectorAll("[onclick]");
    for (let i = 0; i < clickers.length && res.inlineClickNonInteractive.length < 8; i++) {
      const el = clickers[i];
      if (!el || NATIVE.test(el.tagName)) continue;
      const role = el.getAttribute("role");
      const ti = el.getAttribute("tabindex");
      if ((role && INTERACTIVE_ROLE.test(role)) || ti !== null) continue;
      res.inlineClickNonInteractive.push({ selector: cssPath(el), html: el.outerHTML.slice(0, 300) });
    }
  } catch { /* 무시 */ }
  try {
    // 2.4.7 — 초점 시 시각 변화 표본 검사 (기존 초점 복원)
    const prevFocus = document.activeElement as HTMLElement | null;
    const focusables = document.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input:not([type=hidden]):not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex^="-"])',
    );
    const limit = Math.min(focusables.length, 20);
    for (let j = 0; j < limit; j++) {
      const f = focusables[j];
      if (!f) continue;
      const b = getComputedStyle(f);
      const boBefore = b.boxShadow;
      const brBefore = b.borderColor;
      const bgBefore = b.backgroundColor;
      try { f.focus({ preventScroll: true }); } catch { continue; }
      if (document.activeElement !== f) continue;
      res.focusSampled++;
      const a = getComputedStyle(f);
      const outlineVisible = a.outlineStyle !== "none" && a.outlineWidth !== "0px";
      const boxShadowChanged = a.boxShadow !== boBefore && a.boxShadow !== "none";
      const borderChanged = a.borderColor !== brBefore;
      const bgChanged = a.backgroundColor !== bgBefore;
      if (!outlineVisible && !boxShadowChanged && !borderChanged && !bgChanged) {
        res.focusNoOutline++;
        if (res.focusExamples.length < 5) res.focusExamples.push({ selector: cssPath(f), html: f.outerHTML.slice(0, 200) });
      }
    }
    try { (prevFocus ?? document.body)?.focus?.({ preventScroll: true }); } catch { /* 무시 */ }
  } catch { /* 무시 */ }
  return res;
}

/** 페이지에서 해당 요소를 강조 표시 (스크롤 + 3초 outline) */
function highlightInPage(selector: string): boolean {
  const el = document.querySelector<HTMLElement>(selector);
  if (!el) return false;
  el.scrollIntoView({ behavior: "smooth", block: "center" });
  const prevOutline = el.style.outline;
  const prevOffset = el.style.outlineOffset;
  el.style.outline = "3px solid #e0533d";
  el.style.outlineOffset = "2px";
  setTimeout(() => {
    el.style.outline = prevOutline;
    el.style.outlineOffset = prevOffset;
  }, 3000);
  return true;
}

// ─── 페이지 주입 시각 도구 (모두 자기 완결 — chrome.scripting이 소스를 직렬화) ───

/** 오버레이 컨테이너·시뮬레이션·선형화 스타일을 모두 제거 */
function clearOverlayInPage(): void {
  document.getElementById("a11ychk-overlay")?.remove();
  document.getElementById("a11ychk-sim-style")?.remove();
  document.getElementById("a11ychk-sim-svg")?.remove();
  document.getElementById("a11ychk-linearize")?.remove();
}

/** 위반/구조 마커를 그린다. 기존 오버레이는 지우고 새로 그림 */
function overlayMarkersInPage(markers: { selector: string; color: string; label: string }[]): number {
  document.getElementById("a11ychk-overlay")?.remove();
  const c = document.createElement("div");
  c.id = "a11ychk-overlay";
  c.style.cssText = "all:initial;position:absolute;top:0;left:0;width:0;height:0;z-index:2147483646;pointer-events:none;";
  let drawn = 0;
  for (const m of markers) {
    let el: Element | null = null;
    try {
      el = document.querySelector(m.selector);
    } catch {
      el = null;
    }
    if (!el) continue;
    const r = el.getBoundingClientRect();
    if (r.width <= 0 && r.height <= 0) continue;
    drawn++;
    const box = document.createElement("div");
    box.style.cssText =
      "all:initial;position:absolute;box-sizing:border-box;pointer-events:none;" +
      `border:2px solid ${m.color};` +
      `left:${r.left + window.scrollX}px;top:${r.top + window.scrollY}px;` +
      `width:${Math.max(r.width, 8)}px;height:${Math.max(r.height, 8)}px;`;
    const tag = document.createElement("span");
    tag.textContent = m.label;
    tag.style.cssText =
      "all:initial;position:absolute;left:0;top:-16px;font:700 11px/16px sans-serif;" +
      `background:${m.color};color:#fff;padding:0 5px;white-space:nowrap;border-radius:2px;`;
    box.appendChild(tag);
    c.appendChild(box);
  }
  document.body.appendChild(c);
  return drawn;
}

/** 구조 시각화 (headings/landmarks/focus)를 페이지에서 계산해 마커 배열 반환 → 그리기 */
function overlayStructureInPage(kind: "headings" | "landmarks" | "focus"): number {
  document.getElementById("a11ychk-overlay")?.remove();
  const markers: { rect: DOMRect; color: string; label: string }[] = [];
  if (kind === "headings") {
    const hs = document.querySelectorAll("h1,h2,h3,h4,h5,h6,[role=heading]");
    let prev = 0;
    hs.forEach((h) => {
      const lvl = h.getAttribute("aria-level") || (/H([1-6])/.exec(h.tagName)?.[1] ?? "?");
      const n = Number(lvl);
      const skip = prev > 0 && n > prev + 1;
      markers.push({
        rect: h.getBoundingClientRect(),
        color: skip ? "#e0533d" : "#0b6b5e",
        label: `H${lvl}${skip ? " ⚠건너뜀" : ""}`,
      });
      if (!Number.isNaN(n)) prev = n;
    });
  } else if (kind === "landmarks") {
    const sel = "header,nav,main,aside,footer,form,[role=banner],[role=navigation],[role=main],[role=complementary],[role=contentinfo],[role=search],[role=region]";
    document.querySelectorAll(sel).forEach((el) => {
      const role = el.getAttribute("role") || el.tagName.toLowerCase();
      const name = el.getAttribute("aria-label") || el.getAttribute("aria-labelledby") || "";
      markers.push({ rect: el.getBoundingClientRect(), color: "#7a5cff", label: name ? `${role}: ${name}` : role });
    });
  } else {
    const focusables = document.querySelectorAll<HTMLElement>(
      'a[href],button:not([disabled]),input:not([type=hidden]):not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex^="-"])',
    );
    let i = 0;
    focusables.forEach((f) => {
      const r = f.getBoundingClientRect();
      if (r.width <= 0 && r.height <= 0) return;
      i++;
      markers.push({ rect: r, color: "#c9761b", label: String(i) });
    });
  }
  const c = document.createElement("div");
  c.id = "a11ychk-overlay";
  c.style.cssText = "all:initial;position:absolute;top:0;left:0;width:0;height:0;z-index:2147483646;pointer-events:none;";
  for (const m of markers) {
    const r = m.rect;
    const box = document.createElement("div");
    box.style.cssText =
      "all:initial;position:absolute;box-sizing:border-box;pointer-events:none;" +
      `border:2px solid ${m.color};left:${r.left + window.scrollX}px;top:${r.top + window.scrollY}px;` +
      `width:${Math.max(r.width, 8)}px;height:${Math.max(r.height, 8)}px;`;
    const tag = document.createElement("span");
    tag.textContent = m.label;
    tag.style.cssText =
      "all:initial;position:absolute;left:0;top:-16px;font:700 11px/16px sans-serif;" +
      `background:${m.color};color:#fff;padding:0 5px;white-space:nowrap;border-radius:2px;`;
    box.appendChild(tag);
    c.appendChild(box);
  }
  document.body.appendChild(c);
  return markers.length;
}

/** 장애 시뮬레이션 CSS 필터 적용 (none이면 해제) */
function applySimulationInPage(mode: string): void {
  document.getElementById("a11ychk-sim-style")?.remove();
  document.getElementById("a11ychk-sim-svg")?.remove();
  if (mode === "none") return;
  const MATRIX: Record<string, string> = {
    protanopia: "0.567 0.433 0 0 0  0.558 0.442 0 0 0  0 0.242 0.758 0 0  0 0 0 1 0",
    deuteranopia: "0.625 0.375 0 0 0  0.7 0.3 0 0 0  0 0.3 0.7 0 0  0 0 0 1 0",
    tritanopia: "0.95 0.05 0 0 0  0 0.433 0.567 0 0  0 0.475 0.525 0 0  0 0 0 1 0",
  };
  let filterValue: string;
  if (mode === "blur") filterValue = "blur(2.5px)";
  else if (mode === "grayscale") filterValue = "grayscale(1)";
  else if (MATRIX[mode]) {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.id = "a11ychk-sim-svg";
    svg.setAttribute("style", "position:absolute;width:0;height:0;");
    svg.innerHTML = `<defs><filter id="a11ychk-cb"><feColorMatrix type="matrix" values="${MATRIX[mode]}"/></filter></defs>`;
    document.body.appendChild(svg);
    filterValue = "url(#a11ychk-cb)";
  } else return;
  const style = document.createElement("style");
  style.id = "a11ychk-sim-style";
  style.textContent = `html{filter:${filterValue} !important;}`;
  document.documentElement.appendChild(style);
}

/** CSS 선형화 — DOM 읽기 순서 그대로 표시 (해제 시 스타일 제거) */
function linearizeInPage(on: boolean): void {
  document.getElementById("a11ychk-linearize")?.remove();
  if (!on) return;
  const style = document.createElement("style");
  style.id = "a11ychk-linearize";
  style.textContent =
    "*:not(html):not(head):not(script):not(style){float:none !important;position:static !important;" +
    "display:block !important;width:auto !important;max-width:100% !important;margin-left:0 !important;" +
    "margin-right:0 !important;left:auto !important;right:auto !important;transform:none !important;}";
  document.documentElement.appendChild(style);
}

/** 스포이드로 두 색을 찍어 WCAG 대비율 계산 → 페이지 내 토스트로 결과 표시 */
async function pickContrastInPage(): Promise<string> {
  const w = window as unknown as { EyeDropper?: new () => { open: () => Promise<{ sRGBHex: string }> } };
  if (!w.EyeDropper) return "unsupported";
  function lum(hex: string): number {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
    if (!m || !m[1]) return 0;
    const v = parseInt(m[1], 16);
    const ch = [(v >> 16) & 255, (v >> 8) & 255, v & 255].map((c) => {
      const s = c / 255;
      return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * (ch[0] ?? 0) + 0.7152 * (ch[1] ?? 0) + 0.0722 * (ch[2] ?? 0);
  }
  try {
    const a = await new w.EyeDropper().open();
    const b = await new w.EyeDropper().open();
    const l1 = lum(a.sRGBHex);
    const l2 = lum(b.sRGBHex);
    const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
    const r = Math.round(ratio * 100) / 100;
    const aa = ratio >= 4.5;
    const aaLarge = ratio >= 3;
    const aaa = ratio >= 7;
    const toast = document.createElement("div");
    toast.style.cssText =
      "all:initial;position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:2147483647;" +
      "background:#1a1a1a;color:#fff;font:600 14px/1.5 sans-serif;padding:12px 18px;border-radius:8px;" +
      "box-shadow:0 4px 16px rgba(0,0,0,.3);text-align:center;";
    toast.innerHTML =
      `<div style="all:initial;color:#fff;font:700 16px sans-serif">대비율 ${r} : 1</div>` +
      `<div style="all:initial;color:#fff;font:400 13px sans-serif;margin-top:4px">` +
      `${a.sRGBHex} / ${b.sRGBHex}<br>` +
      `일반 텍스트 AA ${aa ? "✓" : "✗"} · 큰 텍스트 AA ${aaLarge ? "✓" : "✗"} · AAA ${aaa ? "✓" : "✗"}</div>`;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 6000);
    return `${r}`;
  } catch {
    return "cancelled";
  }
}

async function scan() {
  const tab = await getActiveTab();
  if (!tab?.id || !tab.url || !/^https?:/.test(tab.url)) {
    $("target").innerHTML = '<span class="err">이 페이지는 검사할 수 없습니다 (http/https 페이지에서 실행하세요).</span>';
    return;
  }
  currentTabId = tab.id;
  const scanBtn = $<HTMLButtonElement>("scan");

  // ── 사용량 확인: 로그인 = 서버 확장 한도(웹 검사와 분리) / 비로그인 = 로컬 3회·가입 유도 ──
  const session = await getSession();
  if (session) {
    try {
      const res = await fetch(`${SITE_ORIGIN}/api/extension/usage`, {
        method: "POST",
        headers: { Authorization: `Bearer ${session.accessToken}` },
      });
      const data = (await res.json()) as { ok?: boolean; used?: number; limit?: number; error?: string };
      if (res.status === 429) {
        setUsageNote({ text: data.error ?? "오늘의 확장 검사 한도를 모두 사용했습니다.", err: true });
        return;
      }
      if (res.ok && data.used != null && data.limit != null) {
        setUsageNote({ text: `오늘 확장 검사 ${data.used}/${data.limit}회 사용` });
      }
    } catch {
      // 네트워크 오류 — 검사는 로컬 실행이므로 차단하지 않음
    }
  } else {
    const used = await getAnonUsage();
    if (used >= ANON_DAILY_LIMIT) {
      setUsageNote({
        text: `오늘 무료 검사 ${ANON_DAILY_LIMIT}회를 모두 사용했습니다. 가입하면 하루 30회 검사와 보고서 저장·관리가 가능합니다.`,
        cta: true,
        err: true,
      });
      return;
    }
  }

  scanBtn.disabled = true;
  scanBtn.textContent = "검사 중…";
  try {
    // 1) axe 라이브러리 주입 (MAIN world)
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      world: "MAIN",
      files: ["vendor/axe.min.js"],
    });
    // 2) axe 실행
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      world: "MAIN",
      args: [AXE_RUN_TAGS],
      func: runAxeInPage,
    });
    const raw = results[0]?.result as AxeRunResults | undefined;
    if (!raw) throw new Error("검사 결과를 가져오지 못했습니다.");
    const page = normalizeAxeResults(tab.url, raw);

    // 3) 자체 커스텀 검사 (서버 스캐너와 동일 규칙 — 리플로우 제외)
    try {
      const signalResults = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: collectPageSignals,
      });
      const signals = signalResults[0]?.result as PageCheckSignals | undefined;
      if (signals) {
        const custom = customFindingsFromSignals(signals);
        page.violations.push(...custom.violations);
        page.passes.push(...custom.passes);
        page.incomplete.push(...custom.incomplete);
      }
    } catch {
      // 커스텀 검사 실패 — axe 결과만으로 진행
    }

    const summary = aggregateScan([page], AXE_VERSION);
    renderResult(page, summary, tab.url);

    // 비로그인: 로컬 사용량 증가 + 가입 유도
    if (!session) {
      const used = await bumpAnonUsage();
      setUsageNote({
        text: `오늘 무료 검사 ${used}/${ANON_DAILY_LIMIT}회 사용 · 가입하면 하루 30회 + 보고서 저장·사이트 단위 관리.`,
        cta: true,
      });
    }
  } catch (e) {
    $("target").innerHTML = `<span class="err">검사에 실패했습니다: ${(e as Error).message}</span>`;
  } finally {
    scanBtn.disabled = false;
    scanBtn.textContent = "다시 검사";
  }
}

let lastPage: ReturnType<typeof normalizeAxeResults> | null = null;
let currentTabId: number | null = null;

function renderResult(
  page: ReturnType<typeof normalizeAxeResults>,
  summary: ReturnType<typeof aggregateScan>,
  url: string,
) {
  lastPage = page;
  $("result").hidden = false;
  $("rate").textContent = String(summary.complianceRate);

  const impact = $("impact");
  impact.innerHTML = "";
  for (const key of IMPACTS) {
    const li = document.createElement("li");
    const label = document.createElement("span");
    label.textContent = IMPACT_LABEL[key];
    const val = document.createElement("b");
    val.textContent = String(summary.byImpact[key]);
    li.append(label, val);
    impact.appendChild(li);
  }

  const list = $("violations");
  list.innerHTML = "";
  const byRule = new Map<string, number>();
  for (const v of page.violations) byRule.set(v.ruleId, v.nodes.length);
  const sorted = [...page.violations].sort(
    (a, b) => IMPACTS.indexOf(a.impact) - IMPACTS.indexOf(b.impact),
  );
  if (sorted.length === 0) {
    const li = document.createElement("li");
    li.textContent = "자동 검사에서 위반이 발견되지 않았습니다. 수동 점검을 진행하세요.";
    li.style.borderColor = "var(--seal)";
    list.appendChild(li);
  }
  const tabId = currentTabId;
  for (const v of sorted) {
    const entry = getRuleEntry(v.ruleId, v.tags);
    const li = document.createElement("li");
    const title = document.createElement("p");
    title.className = "vt";
    const badge = document.createElement("span");
    badge.className = "badge";
    badge.textContent = IMPACT_LABEL[v.impact];
    title.append(badge, document.createTextNode(entry.title.ko));
    const meta = document.createElement("p");
    meta.className = "vmeta";
    meta.textContent =
      `${v.nodes.length}개 요소` +
      (entry.wcag.length ? ` · WCAG ${entry.wcag.join(", ")}` : "") +
      (entry.kwcag.length ? ` · KWCAG ${entry.kwcag.join(", ")}` : "");
    li.append(title, meta);

    // 위반 요소 목록 (최대 3) — "표시" 버튼으로 페이지에서 강조
    const nodesUl = document.createElement("ul");
    nodesUl.className = "vnodes";
    for (const node of v.nodes.slice(0, 3)) {
      const nli = document.createElement("li");
      const sel = document.createElement("code");
      sel.textContent = node.selector;
      sel.title = node.html;
      nli.appendChild(sel);
      if (tabId) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "locate";
        btn.textContent = "표시";
        btn.setAttribute("aria-label", `${node.selector} 요소를 페이지에서 표시`);
        btn.addEventListener("click", async () => {
          try {
            const r = await chrome.scripting.executeScript({
              target: { tabId },
              args: [node.selector],
              func: highlightInPage,
            });
            btn.textContent = r[0]?.result ? "표시됨 ✓" : "못 찾음";
          } catch {
            btn.textContent = "실패";
          }
          setTimeout(() => (btn.textContent = "표시"), 2500);
        });
        nli.appendChild(btn);
      }
      nodesUl.appendChild(nli);
    }
    if (v.nodes.length > 3) {
      const more = document.createElement("li");
      more.className = "vmore";
      more.textContent = `외 ${v.nodes.length - 3}개 요소`;
      nodesUl.appendChild(more);
    }
    li.appendChild(nodesUl);

    // 개선 가이드 (첫 단락) — 접기형
    const guideFirst = entry.guide.ko.split("\n\n")[0]?.trim();
    if (guideFirst) {
      const details = document.createElement("details");
      details.className = "vguide";
      const summaryEl = document.createElement("summary");
      summaryEl.textContent = "개선 가이드";
      const p = document.createElement("p");
      p.textContent = guideFirst;
      details.append(summaryEl, p);
      li.appendChild(details);
    }

    list.appendChild(li);
  }

  // 연결돼 있으면 저장 버튼·프로세스 태그 노출
  getSession().then((s) => {
    $("save").hidden = !s;
    $("procWrap").hidden = !s;
  });
  void url;
}

async function saveToAccount() {
  const session = await getSession();
  if (!session || !lastPage) return;
  const saveBtn = $<HTMLButtonElement>("save");
  const msg = $("saveMsg");
  saveBtn.disabled = true;
  msg.textContent = "저장 중…";
  try {
    const reviewMap = await getReviewState(lastPage.url);
    const reviews = Object.entries(reviewMap).map(([itemId, v]) => ({
      standard: "kwcag" as const,
      itemId,
      outcome: v.outcome,
      note: v.note ?? "",
    }));
    const isProcess = ($("isProcess") as HTMLInputElement).checked;
    const res = await fetch(`${SITE_ORIGIN}/api/extension/scan`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.accessToken}`,
      },
      body: JSON.stringify({ page: lastPage, reviews, sampleType: isProcess ? "process" : "structured" }),
    });
    const data = (await res.json()) as { id?: string; error?: string; merged?: boolean; rootUrl?: string };
    if (!res.ok || !data.id) {
      msg.textContent = "";
      const err = document.createElement("span");
      err.className = "err";
      err.textContent = data.error ?? "저장에 실패했습니다.";
      msg.appendChild(err);
    } else {
      msg.textContent = data.merged
        ? `기존 사이트 보고서(${data.rootUrl ?? ""})에 이 페이지를 추가했습니다. `
        : "저장되었습니다. ";
      const link = document.createElement("a");
      link.href = `${SITE_ORIGIN}/ko/scans/${data.id}`;
      link.target = "_blank";
      link.rel = "noopener";
      link.textContent = "보고서 보기 →";
      msg.appendChild(link);
    }
  } catch {
    msg.innerHTML = '<span class="err">네트워크 오류가 발생했습니다.</span>';
  } finally {
    saveBtn.disabled = false;
  }
}

// ─── 수동 점검 · 전문가 판정 ───
type Verdict = "passed" | "failed" | "cannotTell";
interface ReviewEntry {
  outcome: Verdict;
  note: string;
}
type ReviewMap = Record<string, ReviewEntry>;

const VERDICTS: { value: Verdict; label: string }[] = [
  { value: "passed", label: "통과" },
  { value: "failed", label: "실패" },
  { value: "cannotTell", label: "보류" },
];

async function getReviewState(url: string): Promise<ReviewMap> {
  const key = `review:${url}`;
  const stored = await chrome.storage.local.get(key);
  return (stored[key] as ReviewMap | undefined) ?? {};
}

async function setReview(url: string, itemId: string, patch: Partial<ReviewEntry>) {
  const cur = await getReviewState(url);
  const prev = cur[itemId] ?? { outcome: "cannotTell", note: "" };
  cur[itemId] = { ...prev, ...patch };
  await chrome.storage.local.set({ [`review:${url}`]: cur });
}

async function renderManual(url: string) {
  const items = getManualCheckItems();
  const reviews = await getReviewState(url);
  const list = $("manual");
  list.innerHTML = "";
  for (const item of items) {
    const li = document.createElement("li");
    li.className = "review-item";

    const head = document.createElement("p");
    head.className = "ri-head";
    const mid = document.createElement("span");
    mid.className = "mid";
    mid.textContent = item.id;
    head.append(mid, document.createTextNode(item.name.ko));
    li.appendChild(head);

    // 통과/실패/보류 라디오 버튼 그룹
    const group = document.createElement("div");
    group.className = "verdicts";
    group.setAttribute("role", "group");
    group.setAttribute("aria-label", `${item.name.ko} 판정`);
    for (const v of VERDICTS) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = `verdict v-${v.value}`;
      btn.textContent = v.label;
      btn.setAttribute("aria-pressed", String(reviews[item.id]?.outcome === v.value));
      btn.addEventListener("click", async () => {
        const already = btn.getAttribute("aria-pressed") === "true";
        const next = already ? undefined : v.value;
        if (next) await setReview(url, item.id, { outcome: next });
        else {
          const cur = await getReviewState(url);
          delete cur[item.id];
          await chrome.storage.local.set({ [`review:${url}`]: cur });
        }
        group.querySelectorAll(".verdict").forEach((b) => b.setAttribute("aria-pressed", "false"));
        if (next) btn.setAttribute("aria-pressed", "true");
      });
      group.appendChild(btn);
    }
    li.appendChild(group);

    // 메모
    const note = document.createElement("textarea");
    note.className = "ri-note";
    note.rows = 1;
    note.placeholder = "관찰 메모 (선택)";
    note.value = reviews[item.id]?.note ?? "";
    note.addEventListener("change", () => setReview(url, item.id, { note: note.value.slice(0, 2000) }));
    li.appendChild(note);

    list.appendChild(li);
  }
}

// ─── 시각 도구 컨트롤러 (패널 측 상태 + 주입 실행) ───

type OverlayView = "none" | "issues" | "headings" | "landmarks" | "focus";
let currentView: OverlayView = "none";
let currentSim = "none";
let linearizeOn = false;

/** 활성 탭에 주입 함수 실행 */
async function runInPage<Args extends unknown[], R>(
  func: (...args: Args) => R,
  ...args: Args
): Promise<Awaited<R> | undefined> {
  if (!currentTabId) return undefined;
  try {
    // chrome.scripting은 주입 함수가 Promise를 반환하면 값을 resolve해 전달한다
    const r = await chrome.scripting.executeScript({ target: { tabId: currentTabId }, func, args });
    return r[0]?.result as Awaited<R> | undefined;
  } catch {
    return undefined;
  }
}

const MARKER_COLOR: Record<Impact, string> = {
  critical: "#e0533d",
  serious: "#e0533d",
  moderate: "#8a8a8a",
  minor: "#8a8a8a",
};

/** 위반 표시 토글 (검사 결과 필요) */
async function setIssuesView(on: boolean) {
  if (on && lastPage) {
    const markers = lastPage.violations.flatMap((v) =>
      v.nodes.map((n) => ({
        selector: n.selector,
        color: MARKER_COLOR[v.impact],
        label: IMPACT_LABEL[v.impact],
      })),
    );
    await runInPage(overlayMarkersInPage, markers);
    currentView = "issues";
  } else {
    await runInPage(clearOverlayInPage);
    currentView = "none";
    // 시뮬레이션·선형화는 clearOverlay가 함께 지우므로 복원
    if (currentSim !== "none") await runInPage(applySimulationInPage, currentSim);
    if (linearizeOn) await runInPage(linearizeInPage, true);
  }
  syncToolButtons();
}

/** 구조 오버레이 토글 */
async function setStructView(kind: "headings" | "landmarks" | "focus", on: boolean) {
  if (on) {
    await runInPage(overlayStructureInPage, kind);
    currentView = kind;
  } else {
    await runInPage(clearOverlayInPage);
    currentView = "none";
    if (currentSim !== "none") await runInPage(applySimulationInPage, currentSim);
    if (linearizeOn) await runInPage(linearizeInPage, true);
  }
  syncToolButtons();
}

/** 오버레이 전체 지우기 + 상태 초기화 */
async function clearAll() {
  await runInPage(clearOverlayInPage);
  currentView = "none";
  currentSim = "none";
  linearizeOn = false;
  syncToolButtons();
}

/** 버튼 aria-pressed 상태 동기화 */
function syncToolButtons() {
  const issuesBtn = document.getElementById("toggleIssues");
  if (issuesBtn) issuesBtn.setAttribute("aria-pressed", String(currentView === "issues"));
  document.querySelectorAll<HTMLButtonElement>("[data-struct]").forEach((b) => {
    const k = b.dataset.struct!;
    const active = k === "linearize" ? linearizeOn : currentView === k;
    b.setAttribute("aria-pressed", String(active));
  });
  document.querySelectorAll<HTMLButtonElement>("[data-sim]").forEach((b) => {
    b.setAttribute("aria-pressed", String(currentSim === b.dataset.sim));
  });
}

function wireVisualTools() {
  $("toggleIssues").addEventListener("click", () => setIssuesView(currentView !== "issues"));
  $("clearOverlay").addEventListener("click", clearAll);

  document.querySelectorAll<HTMLButtonElement>("[data-struct]").forEach((btn) => {
    const kind = btn.dataset.struct!;
    btn.addEventListener("click", async () => {
      if (kind === "linearize") {
        linearizeOn = !linearizeOn;
        await runInPage(linearizeInPage, linearizeOn);
        syncToolButtons();
      } else {
        await setStructView(kind as "headings" | "landmarks" | "focus", currentView !== kind);
      }
    });
  });

  document.querySelectorAll<HTMLButtonElement>("[data-sim]").forEach((btn) => {
    const mode = btn.dataset.sim!;
    btn.addEventListener("click", async () => {
      currentSim = currentSim === mode ? "none" : mode;
      await runInPage(applySimulationInPage, currentSim);
      syncToolButtons();
    });
  });

  const contrastBtn = $<HTMLButtonElement>("contrast");
  contrastBtn.addEventListener("click", async () => {
    contrastBtn.disabled = true;
    const prev = contrastBtn.textContent;
    contrastBtn.textContent = "스포이드 활성화 — 색을 두 번 찍으세요";
    const r = await runInPage(pickContrastInPage);
    if (r === "unsupported") $("contrastHint").textContent = "이 브라우저는 스포이드(EyeDropper)를 지원하지 않습니다.";
    else if (r === "cancelled" || r === undefined) $("contrastHint").textContent = "취소되었습니다.";
    else $("contrastHint").textContent = `대비율 ${r} : 1 — 결과는 페이지 하단에 표시됩니다.`;
    contrastBtn.textContent = prev;
    contrastBtn.disabled = false;
  });
}

async function init() {
  const tab = await getActiveTab();
  const url = tab?.url ?? "";
  currentTabId = tab?.id ?? null;
  $("target").textContent = url;

  const session = await getSession();
  const conn = $("conn");
  if (session) {
    conn.textContent = "연결됨";
    conn.classList.add("on");
  } else {
    conn.textContent = "미연결";
  }

  $("connectLink").setAttribute("href", `${SITE_ORIGIN}/ko/extension/connect`);
  $("siteLink").setAttribute("href", `${SITE_ORIGIN}/ko`);

  if (/^https?:/.test(url)) await renderManual(url);

  $("scan").addEventListener("click", scan);
  $("save").addEventListener("click", saveToAccount);
  wireVisualTools();
}

void init();
