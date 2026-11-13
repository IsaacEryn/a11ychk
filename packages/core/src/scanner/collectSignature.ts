/**
 * 페이지 시그니처 수집기 — 크롬 확장용 함수판.
 *
 * 같은 시그니처(PageSignature에서 url을 뺀 값)를 두 실행 환경이 수집한다:
 * - 서버(웹 정식 검사·티저·Action·MCP): signature.ts의 SIGNATURE_SCRIPT(ES5 문자열)를
 *   playwright evaluate로 상위 문서에서 실행한다.
 * - 크롬 확장: MV3는 문자열 평가를 막으므로 이 함수를 import해 chrome.scripting.executeScript로
 *   상위 프레임에서 실행한다. 소스가 직렬화돼 페이지에서 돌기 때문에 자기 완결이어야 한다
 *   (외부 모듈·클로저 변수 참조 금지).
 *
 * collectSignals.ts와 같은 이유로 문자열을 이 함수의 toString()으로 만들지 않는다(검사 핵심
 * 경로가 번들러 변환 결과에 기대지 않게). 대신 tests/signature-parity.test.ts가 두 구현이 같은
 * DOM에서 같은 값을 내는지 확인한다. 한쪽을 고치면 반드시 다른 쪽도 함께 고칠 것.
 *
 * 이 값으로 aggregateScan에 siteLevelOptions를 넘기므로(미디어가 없으면 1.2.x '해당 없음'),
 * 둘이 갈라지면 같은 페이지라도 확장과 웹의 자동 준수율이 달라진다.
 */
import type { PageSignature } from "../types";

export function collectPageSignature(): Omit<PageSignature, "url"> {
  function txt(el: Element): string {
    return (el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 60);
  }
  function cssPath(el: Element): string {
    try {
      if (el.id) return "#" + el.id;
      const parts: string[] = [];
      let cur: Element | null = el;
      let depth = 0;
      while (cur && cur.nodeType === 1 && depth < 4) {
        let sel = cur.tagName.toLowerCase();
        // SVG 요소의 className은 문자열이 아니므로(SVGAnimatedString) 서버 스크립트처럼 건너뛴다
        const cn: unknown = (cur as { className?: unknown }).className;
        if (cn && typeof cn === "string") {
          const c = cn.trim().split(/\s+/)[0];
          if (c) sel += "." + c;
        }
        parts.unshift(sel);
        cur = cur.parentElement;
        depth++;
      }
      return parts.join(" > ");
    } catch {
      return el.tagName ? el.tagName.toLowerCase() : "?";
    }
  }

  const nav = document.querySelector("nav, [role=navigation]");
  const navLinks: string[] = [];
  if (nav) {
    const as = nav.querySelectorAll("a[href]");
    for (let i = 0; i < as.length && navLinks.length < 40; i++) {
      const t = txt(as[i]!);
      if (t) navLinks.push(t);
    }
  }
  const hasSearch = !!document.querySelector(
    "input[type=search], [role=search], form[action*=search], input[name*=search i], input[id*=search i], input[name*=검색], input[placeholder*=검색]",
  );
  let hasSitemap = false;
  const links = document.querySelectorAll("a[href]");
  for (let j = 0; j < links.length; j++) {
    const h = (links[j]!.getAttribute("href") || "").toLowerCase();
    const tt = txt(links[j]!);
    if (h.indexOf("sitemap") >= 0 || /sitemap|사이트\s*맵/i.test(tt)) {
      hasSitemap = true;
      break;
    }
  }

  // ── 확인용 수집 자료 (값이 '있는' 경우만 — 없는 건 axe가 위반으로 잡는다) ──
  const review: NonNullable<PageSignature["review"]> = { alts: [], labels: [], genericLinks: [] };
  try {
    const imgs = document.querySelectorAll("img[alt]");
    for (let a = 0; a < imgs.length && review.alts.length < 8; a++) {
      const alt = (imgs[a]!.getAttribute("alt") || "").trim();
      if (alt) review.alts.push({ selector: cssPath(imgs[a]!), text: alt.slice(0, 120) });
    }
  } catch {
    /* 무시 */
  }
  try {
    const ctrls = document.querySelectorAll("input:not([type=hidden]), select, textarea");
    for (let b = 0; b < ctrls.length && review.labels.length < 8; b++) {
      const el = ctrls[b] as HTMLInputElement;
      let label = "";
      if (el.labels && el.labels.length > 0) label = txt(el.labels[0]!);
      if (!label) label = (el.getAttribute("aria-label") || "").trim();
      if (!label && el.getAttribute("title")) label = (el.getAttribute("title") || "").trim();
      if (label) review.labels.push({ selector: cssPath(el), text: label.slice(0, 120) });
    }
  } catch {
    /* 무시 */
  }
  try {
    const GENERIC =
      /^(여기|여기를?\s*클릭|클릭(하세요)?|더\s*보기|더보기|자세히(\s*보기)?|바로\s*가기|바로가기|here|click\s*here|click|more|read\s*more|learn\s*more|go|link)$/i;
    for (let g = 0; g < links.length && review.genericLinks.length < 8; g++) {
      const lt = txt(links[g]!);
      if (lt && GENERIC.test(lt)) review.genericLinks.push({ selector: cssPath(links[g]!), text: lt });
    }
  } catch {
    /* 무시 */
  }

  return {
    title: (document.title || "").trim(),
    navLinks,
    hasSearch,
    hasSitemap,
    hasMedia: !!document.querySelector("video, audio"),
    review,
  };
}
