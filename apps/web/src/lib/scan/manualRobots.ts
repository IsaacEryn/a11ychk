import { isPathAllowed, type RobotsRules } from "@a11ychk/core";

/**
 * 직접 입력 표본을 robots.txt로 거른다(순수 함수). 소유 확인 사용자는 호출하지 않는다 — runScan의
 * buildScanSample이 소유자 예외를 판단한다. 경로+쿼리로 판정하고, 해석할 수 없는 주소는 뺀다.
 */
export function filterPagesByRobots(pages: string[], robots: RobotsRules): { allowed: string[]; skipped: number } {
  const allowed = pages.filter((u) => {
    try {
      const url = new URL(u);
      return isPathAllowed(robots, url.pathname + url.search);
    } catch {
      return false;
    }
  });
  return { allowed, skipped: pages.length - allowed.length };
}
