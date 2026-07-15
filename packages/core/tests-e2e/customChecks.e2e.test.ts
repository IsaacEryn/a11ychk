/**
 * 자체 커스텀 검사 + 시그니처 추출 E2E — 페이지 컨텍스트 문자열 스크립트가
 * 실제 크로미엄에서 오류 없이 실행되고 의도한 항목을 검출하는지 검증한다.
 */
import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Browser } from "playwright-core";
import { runCustomChecks } from "../src/scanner/customChecks";
import { extractPageSignature } from "../src/scanner/signature";

const FIXTURE = `<!DOCTYPE html>
<html lang="ko">
<head><meta charset="utf-8"><title>커스텀 검사 fixture</title></head>
<body>
  <nav><a href="/a">회사소개</a><a href="/b">제품</a><a href="/sitemap">사이트맵</a></nav>
  <img src="x.png" alt="회사 사옥 전경">
  <img src="y.png" alt="photo01.jpg"><!-- alt 파일명: a11ychk:alt-quality 위반 -->
  <img src="z.png" alt="이미지"><!-- 일반어 alt: 확인 필요 -->
  <label for="q">검색어</label><input id="q" type="search">
  <a href="/more">더보기</a><!-- 일반어 링크: a11ychk:link-text 확인 필요 -->
  <a href="/jobs">채용 공고 자세히 안내</a>
  <div onclick="alert(1)">클릭 영역</div><!-- a11ychk:keyboard-clickable 위반 -->
  <button style="display:block;width:10px;height:10px;padding:0;border:0"></button><!-- a11ychk:target-size -->
</body></html>`;

let server: Server;
let origin: string;
let browser: Browser;

beforeAll(async () => {
  server = createServer((req, res) => {
    res.setHeader("content-type", "text/html; charset=utf-8");
    res.end(FIXTURE);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  origin = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;

  const { chromium } = await import("playwright");
  browser = await chromium.launch({ headless: true });
});

afterAll(async () => {
  await browser?.close();
  server?.close();
});

describe("커스텀 검사·시그니처 E2E", () => {
  it("커스텀 검사가 alt 파일명·키보드·타깃 크기·링크 텍스트를 검출한다", async () => {
    const page = await browser.newPage();
    await page.goto(`${origin}/`, { waitUntil: "load" });
    const result = await runCustomChecks(page);
    await page.close();

    const violationIds = result.violations.map((v) => v.ruleId);
    expect(violationIds).toContain("a11ychk:alt-quality"); // photo01.jpg
    expect(violationIds).toContain("a11ychk:keyboard-clickable");
    const altViolation = result.violations.find((v) => v.ruleId === "a11ychk:alt-quality");
    expect(altViolation?.nodes[0]?.failureSummary).toContain("photo01.jpg");

    expect(result.incomplete).toContain("a11ychk:alt-quality"); // 일반어 "이미지"
    expect(result.incomplete).toContain("a11ychk:link-text"); // "더보기"
    expect(result.incomplete).toContain("a11ychk:target-size"); // 10×10 버튼
  });

  it("시그니처가 제목·내비·검색·확인용 수집 자료를 추출한다", async () => {
    const page = await browser.newPage();
    await page.goto(`${origin}/`, { waitUntil: "load" });
    const sig = await extractPageSignature(page);
    await page.close();

    expect(sig.title).toBe("커스텀 검사 fixture");
    expect(sig.navLinks).toContain("회사소개");
    expect(sig.hasSearch).toBe(true);
    expect(sig.hasSitemap).toBe(true);
    expect(sig.hasMedia).toBe(false);
    expect(sig.review?.alts.map((a) => a.text)).toContain("회사 사옥 전경");
    expect(sig.review?.labels.map((l) => l.text)).toContain("검색어");
    expect(sig.review?.genericLinks.map((g) => g.text)).toContain("더보기");
    expect(sig.review?.genericLinks.map((g) => g.text)).not.toContain("채용 공고 자세히 안내");
  });
});
