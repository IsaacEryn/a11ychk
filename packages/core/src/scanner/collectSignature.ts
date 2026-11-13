/**
 * 페이지 시그니처 수집기 — 크롬 확장용 함수판.
 *
 * 같은 시그니처(PageSignature에서 url을 뺀 값)를 두 실행 환경이 수집한다:
 * - 서버(웹 정식 검사·티저·Action·MCP): signature.ts의 SIGNATURE_SCRIPT(ES5 문자열)를
 *   playwright evaluate로 상위 문서에서 실행한다.
 * - 크롬 확장: MV3는 문자열 평가를 막으므로 이 함수를 import해 chrome.scripting.executeScript로
 *   상위 프레임에서 실행한다. 소스가 직렬화돼 페이지에서 돌기 때문에 자기 완결이어야 한다
 *   (외부 모듈·클로저 변수 참조 금지). 미디어 임베드 호스트 목록은 args로 넘긴다
 *   (args: [MEDIA_EMBED_HOSTS]) — 서버 스크립트도 같은 상수를 문자열에 끼워 넣으므로 목록은 한 벌이다.
 *
 * collectSignals.ts와 같은 이유로 문자열을 이 함수의 toString()으로 만들지 않는다(검사 핵심
 * 경로가 번들러 변환 결과에 기대지 않게). 대신 tests/signature-parity.test.ts가 두 구현이 같은
 * DOM에서 같은 값을 내는지 확인한다. 한쪽을 고치면 반드시 다른 쪽도 함께 고칠 것.
 *
 * 이 값으로 aggregateScan에 siteLevelOptions를 넘기므로(미디어가 없으면 1.2.x '해당 없음'),
 * 둘이 갈라지면 같은 페이지라도 확장과 웹의 자동 준수율이 달라진다.
 */
import type { PageSignature } from "../types";

/**
 * hasMedia 판정 — 상위 문서에 <video>/<audio>가 있거나, 아래 기준에 드는 미디어 임베드 iframe이
 * 있으면 미디어 있음이다. 미디어 있음이면 1.2.1~1.2.5를 '해당 없음'으로 세지 않는다.
 *
 * iframe 안의 문서는 열어 보지 않고 상위 문서의 iframe 속성만 본다. 하위 프레임 접근은 진입점마다
 * 다르다(웹·Action·MCP의 playwright는 교차 출처 프레임도 들어가고, 확장의 executeScript allFrames는
 * 권한·about:blank·샌드박스 프레임에서 갈린다). 속성만 보면 어느 진입점이든 같은 DOM에서 같은 답이 나온다.
 *
 * 기준(하나라도 맞으면 미디어 임베드):
 * 1. src·data-src·data-lazy-src의 호스트가 MEDIA_EMBED_HOSTS 항목과 같거나 그 하위 도메인이다.
 *    경로가 붙은 항목은 그 경로를 포함할 때만 맞는다(같은 호스트의 좋아요 버튼 등 제외).
 *    지연 로딩 속성을 함께 보는 건, 실제 src로 바뀌는 시점이 스크롤·뷰포트에 따라 진입점마다 달라서다.
 * 2. allow에 미디어 전용 권한 encrypted-media(DRM 재생)나 picture-in-picture(동영상 PIP)가 있다.
 * 3. allow에 autoplay가 있고 전체 화면도 허용한다(allow의 fullscreen 또는 allowfullscreen 속성).
 *    autoplay만 있는 건 알림음을 내는 채팅 위젯 등일 수 있고, 전체 화면만 있는 건 지도·문서·슬라이드
 *    임베드가 흔해서 둘 중 하나만으로는 보지 않는다. 유튜브·비메오·카카오TV 등의 기본 임베드 코드는
 *    autoplay와 전체 화면을 함께 허용한다.
 *
 * 틀리는 방향: 미디어가 아닌데 2·3에 걸리는 임베드(코드 실행 환경 등)는 1.2.x를 '해당 없음'으로 세지
 * 않고 점검자 판정으로 남기므로 준수율을 부풀리지 않는다. 반대로 목록에 없는 호스트이면서 allow도 비운
 * 플레이어, 클릭해야 iframe이 생기는 파사드(lite-youtube 등), 스크립트가 검사 뒤에 넣는 플레이어는 놓친다.
 * 2026-11 실측: 네이버 첫 화면 광고 iframe 11개와 채널톡 위젯 iframe은 allow가 비어 있어 걸리지 않았다.
 */
export const MEDIA_EMBED_HOSTS: readonly string[] = [
  // 동영상 플랫폼 (해외)
  "youtube.com",
  "youtube-nocookie.com",
  "vimeo.com",
  "dailymotion.com",
  "player.twitch.tv",
  "clips.twitch.tv",
  "tiktok.com/embed",
  "tiktok.com/player",
  "facebook.com/plugins/video",
  "wistia.com",
  "wistia.net",
  "brightcove.net",
  "vidyard.com",
  "loom.com",
  "embed.ted.com",
  "streamable.com",
  "jwplayer.com",
  "kaltura.com",
  "videodelivery.net",
  "cloudflarestream.com",
  "player.bilibili.com",
  // 동영상 플랫폼 (국내)
  "tv.naver.com",
  "serviceapi.nmv.naver.com",
  "tv.kakao.com",
  "play-tv.kakao.com",
  "sooplive.co.kr",
  "afreecatv.com",
  // 오디오
  "soundcloud.com",
  "open.spotify.com",
  "embed.podcasts.apple.com",
  "embed.music.apple.com",
];

export function collectPageSignature(mediaEmbedHosts: readonly string[]): Omit<PageSignature, "url"> {
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

  // MEDIA_EMBED_HOSTS 위의 기준 1~3. 서버 SIGNATURE_SCRIPT의 isMediaFrame과 같은 계산
  function isMediaFrame(frame: Element): boolean {
    const feats: Record<string, boolean> = {};
    const allow = (frame.getAttribute("allow") || "").toLowerCase().split(";");
    for (let k = 0; k < allow.length; k++) {
      const name = allow[k]!.trim().split(/\s+/)[0];
      if (name) feats[name] = true;
    }
    if (feats["encrypted-media"] || feats["picture-in-picture"]) return true;
    if (feats["autoplay"] && (feats["fullscreen"] || frame.hasAttribute("allowfullscreen"))) return true;
    const attrs = ["src", "data-src", "data-lazy-src"];
    for (let s = 0; s < attrs.length; s++) {
      const raw = frame.getAttribute(attrs[s]!);
      if (!raw) continue;
      let host = "";
      let path = "";
      try {
        const u = new URL(raw, document.baseURI);
        host = u.hostname.toLowerCase();
        path = u.pathname.toLowerCase();
      } catch {
        continue;
      }
      for (let m = 0; m < mediaEmbedHosts.length; m++) {
        const entry = mediaEmbedHosts[m]!;
        const slash = entry.indexOf("/");
        const eh = slash < 0 ? entry : entry.slice(0, slash);
        const ep = slash < 0 ? "" : entry.slice(slash);
        if ((host === eh || host.slice(-(eh.length + 1)) === "." + eh) && path.indexOf(ep) >= 0) return true;
      }
    }
    return false;
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

  // 미디어 판정은 try로 감싸지 않는다 — 실패하면 시그니처 전체가 null이 되어 '해당 없음' 판단을 보류한다
  let hasMedia = !!document.querySelector("video, audio");
  if (!hasMedia) {
    const frames = document.querySelectorAll("iframe");
    for (let q = 0; q < frames.length; q++) {
      if (isMediaFrame(frames[q]!)) {
        hasMedia = true;
        break;
      }
    }
  }

  return {
    title: (document.title || "").trim(),
    navLinks,
    hasSearch,
    hasSitemap,
    hasMedia,
    review,
  };
}
