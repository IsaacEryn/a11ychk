// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { SIGNATURE_SCRIPT } from "../src/scanner/signature";
import { MEDIA_EMBED_HOSTS, collectPageSignature } from "../src/scanner/collectSignature";
import { siteLevelOptions } from "../src/report/siteChecks";
import type { PageSignature } from "../src/types";

/**
 * 드리프트 방지 골든 테스트 — 서버(SIGNATURE_SCRIPT 문자열, 웹·티저·Action·MCP)와
 * 크롬 확장(collectPageSignature 함수)은 같은 DOM에서 같은 시그니처를 내야 한다.
 * 시그니처의 hasMedia로 1.2.x '해당 없음'을 정하므로, 갈라지면 같은 페이지의 자동 준수율이 달라진다.
 */

type Collected = Omit<PageSignature, "url">;

const FULL = {
  title: "  회사 소개 | 예시  ",
  body: `
  <header>
    <nav aria-label="주 메뉴">
      <a href="#main">본문 바로가기</a>
      <a href="/about">  회사
        소개 </a>
      <a href="/products">제품</a>
      <a>href 없는 앵커</a>
      <a href="/contact"></a>
    </nav>
    <form role="search"><input name="qSearch" placeholder="검색어"></form>
  </header>
  <main id="main">
    <img alt="  회사 연혁을 담은 연대표  " src="/a.png">
    <img alt="" src="/deco.png">
    <div class="card primary"><span class="thumb"><img alt="banner.png" src="/b.png"></span></div>
    <label for="email">이메일 주소</label><input id="email" type="email">
    <input type="hidden" name="token" value="x">
    <input aria-label="  전화번호 ">
    <textarea title="문의 내용"></textarea>
    <label class="wrap">지역 <select><option>서울</option></select></label>
    <input type="text">
    <a href="/detail">자세히 보기</a>
    <a href="/more" class="btn more">더보기</a>
    <a href="/x">Click here</a>
    <svg class="icon"><a href="/svg-link"><text>여기</text></a></svg>
    <audio src="/a.mp3"></audio>
  </main>
  <footer><a href="/site-map">사이트 맵</a></footer>
`,
};

const EMPTY = { title: "", body: `<p>내용만 있는 페이지</p>` };

const PLACEHOLDER_ONLY = {
  title: "검색 결과",
  body: `
  <div role="navigation"><a href="/a">하나</a><a href="/b">둘</a></div>
  <input placeholder="사이트 검색">
  <a href="/sitemap.xml">XML</a>
  <video src="/v.mp4"></video>
`,
};

// 동영상이 유튜브 임베드로만 있는 페이지 — W3C WAI perspective-videos 페이지가 스크립트로 <video>를
// 이 iframe으로 바꿔 넣은 뒤의 상위 문서 모양(2026-11 실측)
const YOUTUBE_ONLY = {
  title: "Video Captions",
  body: `
  <main>
    <h1>Video Captions</h1>
    <div class="able-vidcap-wrapper">
      <iframe title="Web Accessibility Perspectives: Video Captions"
        src="https://www.youtube-nocookie.com/embed/iWO5N3n1DXU?autoplay=0&amp;enablejsapi=1"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
        allowfullscreen></iframe>
    </div>
  </main>
`,
};

// 미디어로 보지 않아야 하는 iframe만 있는 페이지 — 지도·광고·위젯·유사 도메인
const NON_MEDIA_FRAMES = {
  title: "오시는 길",
  body: `
  <iframe title="지도" src="https://www.google.com/maps/embed?pb=xyz" allowfullscreen loading="lazy"></iframe>
  <iframe title="광고" src="https://siape.veta.naver.com/fxshow?su=SU10868"></iframe>
  <iframe title="좋아요" src="https://www.facebook.com/plugins/like.php?href=x"></iframe>
  <iframe title="알림음 위젯" src="https://widget.example.com/chat" allow="autoplay"></iframe>
  <iframe title="유사 도메인" src="https://notyoutube.com/embed/x"></iframe>
  <iframe title="하위 경로 위장" src="https://youtube.com.evil.example/embed/x"></iframe>
  <iframe title="빈 프레임" src="about:blank"></iframe>
  <iframe title="깨진 주소" src="http://["></iframe>
  <iframe title="srcdoc"></iframe>
`,
};

function runBoth(fixture: { title: string; body: string }): { server: Collected; extension: Collected } {
  document.title = fixture.title;
  document.body.innerHTML = fixture.body;
  // SIGNATURE_SCRIPT는 페이지 컨텍스트 평가용 IIFE 문자열 — 같은 DOM에서 eval
  const server = eval(SIGNATURE_SCRIPT) as Collected;
  document.title = fixture.title;
  document.body.innerHTML = fixture.body;
  // 확장은 chrome.scripting.executeScript의 args로 호스트 목록을 넘긴다(scan.ts와 같은 호출)
  const extension = collectPageSignature([...MEDIA_EMBED_HOSTS]);
  return { server, extension };
}

/** iframe 하나만 있는 페이지에서 두 구현의 hasMedia를 함께 돌려준다 */
function frameOnly(attrs: string): { server: boolean; extension: boolean } {
  const { server, extension } = runBoth({ title: "", body: `<iframe ${attrs}></iframe>` });
  return { server: server.hasMedia, extension: extension.hasMedia };
}

describe("서버 SIGNATURE_SCRIPT ↔ 확장 collectPageSignature 패리티", () => {
  it("내비·검색·사이트맵·미디어·확인용 자료가 모두 있는 페이지에서 결과가 같다", () => {
    const { server, extension } = runBoth(FULL);
    expect(extension).toEqual(server);
    // 픽스처가 실제로 각 분기를 지나는지(빈 값끼리 같아서 통과하는 것 방지)
    expect(server.title).toBe("회사 소개 | 예시");
    expect(server.navLinks).toEqual(["본문 바로가기", "회사 소개", "제품"]);
    expect(server.hasSearch).toBe(true);
    expect(server.hasSitemap).toBe(true);
    expect(server.hasMedia).toBe(true);
    expect(server.review?.alts.length).toBe(2);
    expect(server.review?.labels.map((l) => l.text)).toEqual(["이메일 주소", "전화번호", "문의 내용", "지역 서울"]);
    expect(server.review?.genericLinks.length).toBe(4);
  });

  it("아무것도 없는 페이지에서도 결과가 같다", () => {
    const { server, extension } = runBoth(EMPTY);
    expect(extension).toEqual(server);
    expect(server.hasMedia).toBe(false);
    expect(server.navLinks).toEqual([]);
  });

  it("role=navigation·placeholder 검색·href 사이트맵·비디오 분기에서도 결과가 같다", () => {
    const { server, extension } = runBoth(PLACEHOLDER_ONLY);
    expect(extension).toEqual(server);
    expect(server.hasSearch).toBe(true);
    expect(server.hasSitemap).toBe(true);
    expect(server.hasMedia).toBe(true);
  });

  it("유튜브 임베드만 있는 페이지는 두 구현 모두 미디어 있음으로 보고 1.2.x를 '해당 없음'으로 세지 않는다", () => {
    const { server, extension } = runBoth(YOUTUBE_ONLY);
    expect(extension).toEqual(server);
    expect(server.hasMedia).toBe(true);
    const url = "https://www.w3.org/WAI/perspective-videos/captions/";
    expect(siteLevelOptions([{ url, ...server }], 1).notPresentScs).toEqual([]);
    expect(siteLevelOptions([{ url, ...extension }], 1).notPresentScs).toEqual([]);
  });

  it("알려진 미디어 플랫폼 호스트는 allow 속성이 없어도 두 구현 모두 미디어로 본다(하위 도메인 포함)", () => {
    for (const entry of MEDIA_EMBED_HOSTS) {
      const src = entry.includes("/") ? `https://${entry}.php?id=1` : `https://${entry}/embed/1`;
      expect(frameOnly(`src="${src}"`), src).toEqual({ server: true, extension: true });
      const sub = `https://player.${entry}${entry.includes("/") ? "" : "/v/1"}`;
      expect(frameOnly(`src="${sub}"`), sub).toEqual({ server: true, extension: true });
    }
  });

  it("지연 로딩 속성(data-src)과 프로토콜 상대 주소도 같은 기준으로 본다", () => {
    expect(frameOnly(`src="about:blank" data-src="https://player.vimeo.com/video/1"`)).toEqual({
      server: true,
      extension: true,
    });
    expect(frameOnly(`data-lazy-src="https://tv.naver.com/embed/1"`)).toEqual({ server: true, extension: true });
    expect(frameOnly(`src="//www.youtube.com/embed/1"`)).toEqual({ server: true, extension: true });
    expect(frameOnly(`src="HTTPS://WWW.YOUTUBE.COM/embed/1"`)).toEqual({ server: true, extension: true });
  });

  it("호스트를 모르는 플레이어는 allow의 미디어 전용 권한으로 판단한다", () => {
    const unknown = `src="https://media.example.org/player/1"`;
    expect(frameOnly(`${unknown} allow="encrypted-media"`)).toEqual({ server: true, extension: true });
    expect(frameOnly(`${unknown} allow="picture-in-picture *"`)).toEqual({ server: true, extension: true });
    expect(frameOnly(`${unknown} allow="autoplay; fullscreen"`)).toEqual({ server: true, extension: true });
    expect(frameOnly(`${unknown} allow="Autoplay" allowfullscreen`)).toEqual({ server: true, extension: true });
    // autoplay만(알림음 위젯 등)이나 전체 화면만(지도·문서·슬라이드)으로는 미디어로 보지 않는다
    expect(frameOnly(`${unknown} allow="autoplay"`)).toEqual({ server: false, extension: false });
    expect(frameOnly(`${unknown} allow="fullscreen" allowfullscreen`)).toEqual({ server: false, extension: false });
  });

  it("지도·광고·좋아요 버튼·유사 도메인 iframe만 있으면 두 구현 모두 미디어 없음으로 본다", () => {
    const { server, extension } = runBoth(NON_MEDIA_FRAMES);
    expect(extension).toEqual(server);
    expect(server.hasMedia).toBe(false);
    expect(siteLevelOptions([{ url: "https://example.com/", ...server }], 1).notPresentScs).toHaveLength(5);
  });

  it("확장 시그니처로 만든 단일 페이지 옵션이 서버 시그니처의 옵션과 같다", () => {
    for (const fixture of [FULL, EMPTY, PLACEHOLDER_ONLY, YOUTUBE_ONLY, NON_MEDIA_FRAMES]) {
      const { server, extension } = runBoth(fixture);
      const url = "https://example.com/";
      expect(siteLevelOptions([{ url, ...extension }], 1)).toEqual(siteLevelOptions([{ url, ...server }], 1));
    }
    const { extension } = runBoth(EMPTY);
    expect(siteLevelOptions([{ url: "https://example.com/", ...extension }], 1).notPresentScs).toEqual([
      "1.2.1",
      "1.2.2",
      "1.2.3",
      "1.2.4",
      "1.2.5",
    ]);
  });
});
