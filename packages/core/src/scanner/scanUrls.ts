/**
 * URL 목록 스캔 루프 — 브라우저를 받아 페이지를 열고 runAxeOnPage를 돌린다.
 *
 * GitHub Action과 MCP 서버가 같은 루프를 쓴다. 브라우저 실행(launch)은 환경마다
 * 다르므로 여기서는 launch 함수를 주입받고 playwright-core 타입만 쓴다 — core에
 * playwright 하드 의존을 만들지 않는 기존 원칙(runAxe와 동일) 유지.
 *
 * 웹 정식 검사는 이 루프를 쓰지 않는다. 서브리소스마다 SSRF 차단 route 훅이 필요하고
 * 메모리 때문에 이미지·미디어를 받지 않아서, apps/web의 scanSinglePage가 페이지를 따로
 * 연다(load 대기 상한 8초 + 웹폰트 대기 3초, settle 없음). 페이지를 연 뒤의 검사
 * (runAxeOnPage)와 집계(aggregateScan + siteLevelOptions)는 같다.
 *
 * console 출력은 하지 않는다 — MCP 서버는 stdout이 JSON-RPC 채널이라 오염되면
 * 프로토콜이 깨진다. 진행 표시가 필요한 호출부는 onResult 콜백으로 받는다.
 */
import type { Browser } from "playwright-core";
import type { PageScanResult, PageSignature } from "../types";
import { runAxeOnPage } from "./runAxe";
import { getRawSource } from "./rawSource";
import { extractPageSignature } from "./signature";

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
  /**
   * 검사에 성공한 페이지의 시그니처(제목·내비게이션·미디어 유무). 추출에 실패한 페이지는 빠진다.
   * aggregateScan에 siteLevelOptions(signatures, pages.length)로 넘겨야 웹 보고서와 준수율이 같다.
   */
  signatures: PageSignature[];
}

export async function scanUrls(urls: string[], options: ScanUrlsOptions): Promise<ScanUrlsResult> {
  const gotoTimeout = options.gotoTimeoutMs ?? 60_000;
  const settle = options.settleMs ?? 500;

  const browser = await options.launch();
  const pages: PageScanResult[] = [];
  const failedUrls: { url: string; reason: string }[] = [];
  const signatures: PageSignature[] = [];
  try {
    for (const url of urls.slice(0, options.maxUrls)) {
      const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: "ko-KR" });
      const page = await context.newPage();
      try {
        const response = await page.goto(url, { waitUntil: "load", timeout: gotoTimeout });
        await page.waitForTimeout(settle);
        // 시그니처는 뷰포트 변경(리플로우 검사) 전에 추출 — 웹 scanSinglePage와 같은 순서
        const signature = await extractPageSignature(page).catch(() => null);
        // 마크업 유효성 검사용 원본 소스 (확보 실패 시 null — 해당 검사만 생략)
        const rawHtml = await getRawSource(page.url(), response);
        pages.push(await runAxeOnPage(page, { rawHtml }));
        // 검사에 성공한 페이지의 시그니처만 — 실패한 페이지가 섞이면 '해당 없음' 판단이 틀어진다
        if (signature) signatures.push(signature);
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

  return { pages, failedUrls, signatures };
}
