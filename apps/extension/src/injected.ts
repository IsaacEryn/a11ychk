/**
 * 페이지 주입 함수 모음 — 모두 자기 완결(self-contained)이어야 한다.
 * chrome.scripting.executeScript가 함수 소스를 직렬화해 페이지 컨텍스트에서
 * 실행하므로, 이 파일의 함수는 외부 모듈·클로저 변수를 참조할 수 없다.
 * 필요한 값은 전부 args로 전달할 것.
 */
import type { AxeRunResults, PageCheckSignals } from "@a11ychk/core/catalog";

export function runAxeInPage(tags: string[]): Promise<AxeRunResults> {
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
export function collectPageSignals(): PageCheckSignals {
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
export function highlightInPage(selector: string): boolean {
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
export function clearOverlayInPage(): void {
  document.getElementById("a11ychk-overlay")?.remove();
  document.getElementById("a11ychk-sim-style")?.remove();
  document.getElementById("a11ychk-sim-svg")?.remove();
  document.getElementById("a11ychk-linearize")?.remove();
}

/** 위반/구조 마커를 그린다. 기존 오버레이는 지우고 새로 그림 */
export function overlayMarkersInPage(markers: { selector: string; color: string; label: string }[]): number {
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
export function overlayStructureInPage(kind: "headings" | "landmarks" | "focus"): number {
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
export function applySimulationInPage(mode: string): void {
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
export function linearizeInPage(on: boolean): void {
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
export function overlayTargetSizeInPage(): number {
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
export function overlayQueryInPage(selector: string, label: string): number {
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
