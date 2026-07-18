/**
 * 2-패스 안정성 필터 E2E — 렌더링 과도 상태 오탐을 실제 크로미엄에서 재현한다.
 * fixture는 axe.run 2번째 호출 직전에 저대비 색을 안정 상태 색으로 고쳐,
 * "1차 패스에서는 위반, 확정 패스에서는 정상"인 페이드인 시나리오를 결정론적으로
 * 흉내낸다 (실제 페이드인은 타이밍이 비결정적이라 테스트로 부적합).
 */
import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Browser } from "playwright-core";
import { runAxeOnPage } from "../src/scanner/runAxe";

/** axe 주입을 감시하다가 run 2번째 호출 직전에 대상 색을 고치는 훅 */
const FIX_ON_SECOND_RUN = `<script>
  (function () {
    var iv = setInterval(function () {
      if (!window.axe || window.__hooked) return;
      window.__hooked = true;
      clearInterval(iv);
      var orig = window.axe.run.bind(window.axe);
      var calls = 0;
      window.axe.run = function () {
        calls += 1;
        if (calls >= 2) {
          var el = document.getElementById("transient");
          if (el) el.style.color = "#1c2422"; // 안정 상태(충분한 대비)
        }
        return orig.apply(null, arguments);
      };
    }, 1);
  })();
</script>`;

// 과도 상태 요소 + 항상 저대비인 요소가 공존 — 노드 수준 필터 검증
const FIXTURE_MIXED = `<!DOCTYPE html>
<html lang="ko"><head><meta charset="utf-8"><title>Mixed</title></head>
<body>
  <main><h1>혼합</h1>
    <p id="transient" style="color:#c1c1bd;background:#ffffff;">페이드인 과도 상태 텍스트</p>
    <p id="always-bad" style="color:#bbbbbb;background:#ffffff;">항상 저대비 텍스트</p>
  </main>
  ${FIX_ON_SECOND_RUN}
</body></html>`;

// 과도 상태 요소가 유일한 위반 — 규칙 전체 강등(incomplete) 검증
const FIXTURE_TRANSIENT_ONLY = `<!DOCTYPE html>
<html lang="ko"><head><meta charset="utf-8"><title>Transient</title></head>
<body>
  <main><h1>과도 상태만</h1>
    <p id="transient" style="color:#c1c1bd;background:#ffffff;">페이드인 과도 상태 텍스트</p>
  </main>
  ${FIX_ON_SECOND_RUN}
</body></html>`;

let server: Server;
let origin: string;
let browser: Browser;

beforeAll(async () => {
  server = createServer((req, res) => {
    res.setHeader("content-type", "text/html; charset=utf-8");
    res.end(req.url === "/mixed" ? FIXTURE_MIXED : FIXTURE_TRANSIENT_ONLY);
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

describe("2-패스 안정성 필터 E2E", () => {
  it("과도 상태 노드만 걸러내고 안정 위반 노드는 유지한다", async () => {
    const page = await browser.newPage();
    await page.goto(`${origin}/mixed`, { waitUntil: "load" });
    const result = await runAxeOnPage(page);
    await page.close();

    const contrast = result.violations.find((v) => v.ruleId === "color-contrast");
    expect(contrast).toBeDefined();
    const selectors = contrast!.nodes.map((n) => n.selector);
    expect(selectors).toContain("#always-bad");
    expect(selectors).not.toContain("#transient");
  });

  it("과도 상태가 유일한 위반이면 규칙을 '검토 필요'로 강등한다", async () => {
    const page = await browser.newPage();
    await page.goto(`${origin}/transient-only`, { waitUntil: "load" });
    const result = await runAxeOnPage(page);
    await page.close();

    expect(result.violations.map((v) => v.ruleId)).not.toContain("color-contrast");
    expect(result.incomplete).toContain("color-contrast");
  });
});
