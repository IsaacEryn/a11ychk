/**
 * axe-core 실행기 (서버/Playwright 전용).
 * 브라우저 실행(launch)은 환경마다 다르므로 이 모듈은 Playwright Page를 받아
 * axe를 주입·실행하고, 정규화는 공유 모듈(normalize)에 위임한다.
 */
import type { Page } from "playwright-core";
import axe from "axe-core";
import type { PageScanResult } from "../types";
import { AXE_RUN_TAGS, normalizeAxeResults, type AxeRunResults } from "./normalize";

export { AXE_RUN_TAGS, normalizeAxeResults } from "./normalize";
export type { AxeRunResults } from "./normalize";

/** 이미 로드된 페이지에 axe를 주입하고 실행 */
export async function runAxeOnPage(page: Page): Promise<PageScanResult> {
  // axe-core 라이브러리 주입 (라이브러리 소스 문자열 — 번들러 변환 영향 없음)
  await page.evaluate(axe.source);

  // 중요: axe.run 호출을 "함수"가 아닌 "문자열"로 넘긴다.
  // 함수를 넘기면 Playwright가 함수 소스를 직렬화해 페이지에서 실행하는데,
  // 프로덕션 빌드에서 minify/트랜스파일된 클로저는 번들러 헬퍼(예: `t`)를
  // 참조해 브라우저 컨텍스트에서 "ReferenceError: t is not defined"가 난다.
  // 문자열 표현식은 트랜스파일 대상이 아니므로 이 문제를 근본적으로 피한다.
  const options = JSON.stringify({
    runOnly: { type: "tag", values: AXE_RUN_TAGS },
    resultTypes: ["violations", "passes", "incomplete"],
  });
  // axe.run은 Promise를 반환하며 Playwright가 자동으로 await 한다.
  const raw = (await page.evaluate(`window.axe.run(document, ${options})`)) as AxeRunResults;
  return normalizeAxeResults(page.url(), raw);
}

export const AXE_VERSION: string = axe.version;
