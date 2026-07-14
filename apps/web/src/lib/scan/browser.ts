import "server-only";
import type { Browser } from "playwright-core";

/**
 * 환경별 헤드리스 크로미엄 실행.
 * - Vercel/Lambda: @sparticuz/chromium (서버리스용 경량 빌드)
 * - 로컬 (경로 지정): A11YCHK_CHROME_PATH
 * - 로컬 (기본): playwright 패키지의 chromium (npx playwright install chromium 필요)
 */
export async function launchBrowser(): Promise<Browser> {
  const { chromium } = await import("playwright-core");

  if (process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME) {
    const sparticuz = (await import("@sparticuz/chromium")).default;
    return chromium.launch({
      args: sparticuz.args,
      executablePath: await sparticuz.executablePath(),
      headless: true,
    });
  }

  if (process.env.A11YCHK_CHROME_PATH) {
    return chromium.launch({ executablePath: process.env.A11YCHK_CHROME_PATH, headless: true });
  }

  const playwright = await import("playwright");
  return playwright.chromium.launch({ headless: true });
}
