import "server-only";
import type { Browser } from "playwright-core";

/**
 * DNS rebinding 방어용 host-resolver 규칙 생성.
 * 대상 호스트를 검증된 공개 IP로 고정해, 브라우저가 자체 DNS를 재조회하며
 * 사설 IP로 rebinding되는 것을 최상위 문서 수준에서 차단한다.
 * (guardedFetch가 undici lookup으로 하는 IP 핀의 브라우저 등가물)
 */
export function buildHostResolverRule(hostname: string, vettedIp: string): string {
  // MAP <host> <ip> — 정확히 이 호스트만 검증 IP로 강제. localhost 등은 제외 유지.
  return `MAP ${hostname} ${vettedIp}`;
}

/**
 * 환경별 헤드리스 크로미엄 실행.
 * - Vercel/Lambda: @sparticuz/chromium (서버리스용 경량 빌드)
 * - 로컬 (경로 지정): A11YCHK_CHROME_PATH
 * - 로컬 (기본): playwright 패키지의 chromium (npx playwright install chromium 필요)
 *
 * @param hostResolverRule --host-resolver-rules 값 (SSRF rebinding 방어용 IP 핀).
 */
export async function launchBrowser(hostResolverRule?: string): Promise<Browser> {
  const { chromium } = await import("playwright-core");
  const resolverArg = hostResolverRule ? [`--host-resolver-rules=${hostResolverRule}`] : [];

  if (process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME) {
    const sparticuz = (await import("@sparticuz/chromium")).default;
    // 그래픽 스택(WebGL 등) 비활성화 — 접근성 검사에 불필요하고 메모리를 크게 절약.
    // Hobby 플랜의 2GB 한도 내에서 자원 고갈(ERR_INSUFFICIENT_RESOURCES)을 줄인다.
    sparticuz.setGraphicsMode = false;
    return chromium.launch({
      args: [...sparticuz.args, "--disable-gpu", "--js-flags=--max-old-space-size=512", ...resolverArg],
      executablePath: await sparticuz.executablePath(),
      headless: true,
    });
  }

  if (process.env.A11YCHK_CHROME_PATH) {
    return chromium.launch({ executablePath: process.env.A11YCHK_CHROME_PATH, headless: true, args: resolverArg });
  }

  const playwright = await import("playwright");
  return playwright.chromium.launch({ headless: true, args: resolverArg });
}
