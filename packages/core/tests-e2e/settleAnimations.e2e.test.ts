/**
 * 유한 애니메이션 종료 대기 E2E — 실제 크로미엄에서 CSS 페이드인이 끝난 뒤에 axe 1차
 * 패스가 도는지 확인한다. 페이드인은 steps(1, end)로 끝나기 직전까지 저대비 색을 유지해,
 * 대기가 없으면 1차·확정 패스가 모두 과도 상태를 재서 위반으로 확정되는 경우(2-패스 필터의
 * 빈틈)를 결정론적으로 만든다.
 */
import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Browser } from "playwright-core";
import { runAxeOnPage } from "../src/scanner/runAxe";
import { ANIMATION_SETTLE_CAP_MS, settleAnimations } from "../src/scanner/settleAnimations";

/** axe.run 첫 호출 시점의 #fade 글자색을 기록하는 훅 */
const RECORD_FIRST_RUN = `<script>
  (function () {
    var iv = setInterval(function () {
      if (!window.axe || window.__hooked) return;
      window.__hooked = true;
      clearInterval(iv);
      var orig = window.axe.run.bind(window.axe);
      window.axe.run = function () {
        if (window.__firstRunColor === undefined) {
          var el = document.getElementById("fade");
          window.__firstRunColor = el ? getComputedStyle(el).color : null;
        }
        return orig.apply(null, arguments);
      };
    }, 1);
  })();
</script>`;

// 1초 페이드인(끝나기 전까지 #c8c8c8 — 흰 바탕 대비 약 1.7:1), 끝 상태는 #1c2422
const FIXTURE_FADE_IN = `<!DOCTYPE html>
<html lang="ko"><head><meta charset="utf-8"><title>Fade</title>
<style>
  @keyframes fade-in { from { color: #c8c8c8; } to { color: #1c2422; } }
  #fade { background: #ffffff; color: #1c2422; animation: fade-in 1000ms steps(1, end); }
</style></head>
<body>
  <main><h1>페이드인</h1><p id="fade">천천히 나타나는 본문 텍스트</p></main>
  ${RECORD_FIRST_RUN}
</body></html>`;

// 무한 반복 스피너만 있는 페이지 — 기다리지 않아야 한다
const FIXTURE_INFINITE = `<!DOCTYPE html>
<html lang="ko"><head><meta charset="utf-8"><title>Spinner</title>
<style>
  @keyframes spin { to { transform: rotate(360deg); } }
  #spinner { width: 20px; height: 20px; animation: spin 800ms linear infinite; }
</style></head>
<body><main><h1>스피너</h1><div id="spinner"></div></main></body></html>`;

// 상한보다 긴 유한 애니메이션 — 상한에서 끊고 넘어가야 한다
const FIXTURE_LONG = `<!DOCTYPE html>
<html lang="ko"><head><meta charset="utf-8"><title>Long</title>
<style>
  @keyframes slide { from { transform: translateX(-20px); } to { transform: none; } }
  #slow { animation: slide 20s linear; }
</style></head>
<body><main><h1>긴 애니메이션</h1><p id="slow">느린 슬라이드</p></main></body></html>`;

let server: Server;
let origin: string;
let browser: Browser;

beforeAll(async () => {
  server = createServer((req, res) => {
    res.setHeader("content-type", "text/html; charset=utf-8");
    if (req.url === "/infinite") res.end(FIXTURE_INFINITE);
    else if (req.url === "/long") res.end(FIXTURE_LONG);
    else res.end(FIXTURE_FADE_IN);
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

describe("유한 애니메이션 종료 대기 E2E", () => {
  it("페이드인이 끝난 뒤에 1차 패스를 돌려 과도 상태 대비를 재지 않는다", async () => {
    const page = await browser.newPage();
    await page.goto(`${origin}/fade`, { waitUntil: "load" });
    const result = await runAxeOnPage(page);
    const firstRunColor = await page.evaluate(() => (window as unknown as { __firstRunColor?: string }).__firstRunColor);
    await page.close();

    expect(firstRunColor).toBe("rgb(28, 36, 34)");
    expect(result.violations.map((v) => v.ruleId)).not.toContain("color-contrast");
  });

  it("무한 반복 애니메이션은 기다리지 않는다", async () => {
    const page = await browser.newPage();
    await page.goto(`${origin}/infinite`, { waitUntil: "load" });
    const started = Date.now();
    await settleAnimations(page);
    const elapsed = Date.now() - started;
    await page.close();

    expect(elapsed).toBeLessThan(500);
  });

  it("상한보다 긴 유한 애니메이션은 상한에서 끊는다", async () => {
    const page = await browser.newPage();
    await page.goto(`${origin}/long`, { waitUntil: "load" });
    const started = Date.now();
    await settleAnimations(page);
    const elapsed = Date.now() - started;
    await page.close();

    expect(elapsed).toBeGreaterThanOrEqual(ANIMATION_SETTLE_CAP_MS - 100);
    expect(elapsed).toBeLessThan(ANIMATION_SETTLE_CAP_MS + 1_000);
  });
});
