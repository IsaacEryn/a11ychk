/**
 * 하위 프레임 검사 제외 E2E — 광고 iframe과 화면에 그려지지 않는 iframe의 내부 문서는
 * 검사하지 않고, 보이는 iframe은 다른 출처라도 그대로 검사하는지 실제 크로미엄에서 본다.
 * 프레임 문서는 다른 포트(= 다른 출처)에서 내려 AdSense iframe과 같은 조건을 만든다.
 * 프레임 문서에는 lang·title이 없어서, 검사되면 html-has-lang 위반이 하나씩 생긴다.
 */
import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Browser } from "playwright-core";
import { runAxeOnPage } from "../src/scanner/runAxe";

const FRAME_DOC = `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body><p>프레임 안 글</p></body></html>`;

const mainDoc = (frameOrigin: string, frames: string) => `<!DOCTYPE html>
<html lang="ko"><head><meta charset="utf-8"><title>Frames</title></head>
<body><main><h1>프레임</h1>${frames.replaceAll("{F}", frameOrigin)}</main></body></html>`;

// 건너뛸 프레임 셋: display:none, 광고 컨테이너 안, 0×0
const SKIPPED = `
  <iframe title="숨은 프레임" style="display:none" src="{F}/frame"></iframe>
  <ins class="adsbygoogle" style="display:block;width:300px;height:100px">
    <iframe id="aswift_0" title="Advertisement" width="300" height="100" src="{F}/frame"></iframe>
  </ins>
  <iframe title="0x0 프레임" width="0" height="0" style="border:0" src="{F}/frame"></iframe>`;
const VISIBLE = `<iframe title="보이는 프레임" width="300" height="100" src="{F}/frame"></iframe>`;

let mainServer: Server;
let frameServer: Server;
let mainOrigin: string;
let frameOrigin: string;
let browser: Browser;

async function listen(server: Server): Promise<string> {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  return `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
}

beforeAll(async () => {
  frameServer = createServer((_req, res) => {
    res.setHeader("content-type", "text/html; charset=utf-8");
    res.end(FRAME_DOC);
  });
  frameOrigin = await listen(frameServer);
  mainServer = createServer((req, res) => {
    res.setHeader("content-type", "text/html; charset=utf-8");
    res.end(mainDoc(frameOrigin, req.url === "/with-visible" ? SKIPPED + VISIBLE : SKIPPED));
  });
  mainOrigin = await listen(mainServer);

  const { chromium } = await import("playwright");
  browser = await chromium.launch({ headless: true });
});

afterAll(async () => {
  await browser?.close();
  mainServer?.close();
  frameServer?.close();
});

async function scan(path: string) {
  const page = await browser.newPage();
  await page.goto(`${mainOrigin}${path}`, { waitUntil: "load" });
  const result = await runAxeOnPage(page);
  await page.close();
  return result;
}

describe("하위 프레임 검사 제외 E2E", () => {
  it("광고·숨은·0×0 프레임의 내부 문서는 위반으로 세지 않는다", async () => {
    const result = await scan("/skipped-only");
    const ids = result.violations.map((v) => v.ruleId);
    expect(ids).not.toContain("html-has-lang");
    expect(ids).not.toContain("document-title");
  });

  it("보이는 다른 출처 프레임은 그대로 검사한다(위반 하나)", async () => {
    const result = await scan("/with-visible");
    const lang = result.violations.find((v) => v.ruleId === "html-has-lang");
    expect(lang).toBeDefined();
    expect(lang!.nodes).toHaveLength(1);
  });
});
