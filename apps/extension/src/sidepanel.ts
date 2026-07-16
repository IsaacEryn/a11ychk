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

/** 연결(로그인) 페이지 열기 */
function openConnect() {
  void chrome.tabs.create({ url: `${SITE_ORIGIN}/ko/extension/connect` });
}

/** 확장 연결 해제 — 저장된 세션 삭제 */
async function logout() {
  await chrome.storage.local.remove("a11ychk_session");
  await renderAccount();
}

/** 계정 영역(로그인/로그아웃) + 헤더 연결 배지 렌더 */
async function renderAccount() {
  const session = await getSession();
  const conn = $("conn");
  const box = $("account");
  box.innerHTML = "";

  if (session) {
    conn.textContent = "연결됨";
    conn.classList.add("on");
    box.className = "account connected";
    const who = document.createElement("span");
    who.className = "who";
    who.append("연결됨 · ");
    const b = document.createElement("b");
    b.textContent = session.email ?? "내 계정";
    who.appendChild(b);
    const out = document.createElement("button");
    out.type = "button";
    out.className = "logout";
    out.textContent = "로그아웃";
    out.addEventListener("click", logout);
    box.append(who, out);
    // 저장 버튼·프로세스 태그는 검사 결과가 있을 때만 별도 노출
  } else {
    conn.textContent = "미연결";
    conn.classList.remove("on");
    box.className = "account disconnected";
    const p = document.createElement("p");
    p.textContent = "로그인하면 검사 결과·전문가 판정을 계정에 저장하고 사이트 보고서로 관리할 수 있습니다.";
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = "웹 서비스 로그인 · 연결";
    btn.addEventListener("click", openConnect);
    box.append(p, btn);
    // 로그아웃 시 저장 UI 숨김
    $("save").hidden = true;
    $("procWrap").hidden = true;
  }
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
    smallTargets: [], targetSampled: 0, hasNav: false, skipLinkPresent: false, videoNoTrack: 0, blankNoNotice: 0,
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
  try {
    // 2.4.1 건너뛰기 링크 — 반복 내비게이션 유무 + 상단 앵커 링크
    res.hasNav = !!document.querySelector("nav, [role=navigation]");
    const links0 = document.querySelectorAll("a[href]");
    const SKIP = /건너뛰|본문\s*바로|바로\s*가기|skip|main content/i;
    for (let sk = 0; sk < links0.length && sk < 8; sk++) {
      const a0 = links0[sk];
      if (!a0) continue;
      const h0 = a0.getAttribute("href") || "";
      const t0 = (a0.textContent || "").trim();
      if ((h0.charAt(0) === "#" && h0.length > 1) || SKIP.test(t0)) {
        res.skipLinkPresent = true;
        break;
      }
    }
  } catch { /* 무시 */ }
  try {
    // 1.2.2 자막 track 없는 video
    document.querySelectorAll("video").forEach((v) => {
      if (!v.querySelector("track[kind=captions],track[kind=subtitles]")) res.videoNoTrack++;
    });
  } catch { /* 무시 */ }
  try {
    // 3.2.2 새 창 고지 없는 target=_blank
    const NOTICE = /새\s*창|새\s*탭|팝업|new\s*window|opens?\s*in/i;
    document.querySelectorAll("a[target=_blank]").forEach((el0) => {
      const txt0 =
        (el0.textContent || "") + " " + (el0.getAttribute("aria-label") || "") + " " + (el0.getAttribute("title") || "");
      if (!NOTICE.test(txt0)) res.blankNoNotice++;
    });
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

/** 클릭·터치 대상 크기 오버레이 — 각 타깃에 px 크기 표시, 24×24 미만은 빨간색 (WCAG 2.5.8) */
function overlayTargetSizeInPage(): number {
  document.getElementById("a11ychk-overlay")?.remove();
  const c = document.createElement("div");
  c.id = "a11ychk-overlay";
  c.style.cssText = "all:initial;position:absolute;top:0;left:0;width:0;height:0;z-index:2147483646;pointer-events:none;";
  const targets = document.querySelectorAll<HTMLElement>(
    "a[href],button,input:not([type=hidden]),select,textarea,[role=button],[tabindex]:not([tabindex^='-'])",
  );
  let n = 0;
  targets.forEach((el) => {
    const st = getComputedStyle(el);
    if (st.display === "inline") return;
    const r = el.getBoundingClientRect();
    if (r.width <= 0 && r.height <= 0) return;
    n++;
    const small = r.width < 24 || r.height < 24;
    const color = small ? "#e0533d" : "#0b6b5e";
    const box = document.createElement("div");
    box.style.cssText =
      "all:initial;position:absolute;box-sizing:border-box;pointer-events:none;" +
      `border:2px solid ${color};left:${r.left + window.scrollX}px;top:${r.top + window.scrollY}px;` +
      `width:${Math.max(r.width, 4)}px;height:${Math.max(r.height, 4)}px;`;
    const tag = document.createElement("span");
    tag.textContent = `${Math.round(r.width)}×${Math.round(r.height)}`;
    tag.style.cssText =
      "all:initial;position:absolute;left:0;top:-15px;font:700 10px/15px sans-serif;" +
      `background:${color};color:#fff;padding:0 4px;white-space:nowrap;border-radius:2px;`;
    box.appendChild(tag);
    c.appendChild(box);
  });
  document.body.appendChild(c);
  return n;
}

/** 선택자에 맞는 모든 요소를 강조 (수동 점검 항목별 맞춤 강조용) */
function overlayQueryInPage(selector: string, label: string): number {
  document.getElementById("a11ychk-overlay")?.remove();
  const c = document.createElement("div");
  c.id = "a11ychk-overlay";
  c.style.cssText = "all:initial;position:absolute;top:0;left:0;width:0;height:0;z-index:2147483646;pointer-events:none;";
  let els: Element[];
  try {
    els = Array.from(document.querySelectorAll(selector));
  } catch {
    els = [];
  }
  let n = 0;
  els.forEach((el) => {
    const r = el.getBoundingClientRect();
    if (r.width <= 0 && r.height <= 0) return;
    n++;
    const box = document.createElement("div");
    box.style.cssText =
      "all:initial;position:absolute;box-sizing:border-box;pointer-events:none;" +
      "border:2px solid #c9761b;background:rgba(201,118,27,.12);" +
      `left:${r.left + window.scrollX}px;top:${r.top + window.scrollY}px;` +
      `width:${Math.max(r.width, 8)}px;height:${Math.max(r.height, 8)}px;`;
    c.appendChild(box);
  });
  const tag = document.createElement("div");
  tag.textContent = n > 0 ? `${label} · ${n}개 강조` : `${label} · 해당 요소 없음`;
  tag.style.cssText =
    "all:initial;position:fixed;left:8px;bottom:8px;z-index:2147483647;background:#c9761b;color:#fff;" +
    "font:700 12px sans-serif;padding:5px 11px;border-radius:6px;box-shadow:0 2px 8px rgba(0,0,0,.25);";
  c.appendChild(tag);
  document.body.appendChild(c);
  return n;
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
    // 에러 메시지는 페이지 컨텍스트에서 올 수 있으므로 textContent로만 렌더 (XSS 방지)
    const target = $("target");
    target.textContent = "";
    const err = document.createElement("span");
    err.className = "err";
    err.textContent = `검사에 실패했습니다: ${(e as Error).message}`;
    target.appendChild(err);
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

  // 연결돼 있으면 저장 버튼·프로세스 태그·저장 위치 선택 노출
  getSession().then((s) => {
    $("save").hidden = !s;
    $("procWrap").hidden = !s;
    $("saveDest").hidden = !s;
    if (s) void populateSaveTargets(s.accessToken, url);
  });
  void url;
}

/** 저장 위치 셀렉트 채우기 — 새 보고서 + 사용자의 기존 보고서(같은 사이트 우선) */
async function populateSaveTargets(accessToken: string, pageUrl: string) {
  const sel = $<HTMLSelectElement>("saveTarget");
  let host = "";
  try {
    host = new URL(pageUrl).hostname;
  } catch {
    host = "";
  }
  try {
    const res = await fetch(`${SITE_ORIGIN}/api/extension/scan?host=${encodeURIComponent(host)}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) return;
    const data = (await res.json()) as {
      reports?: { id: string; rootUrl: string; pageCount: number; createdAt: string; sameHost: boolean }[];
    };
    const reports = data.reports ?? [];
    // "새 보고서" 옵션은 유지하고 그 뒤로 기존 보고서를 채운다
    sel.length = 1;
    let firstSameHostId = "";
    for (const r of reports) {
      const opt = document.createElement("option");
      opt.value = r.id;
      let hostLabel = r.rootUrl;
      try {
        hostLabel = new URL(r.rootUrl).hostname;
      } catch {
        /* rootUrl 그대로 사용 */
      }
      const date = new Date(r.createdAt).toLocaleDateString("ko-KR", { month: "numeric", day: "numeric" });
      opt.textContent = `${r.sameHost ? "＊ " : ""}${hostLabel} · ${r.pageCount}p · ${date}`;
      sel.appendChild(opt);
      if (r.sameHost && !firstSameHostId) firstSameHostId = r.id;
    }
    // 같은 사이트 보고서가 있으면 기본 선택(페이지 추가가 자연스러움), 없으면 새 보고서
    sel.value = firstSameHostId || "new";
  } catch {
    // 목록 조회 실패 시 "새 보고서로 저장"만 사용 가능 — 저장 자체는 동작
  }
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
      // 확장은 현재 페이지 단위이므로 판정을 그 페이지에 귀속
      pages: [lastPage!.url],
    }));
    const isProcess = ($("isProcess") as HTMLInputElement).checked;
    const target = $<HTMLSelectElement>("saveTarget").value || "new";
    const res = await fetch(`${SITE_ORIGIN}/api/extension/scan`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.accessToken}`,
      },
      body: JSON.stringify({
        page: lastPage,
        reviews,
        sampleType: isProcess ? "process" : "structured",
        target,
      }),
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
      // 새로 만든/갱신된 보고서가 다음 저장 시 선택지에 나타나도록 목록 갱신
      void populateSaveTargets(session.accessToken, lastPage.url);
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

/** WCAG 성공기준 → 관련 요소 선택자·라벨 (수동 항목 맞춤 강조용) */
const SC_HIGHLIGHT: Record<string, { selector: string; label: string }> = {
  "1.1.1": { selector: "img,[role=img],input[type=image],area,svg", label: "이미지/대체텍스트 대상" },
  "1.2.1": { selector: "video,audio", label: "동영상·음성 미디어" },
  "1.2.2": { selector: "video,audio", label: "미디어(자막 확인)" },
  "1.2.3": { selector: "video", label: "동영상(대체수단)" },
  "1.3.1": { selector: "table,ul,ol,dl,fieldset", label: "구조 요소(표·목록)" },
  "1.4.2": { selector: "video[autoplay],audio[autoplay]", label: "자동재생 미디어" },
  "2.1.1": { selector: "a[href],button,input,select,textarea,[onclick],[role=button]", label: "조작 대상" },
  "2.4.1": { selector: "a[href^='#'],[id]", label: "건너뛰기·앵커 대상" },
  "2.4.4": { selector: "a[href]", label: "링크" },
  "2.4.6": { selector: "h1,h2,h3,h4,h5,h6,[role=heading]", label: "제목" },
  "2.5.8": { selector: "a[href],button,[role=button],input", label: "클릭 대상(크기)" },
  "3.3.2": { selector: "input:not([type=hidden]),select,textarea,label", label: "폼 입력·레이블" },
};
/** KWCAG 항목의 대응 WCAG SC들에서 강조 선택자 조합 */
function highlightForItem(item: { wcag: string[] }): { selector: string; label: string } | null {
  const parts: string[] = [];
  let label = "";
  for (const sc of item.wcag) {
    const h = SC_HIGHLIGHT[sc];
    if (h) {
      parts.push(h.selector);
      if (!label) label = h.label;
    }
  }
  if (parts.length === 0) return null;
  return { selector: [...new Set(parts.join(",").split(","))].join(","), label };
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

    const actions = document.createElement("div");
    actions.className = "ri-actions";

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
    actions.appendChild(group);

    // 항목별 맞춤 강조 토글 (관련 요소가 있을 때만)
    const hl = highlightForItem(item);
    if (hl) {
      const hlBtn = document.createElement("button");
      hlBtn.type = "button";
      hlBtn.className = "ri-highlight";
      hlBtn.textContent = "강조";
      hlBtn.setAttribute("aria-pressed", "false");
      hlBtn.setAttribute("aria-label", `${item.name.ko} 관련 요소 강조`);
      hlBtn.addEventListener("click", () => toggleManualHighlight(hl.selector, hl.label, hlBtn));
      actions.appendChild(hlBtn);
    }
    li.appendChild(actions);

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

type StructKind = "headings" | "landmarks" | "focus" | "targets";
type OverlayView = "none" | "issues" | StructKind | "manual";
let currentView: OverlayView = "none";
let currentSim = "none";
let linearizeOn = false;
let activeHighlightBtn: HTMLButtonElement | null = null;

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

/** 오버레이만 지우고 시뮬레이션·선형화는 복원 (오버레이는 단일이라 서로 배타적) */
async function clearOverlayView() {
  await runInPage(clearOverlayInPage);
  currentView = "none";
  if (currentSim !== "none") await runInPage(applySimulationInPage, currentSim);
  if (linearizeOn) await runInPage(linearizeInPage, true);
}

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
    await clearOverlayView();
  }
  syncToolButtons();
}

/** 구조·크기 오버레이 토글 */
async function setStructView(kind: StructKind, on: boolean) {
  if (on) {
    if (kind === "targets") await runInPage(overlayTargetSizeInPage);
    else await runInPage(overlayStructureInPage, kind);
    currentView = kind;
  } else {
    await clearOverlayView();
  }
  syncToolButtons();
}

/** 수동 항목 맞춤 강조 토글 */
async function toggleManualHighlight(selector: string, label: string, btn: HTMLButtonElement) {
  const on = btn.getAttribute("aria-pressed") !== "true";
  if (on) {
    await runInPage(overlayQueryInPage, selector, label);
    currentView = "manual";
    activeHighlightBtn = btn;
  } else {
    await clearOverlayView();
    activeHighlightBtn = null;
  }
  syncToolButtons();
}

/** 오버레이·시뮬·선형화 전체 지우기 + 상태 초기화 */
async function clearAll() {
  await runInPage(clearOverlayInPage);
  currentView = "none";
  currentSim = "none";
  linearizeOn = false;
  activeHighlightBtn = null;
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
  // 수동 강조 버튼: 현재 뷰가 manual이 아니면 모두 해제
  if (currentView !== "manual" && activeHighlightBtn) {
    activeHighlightBtn.setAttribute("aria-pressed", "false");
    activeHighlightBtn = null;
  }
}

function wireVisualTools() {
  $("toggleIssues").addEventListener("click", () => setIssuesView(currentView !== "issues"));
  $("clearOverlay").addEventListener("click", clearAll);
  $("clearOverlay2").addEventListener("click", clearAll);

  document.querySelectorAll<HTMLButtonElement>("[data-struct]").forEach((btn) => {
    const kind = btn.dataset.struct!;
    btn.addEventListener("click", async () => {
      if (kind === "linearize") {
        linearizeOn = !linearizeOn;
        await runInPage(linearizeInPage, linearizeOn);
        syncToolButtons();
      } else {
        await setStructView(kind as StructKind, currentView !== kind);
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

  wireContrastPicker();
}

// ─── 명도대비 스포이드 (배경색/글자색 각각 선택 + 가이드) ───
let ccBg: string | null = null;
let ccFg: string | null = null;

function relLum(hex: string): number {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m || !m[1]) return 0;
  const v = parseInt(m[1], 16);
  const ch = [(v >> 16) & 255, (v >> 8) & 255, v & 255].map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * (ch[0] ?? 0) + 0.7152 * (ch[1] ?? 0) + 0.0722 * (ch[2] ?? 0);
}
function ratioOf(a: string, b: string): number {
  const l1 = relLum(a);
  const l2 = relLum(b);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}
/** bg에 대해 AA(4.5:1)를 통과하는, fg에 가장 가까운 색 제안 (검정/흰색 방향 혼합) */
function suggestColor(bg: string, fg: string): string | null {
  const mix = (hex: string, tgt: number, t: number) => {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex)![1]!;
    const v = parseInt(m, 16);
    const parts = [(v >> 16) & 255, (v >> 8) & 255, v & 255].map((c) => Math.round(c + (tgt - c) * t));
    return "#" + parts.map((c) => c.toString(16).padStart(2, "0")).join("");
  };
  for (let t = 0.05; t <= 1; t += 0.05) {
    for (const tgt of [0, 255]) {
      const cand = mix(fg, tgt, t);
      if (ratioOf(bg, cand) >= 4.5) return cand;
    }
  }
  return null;
}

async function pickScreenColor(): Promise<string | null> {
  const w = window as unknown as { EyeDropper?: new () => { open: () => Promise<{ sRGBHex: string }> } };
  if (!w.EyeDropper) return "unsupported";
  try {
    const r = await new w.EyeDropper().open();
    return r.sRGBHex;
  } catch {
    return null;
  }
}

function renderContrast() {
  const out = $("ccResult");
  ($("bgSwatch") as HTMLElement).style.background = ccBg ?? "";
  ($("fgSwatch") as HTMLElement).style.background = ccFg ?? "";
  if (!ccBg || !ccFg) {
    out.textContent = ccBg || ccFg ? "나머지 색도 선택하세요." : "";
    return;
  }
  const ratio = Math.round(ratioOf(ccBg, ccFg) * 100) / 100;
  const aa = ratio >= 4.5;
  const aaLarge = ratio >= 3;
  const aaa = ratio >= 7;
  out.innerHTML = "";

  const preview = document.createElement("div");
  preview.className = "cc-preview";
  preview.style.background = ccBg;
  preview.style.color = ccFg;
  preview.textContent = "본문 예시 Aa 가나다 123";
  out.appendChild(preview);

  const ratioEl = document.createElement("div");
  ratioEl.innerHTML = `대비율 <span class="cc-ratio">${ratio}</span> : 1 <span style="color:var(--ink-faint)">(${ccBg} / ${ccFg})</span>`;
  out.appendChild(ratioEl);

  const badges = document.createElement("div");
  badges.className = "cc-badges";
  const mk = (label: string, ok: boolean) => {
    const s = document.createElement("span");
    s.className = `cc-badge ${ok ? "pass" : "fail"}`;
    s.textContent = `${label} ${ok ? "✓" : "✗"}`;
    return s;
  };
  badges.append(mk("일반 텍스트 AA", aa), mk("큰 텍스트 AA", aaLarge), mk("AAA", aaa));
  out.appendChild(badges);

  if (!aa) {
    const guide = document.createElement("div");
    guide.className = "cc-guide";
    const suggestion = suggestColor(ccBg, ccFg);
    let html =
      "일반 텍스트 기준(4.5:1)에 미달합니다. 글자색을 더 진하게 하거나 배경과의 명도 차이를 키우세요.";
    if (suggestion) {
      html += `<br>제안 글자색: <b style="color:${suggestion}">${suggestion}</b> `;
      html += `<span style="display:inline-block;width:12px;height:12px;border-radius:3px;background:${suggestion};border:1px solid var(--line);vertical-align:middle"></span>`;
      html += ` (대비율 ${Math.round(ratioOf(ccBg, suggestion) * 100) / 100}:1)`;
    }
    guide.innerHTML = html;
    out.appendChild(guide);
  }
}

function wireContrastPicker() {
  const bgBtn = $<HTMLButtonElement>("pickBg");
  const fgBtn = $<HTMLButtonElement>("pickFg");
  const pick = async (which: "bg" | "fg", btn: HTMLButtonElement) => {
    const label = btn.childNodes[0];
    const prev = label?.textContent ?? "";
    if (label) label.textContent = which === "bg" ? "배경색 찍는 중… " : "글자색 찍는 중… ";
    const c = await pickScreenColor();
    if (label) label.textContent = prev;
    if (c === "unsupported") {
      $("ccResult").textContent = "이 브라우저는 스포이드(EyeDropper)를 지원하지 않습니다.";
      return;
    }
    if (!c) return;
    if (which === "bg") ccBg = c;
    else ccFg = c;
    renderContrast();
  };
  bgBtn.addEventListener("click", () => pick("bg", bgBtn));
  fgBtn.addEventListener("click", () => pick("fg", fgBtn));
}

// ─── 상단 탭 전환 ───
function wireTabs() {
  const tabs = [...document.querySelectorAll<HTMLButtonElement>(".tab")];
  const panels: Record<string, HTMLElement> = {
    scan: $("tab-scan"),
    tools: $("tab-tools"),
    settings: $("tab-settings"),
  };
  for (const tab of tabs) {
    tab.addEventListener("click", () => {
      const name = tab.dataset.tab!;
      for (const t of tabs) t.setAttribute("aria-selected", String(t === tab));
      for (const [k, el] of Object.entries(panels)) el.hidden = k !== name;
      // 대상 URL은 검사·도구 탭에서만 의미 있음
      $("target").style.display = name === "settings" ? "none" : "";
    });
  }
}

// ─── 테마 (라이트/다크/고대비/시스템) ───
type ThemeMode = "system" | "light" | "dark" | "contrast";
function applyTheme(mode: ThemeMode) {
  if (mode === "system") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = mode;
  document.querySelectorAll<HTMLButtonElement>("[data-theme]").forEach((b) => {
    b.setAttribute("aria-pressed", String(b.dataset.theme === mode));
  });
}
async function wireTheme() {
  const { a11ychk_theme } = await chrome.storage.local.get("a11ychk_theme");
  const saved = (a11ychk_theme as ThemeMode | undefined) ?? "system";
  applyTheme(saved);
  document.querySelectorAll<HTMLButtonElement>("[data-theme]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const mode = btn.dataset.theme as ThemeMode;
      applyTheme(mode);
      void chrome.storage.local.set({ a11ychk_theme: mode });
    });
  });
}

async function init() {
  await renderAccount();
  // 웹 연결 페이지에서 로그인하면 저장소가 바뀌므로 패널을 자동 갱신
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes.a11ychk_session) void renderAccount();
  });

  $("guideLink").setAttribute("href", `${SITE_ORIGIN}/ko/guide`);
  $("siteLink").setAttribute("href", `${SITE_ORIGIN}/ko`);

  $("scan").addEventListener("click", scan);
  $("save").addEventListener("click", saveToAccount);
  wireVisualTools();
  wireTabs();
  await wireTheme();

  await refreshActiveTab();
  // 사이드 패널은 탭을 바꿔도 떠 있으므로, 활성 탭 변경·주소 변경 시 갱신
  chrome.tabs.onActivated.addListener(() => void refreshActiveTab());
  chrome.tabs.onUpdated.addListener((_id, info, tab) => {
    if (tab.active && info.url) void refreshActiveTab();
  });
}

/** 현재 활성 탭을 다시 읽어 대상 URL·수동 체크리스트를 갱신 */
async function refreshActiveTab() {
  const tab = await getActiveTab();
  const url = tab?.url ?? "";
  currentTabId = tab?.id ?? null;
  const scannable = /^https?:/.test(url);
  $("target").textContent = scannable ? url : url ? "이 페이지는 검사할 수 없습니다 (브라우저 내부 페이지)." : "탭 정보를 읽을 수 없습니다.";
  $<HTMLButtonElement>("scan").disabled = !scannable;
  if (scannable) await renderManual(url);
  else $("manual").innerHTML = "";
}

void init();
