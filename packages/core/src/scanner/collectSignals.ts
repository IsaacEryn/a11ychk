/**
 * 자체 커스텀 검사 신호 수집기 — 정본(canonical) 구현.
 *
 * 같은 신호(PageCheckSignals)를 두 실행 환경이 수집한다:
 * - 크롬 확장: 이 함수를 그대로 import → chrome.scripting.executeScript가 소스를
 *   직렬화해 ISOLATED world에서 실행 (그래서 이 함수는 자기 완결이어야 한다 —
 *   외부 모듈·클로저 변수 참조 금지, 필요한 값은 만들지 말고 인라인)
 * - 서버 스캐너: customChecks.ts의 BASE_SCRIPT(ES5 문자열) — playwright evaluate용.
 *   문자열을 함수 toString()으로 자동 생성하지 않는 이유: 검사 핵심 경로에서
 *   프로덕션 번들러(minify) 변환 결과에 의존하는 위험을 피하기 위해서다.
 *   대신 tests/signals-parity.test.ts 골든 테스트가 두 구현의 동일성을 강제한다.
 * 규칙을 추가·수정할 때는 반드시 양쪽을 함께 고치고 패리티 테스트를 통과시킬 것.
 */
import type { PageCheckSignals } from "./pageChecks";

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

/**
 * 프레임별 신호 병합 — 크롬 확장이 allFrames로 수집한 결과를 페이지 단위로 합친다.
 * (axe는 이미 프레임 경계를 넘어 검사하는데 커스텀 신호는 상위 프레임만 보던
 * 사각지대 해소용)
 *
 * 병합 규칙:
 * - 개수·표본은 합산, 존재 여부는 OR, 예시 배열은 수집기와 동일한 상한으로 이어붙임
 * - hasNav·skipLinkPresent는 페이지(상위 문서) 구조 판정이므로 상위 프레임 값만 사용
 *   — 하위 프레임(임베드 위젯 등)의 내비·앵커가 본문 건너뛰기 판정을 가리지 않게
 */
export function mergePageSignals(top: PageCheckSignals, subs: PageCheckSignals[]): PageCheckSignals {
  const merged: PageCheckSignals = {
    ...top,
    inlineClickNonInteractive: [...top.inlineClickNonInteractive],
    focusExamples: [...top.focusExamples],
    altFilename: [...top.altFilename],
    altGeneric: [...top.altGeneric],
    autoplay: [...top.autoplay],
    smallTargets: [...top.smallTargets],
  };
  for (const s of subs) {
    merged.hasMedia = merged.hasMedia || s.hasMedia;
    merged.focusSampled += s.focusSampled;
    merged.focusNoOutline += s.focusNoOutline;
    merged.altSampled += s.altSampled;
    merged.genericLinks += s.genericLinks;
    merged.targetSampled += s.targetSampled;
    merged.videoNoTrack += s.videoNoTrack;
    merged.blankNoNotice += s.blankNoNotice;
    merged.inlineClickNonInteractive.push(...s.inlineClickNonInteractive);
    merged.focusExamples.push(...s.focusExamples);
    merged.altFilename.push(...s.altFilename);
    merged.altGeneric.push(...s.altGeneric);
    merged.autoplay.push(...s.autoplay);
    merged.smallTargets.push(...s.smallTargets);
  }
  // 예시 상한 — 수집기(collectPageSignals)의 개별 상한과 동일하게 유지
  merged.inlineClickNonInteractive = merged.inlineClickNonInteractive.slice(0, 8);
  merged.focusExamples = merged.focusExamples.slice(0, 5);
  merged.altFilename = merged.altFilename.slice(0, 8);
  merged.altGeneric = merged.altGeneric.slice(0, 8);
  merged.autoplay = merged.autoplay.slice(0, 4);
  merged.smallTargets = merged.smallTargets.slice(0, 6);
  return merged;
}
