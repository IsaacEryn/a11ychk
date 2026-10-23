/**
 * axe 실행 실패 E2E — 사이트 스크립트 때문에 axe-core 내부에서 오류가 나는 페이지를 실제
 * 크로미엄으로 검사한다. 최상위 문서가 실패하면 위반 0의 '정상' 결과가 아니라 검사 실패로
 * 나와야 하고, 하위 iframe 하나의 실패는 그 프레임만 건너뛰어야 한다.
 *
 * 재현 방식: newTarget(세 번째 인자)을 무시하는 Reflect.construct 폴리필. axe의 VirtualNode는
 * 상속 클래스라 Reflect.construct(부모, 인자, VirtualNode)로 만들어지는데, newTarget이 버려지면
 * 부모(AbstractVirtualNode) 인스턴스가 되어 axe.run이 매번
 * `VirtualNode class must have a "props" object ...` 오류를 낸다. 실제 사이트에서 본 오류와 같다.
 */
import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Browser } from "playwright-core";
import { AxeRunError, runAxeOnPage } from "../src/scanner/runAxe";
import { scanUrls } from "../src/scanner/scanUrls";

const BROKEN_REFLECT_CONSTRUCT = `<script>
  Reflect.construct = function (Target, args) {
    return new (Function.prototype.bind.apply(Target, [null].concat(Array.prototype.slice.call(args))))();
  };
</script>`;

// 최상위 문서 — 폴리필이 있다. 검사되면 image-alt 위반이 나와야 하는 페이지다
const BROKEN_MAIN = `<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8"><title>깨진 폴리필</title>
${BROKEN_REFLECT_CONSTRUCT}</head>
<body><main><h1>본문</h1><img src="/x.png"></main></body></html>`;

// 폴리필은 iframe 안에만 있고 최상위 문서는 정상 — 최상위의 image-alt는 그대로 나와야 한다
const BROKEN_CHILD_DOC = `<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8"><title>위젯</title>
${BROKEN_REFLECT_CONSTRUCT}</head><body><p>위젯</p></body></html>`;
const MAIN_WITH_BROKEN_CHILD = `<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8"><title>정상 페이지</title></head>
<body><main><h1>본문</h1><img src="/x.png">
<iframe title="위젯" width="300" height="100" src="/broken-child"></iframe></main></body></html>`;

const PAGES: Record<string, string> = {
  "/broken-main": BROKEN_MAIN,
  "/broken-child": BROKEN_CHILD_DOC,
  "/main-with-broken-child": MAIN_WITH_BROKEN_CHILD,
};

let server: Server;
let origin: string;
let browser: Browser;

beforeAll(async () => {
  server = createServer((req, res) => {
    const body = PAGES[req.url ?? ""];
    res.statusCode = body ? 200 : 404;
    res.setHeader("content-type", "text/html; charset=utf-8");
    res.end(body ?? "");
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

async function scan(path: string) {
  const page = await browser.newPage();
  try {
    await page.goto(`${origin}${path}`, { waitUntil: "load" });
    return await runAxeOnPage(page);
  } finally {
    await page.close();
  }
}

describe("axe 실행 실패 E2E", () => {
  it("최상위 문서에서 axe가 실패하면 위반 0이 아니라 AxeRunError를 던진다", async () => {
    const err = await scan("/broken-main").catch((e) => e);
    expect(err).toBeInstanceOf(AxeRunError);
    expect(err.message).toContain('VirtualNode class must have a "props" object');
  });

  it("scanUrls는 그 페이지를 실패 목록(failedUrls)에 사유와 함께 올린다(웹·Action·MCP 공통 경로)", async () => {
    const { chromium } = await import("playwright");
    const { pages, failedUrls } = await scanUrls([`${origin}/broken-main`, `${origin}/main-with-broken-child`], {
      launch: () => chromium.launch({ headless: true }),
      maxUrls: 5,
      settleMs: 0,
    });
    expect(pages.map((p) => p.url)).toEqual([`${origin}/main-with-broken-child`]);
    expect(failedUrls).toHaveLength(1);
    expect(failedUrls[0]!.url).toBe(`${origin}/broken-main`);
    expect(failedUrls[0]!.reason).toContain("axe-core");
    expect(failedUrls[0]!.reason).toContain("VirtualNode");
  });

  it("하위 iframe 하나에서만 실패하면 그 프레임만 건너뛰고 최상위 문서 결과는 그대로 낸다", async () => {
    const result = await scan("/main-with-broken-child");
    expect(result.violations.map((v) => v.ruleId)).toContain("image-alt");
  });
});
