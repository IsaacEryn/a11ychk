/**
 * URL 목록 스캔 루프 — 브라우저를 받아 페이지를 열고 runAxeOnPage를 돌린다.
 *
 * GitHub Action과 MCP 서버가 같은 루프를 쓴다. 브라우저 실행(launch)은 환경마다
 * 다르므로(액션은 playwright, 웹앱은 @sparticuz/chromium) 여기서는 launch 함수를
 * 주입받고 playwright-core 타입만 쓴다 — core에 playwright 하드 의존을 만들지 않는
 * 기존 원칙(runAxe와 동일) 유지.
 *
 * console 출력은 하지 않는다 — MCP 서버는 stdout이 JSON-RPC 채널이라 오염되면
 * 프로토콜이 깨진다. 진행 표시가 필요한 호출부는 onResult 콜백으로 받는다.
 */
import type { Browser } from "playwright-core";
import type { PageScanResult } from "../types";
import { runAxeOnPage } from "./runAxe";

export interface ScanUrlsOptions {
  launch: () => Promise<Browser>;
  /** 검사할 최대 URL 수 — 초과분은 잘라낸다 (CI 시간·클라이언트 타임아웃 보호) */
  maxUrls: number;
  /** URL 하나가 끝날 때마다 호출 (성공/실패 진행 표시용) */
  onResult?: (url: string, ok: boolean, reason?: string) => void;
  /** 페이지 로드 타임아웃 (기본 60초) */
  gotoTimeoutMs?: number;
  /** 로드 후 렌더 안정화 대기 (기본 500ms — 늦은 렌더 흡수) */
  settleMs?: number;
}

export interface ScanUrlsResult {
  pages: PageScanResult[];
  failedUrls: { url: string; reason: string }[];
}

export async function scanUrls(urls: string[], options: ScanUrlsOptions): Promise<ScanUrlsResult> {
  const gotoTimeout = options.gotoTimeoutMs ?? 60_000;
  const settle = options.settleMs ?? 500;

  const browser = await options.launch();
  const pages: PageScanResult[] = [];
  const failedUrls: { url: string; reason: string }[] = [];
  try {
    for (const url of urls.slice(0, options.maxUrls)) {
      const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: "ko-KR" });
      const page = await context.newPage();
      try {
        await page.goto(url, { waitUntil: "load", timeout: gotoTimeout });
        await page.waitForTimeout(settle);
        pages.push(await runAxeOnPage(page));
        options.onResult?.(url, true);
      } catch (e) {
        const reason = ((e as Error).message ?? "unknown").split("\n")[0]!.slice(0, 200);
        failedUrls.push({ url, reason });
        options.onResult?.(url, false, reason);
      } finally {
        await context.close().catch(() => undefined);
      }
    }
  } finally {
    await browser.close().catch(() => undefined);
  }

  return { pages, failedUrls };
}
