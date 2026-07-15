/**
 * 스캔 엔진 E2E — 의도적 위반이 심긴 fixture 페이지를 실제 크로미엄으로 스캔해
 * 크롤러(collectPages) → 스캐너(runAxeOnPage) → 집계(aggregateScan) 전 구간을 검증한다.
 */
import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Browser } from "playwright-core";
import { collectPages } from "../src/crawler/collectPages";
import { runAxeOnPage, AXE_VERSION } from "../src/scanner/runAxe";
import { aggregateScan } from "../src/report/aggregate";

const FIXTURE_HOME = `<!DOCTYPE html>
<html><!-- lang 누락: html-has-lang -->
<head><meta charset="utf-8"><title>Fixture Home</title></head>
<body>
  <img src="logo.png"><!-- alt 누락: image-alt -->
  <p style="color:#bbbbbb;background:#ffffff;">저대비 텍스트입니다.</p><!-- color-contrast -->
  <button></button><!-- button-name -->
  <input type="text"><!-- label -->
  <a href="/about">소개</a>
  <a href="/contact">문의</a>
</body></html>`;

const FIXTURE_SUB = `<!DOCTYPE html>
<html lang="ko">
<head><meta charset="utf-8"><title>Sub</title></head>
<body><main><h1>정상 페이지</h1><p>본문</p></main></body></html>`;

let server: Server;
let origin: string;
let browser: Browser;

beforeAll(async () => {
  server = createServer((req, res) => {
    res.setHeader("content-type", "text/html; charset=utf-8");
    res.end(req.url === "/" ? FIXTURE_HOME : FIXTURE_SUB);
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

describe("스캔 엔진 E2E", () => {
  it("크롤러가 내부 링크에서 대표 페이지를 수집한다", async () => {
    // localhost는 SSRF 가드에 막히므로(정상 동작) 테스트에서는 일반 fetch 주입
    const crawl = await collectPages(`${origin}/`, { maxPages: 3, fetcher: (u) => fetch(u) });
    expect(crawl.urls[0]).toBe(`${origin}/`);
    expect(crawl.urls.length).toBe(3);
    expect(crawl.source).toBe("links");
  });

  it("의도된 위반을 모두 검출하고 KWCAG 매트릭스에 반영한다", async () => {
    const page = await browser.newPage();
    await page.goto(`${origin}/`, { waitUntil: "load" });
    const result = await runAxeOnPage(page);
    await page.close();

    const ruleIds = result.violations.map((v) => v.ruleId);
    expect(ruleIds).toContain("image-alt");
    expect(ruleIds).toContain("html-has-lang");
    expect(ruleIds).toContain("color-contrast");
    expect(ruleIds).toContain("button-name");
    expect(ruleIds).toContain("label");

    const imageAlt = result.violations.find((v) => v.ruleId === "image-alt");
    expect(imageAlt?.impact).toBe("critical");
    expect(imageAlt?.nodes[0]?.html).toContain("<img");
    expect(imageAlt?.nodes[0]?.selector).toBeTruthy();

    const summary = aggregateScan([result], AXE_VERSION);
    expect(summary.totalViolations).toBeGreaterThanOrEqual(5);
    expect(summary.kwcagMatrix.find((r) => r.itemId === "5.1.1")?.status).toBe("fail"); // 대체 텍스트
    expect(summary.kwcagMatrix.find((r) => r.itemId === "7.1.1")?.status).toBe("fail"); // 기본 언어
    expect(summary.kwcagMatrix.find((r) => r.itemId === "5.4.1")?.status).toBe("fail"); // 명도 대비
    expect(summary.complianceRate).toBeGreaterThan(0);
    expect(summary.complianceRate).toBeLessThan(100);
  });

  it("무거운 리소스(이미지 등)를 차단해도 위반 검출은 동일하다", async () => {
    // runScan의 메모리 절약 차단과 동일한 조건 재현
    const page = await browser.newPage();
    await page.route("**/*", (route) => {
      const type = route.request().resourceType();
      if (type === "image" || type === "media" || type === "font") return route.abort();
      return route.continue();
    });
    await page.goto(`${origin}/`, { waitUntil: "load" });
    const result = await runAxeOnPage(page);
    await page.close();

    const ruleIds = result.violations.map((v) => v.ruleId);
    expect(ruleIds).toContain("image-alt"); // 이미지 바이트 없이도 DOM 기반 검출 유지
    expect(ruleIds).toContain("color-contrast");
    expect(ruleIds).toContain("html-has-lang");
  });

  it("정상 페이지에서는 해당 위반이 없다", async () => {
    const page = await browser.newPage();
    await page.goto(`${origin}/about`, { waitUntil: "load" });
    const result = await runAxeOnPage(page);
    await page.close();

    const ruleIds = result.violations.map((v) => v.ruleId);
    expect(ruleIds).not.toContain("image-alt");
    expect(ruleIds).not.toContain("html-has-lang");
    expect(result.passes.length).toBeGreaterThan(10);
  });
});
