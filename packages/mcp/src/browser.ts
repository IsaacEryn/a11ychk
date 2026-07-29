/**
 * chromium 확보 — 게으른(lazy) 검사.
 *
 * 서버 기동 시에는 브라우저를 확인하지 않는다. 카탈로그·표본 수집 도구는 브라우저
 * 없이 동작해야 하고, MCP 클라이언트의 서버 기동 타임아웃 안에 무거운 일을 하면
 * 안 되기 때문이다. scan 도구가 처음 호출될 때 시도한다.
 *
 * playwright-core를 쓰므로(브라우저 자동 다운로드 없음 — npx 첫 실행을 가볍게)
 * 브라우저가 없을 수 있다. 그 경우 ① 설치된 Chrome(channel)로 폴백하고
 * ② 그것도 없으면 설치 명령을 담은 안내를 던진다 — 명령의 playwright 버전은
 * 번들된 playwright-core 버전과 반드시 일치해야 한다(브라우저 리비전이 버전에
 * 키되어 있어, 다른 버전을 안내하면 엉뚱한 리비전이 설치된다).
 */
import { createRequire } from "node:module";
import { chromium, type Browser } from "playwright-core";

const requireModule = createRequire(import.meta.url);

export function playwrightVersion(): string {
  try {
    return (requireModule("playwright-core/package.json") as { version: string }).version;
  } catch {
    return "latest";
  }
}

/** 마지막으로 실제 사용한 브라우저 출처 — 결과 메타에 표기 (channel 폴백은 결정성이 약간 낮다) */
export let browserSource: "chromium" | "chrome" = "chromium";

/** 진행 중 스캔의 브라우저 — 클라이언트가 stdin을 닫아 죽일 때 고아 방지용 */
let activeBrowser: Browser | null = null;

export class BrowserMissingError extends Error {
  constructor() {
    super(
      [
        "검사용 브라우저(chromium)를 찾지 못했습니다. 아래 명령으로 설치한 뒤 다시 시도해 주세요:",
        "",
        `  npx playwright@${playwrightVersion()} install chromium`,
        "",
        "카탈로그 조회(get_fix_guide, kwcag_checkpoint)와 표본 수집(crawl_sample)은 브라우저 없이 동작합니다.",
      ].join("\n"),
    );
    this.name = "BrowserMissingError";
  }
}

export async function launchBrowser(): Promise<Browser> {
  let browser: Browser;
  try {
    browser = await chromium.launch({ headless: true });
    browserSource = "chromium";
  } catch {
    try {
      // playwright 관리 브라우저가 없으면 설치된 Chrome으로 폴백
      browser = await chromium.launch({ headless: true, channel: "chrome" });
      browserSource = "chrome";
    } catch {
      throw new BrowserMissingError();
    }
  }
  activeBrowser = browser;
  browser.on("disconnected", () => {
    if (activeBrowser === browser) activeBrowser = null;
  });
  return browser;
}

/** 종료 시 진행 중 브라우저 정리 — SIGINT/SIGTERM/stdin EOF에서 호출 */
export async function closeActiveBrowser(): Promise<void> {
  const b = activeBrowser;
  activeBrowser = null;
  if (b) await b.close().catch(() => undefined);
}
