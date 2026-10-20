/**
 * 하위 프레임 검사 제외 E2E — 광고 iframe과 화면에 그려지지 않는 iframe의 내부 문서는
 * 검사하지 않고, 보이는 iframe은 다른 출처라도 그대로 검사하는지 실제 크로미엄에서 본다.
 * 프레임 문서는 다른 포트(= 다른 출처)에서 내려 AdSense iframe과 같은 조건을 만든다.
 * 프레임 문서에는 lang·title이 없어서, 검사되면 html-has-lang 위반이 하나씩 생긴다.
 *
 * 보안 챌린지 위젯(Turnstile·hCaptcha)은 실제 위젯 주소를 page.route로 가로채 위젯과
 * 같은 꼴의 문서(maximum-scale=1, main·h1 없음)를 내려 준다 — 네트워크에 나가지 않는다.
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

// 위젯 내부 문서 — 검사되면 meta-viewport·landmark-one-main·page-has-heading-one이 나온다
const WIDGET_DOC = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1">
<title>Widget containing a security challenge</title></head>
<body><div><label><input type="checkbox"> Verify you are human</label></div></body></html>`;
const WIDGET_DOC_RULES = ["meta-viewport", "landmark-one-main", "page-has-heading-one"];
const TURNSTILE_SRC = "https://challenges.cloudflare.com/cdn-cgi/challenge-platform/h/b/turnstile/if/ov2/av0/rcv/abc/0x4AAAAAAA/auto/fbE/new/normal";
const HCAPTCHA_SRC = "https://newassets.hcaptcha.com/captcha/v1/abc/static/hcaptcha.html#frame=checkbox";
const WIDGETS = `
  <div class="cf-turnstile"><iframe title="Cloudflare 보안 챌린지가 포함된 위젯" width="300" height="65" src="${TURNSTILE_SRC}"></iframe></div>
  <div class="h-captcha"><iframe title="hCaptcha 보안 챌린지 체크박스 위젯" width="303" height="78" src="${HCAPTCHA_SRC}"></iframe></div>`;
// 제목 없는 위젯 iframe — 요소 자체의 frame-title 검사는 그대로 남아야 한다
const UNTITLED_WIDGET = `<iframe width="300" height="65" src="${TURNSTILE_SRC}"></iframe>`;
// 대조군 — 같은 위젯 문서를 위젯이 아닌 주소에서 내리면 검사된다
const WIDGET_DOC_ELSEWHERE = `<iframe title="위젯 문서를 담은 일반 프레임" width="300" height="65" src="{F}/widget"></iframe>`;

const PAGES: Record<string, string> = {
  "/with-visible": SKIPPED + VISIBLE,
  "/widgets": WIDGETS,
  "/untitled-widget": UNTITLED_WIDGET,
  "/widget-doc-elsewhere": WIDGET_DOC_ELSEWHERE,
};

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
  frameServer = createServer((req, res) => {
    res.setHeader("content-type", "text/html; charset=utf-8");
    res.end(req.url === "/widget" ? WIDGET_DOC : FRAME_DOC);
  });
  frameOrigin = await listen(frameServer);
  mainServer = createServer((req, res) => {
    res.setHeader("content-type", "text/html; charset=utf-8");
    res.end(mainDoc(frameOrigin, PAGES[req.url ?? ""] ?? SKIPPED));
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
  // 실제 위젯 주소는 가로채서 위젯 꼴 문서로 응답 — 다른 출처 프레임 조건은 그대로다
  await page.route(/^https:\/\/(challenges\.cloudflare\.com|newassets\.hcaptcha\.com)\//, (route) =>
    route.fulfill({ contentType: "text/html; charset=utf-8", body: WIDGET_DOC }),
  );
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

  it("보안 챌린지 위젯(Turnstile·hCaptcha) iframe의 내부 문서는 위반으로 세지 않는다", async () => {
    const result = await scan("/widgets");
    const ids = result.violations.map((v) => v.ruleId);
    for (const rule of WIDGET_DOC_RULES) expect(ids).not.toContain(rule);
  });

  it("위젯 iframe 요소 자체의 검사(frame-title)는 그대로 남는다", async () => {
    const result = await scan("/untitled-widget");
    expect(result.violations.map((v) => v.ruleId)).toContain("frame-title");
  });

  it("같은 위젯 문서라도 위젯이 아닌 주소에서 오면 검사한다(대조군)", async () => {
    const result = await scan("/widget-doc-elsewhere");
    expect(result.violations.map((v) => v.ruleId)).toContain("meta-viewport");
  });
});
