// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { SIGNATURE_SCRIPT } from "../src/scanner/signature";
import { collectPageSignature } from "../src/scanner/collectSignature";
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

function runBoth(fixture: { title: string; body: string }): { server: Collected; extension: Collected } {
  document.title = fixture.title;
  document.body.innerHTML = fixture.body;
  // SIGNATURE_SCRIPT는 페이지 컨텍스트 평가용 IIFE 문자열 — 같은 DOM에서 eval
  const server = eval(SIGNATURE_SCRIPT) as Collected;
  document.title = fixture.title;
  document.body.innerHTML = fixture.body;
  const extension = collectPageSignature();
  return { server, extension };
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

  it("확장 시그니처로 만든 단일 페이지 옵션이 서버 시그니처의 옵션과 같다", () => {
    for (const fixture of [FULL, EMPTY, PLACEHOLDER_ONLY]) {
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
