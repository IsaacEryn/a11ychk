/**
 * 정기 검사 주기 → 실행 간격(시간). 하루 1회 크론이 이 간격 이상 지난 도메인만 검사한다.
 * 주기보다 살짝 짧게 잡아 드리프트로 하루씩 밀리는 것을 방지(예: weekly는 6.5일 후 검사).
 * 미지정·알 수 없는 값은 daily로 폴백. (순수 함수 — 테스트 대상)
 */
export const FREQUENCY_HOURS: Record<string, number> = {
  daily: 20,
  weekly: 6.5 * 24,
  monthly: 27 * 24,
};

export function dueIntervalHours(freq: unknown): number {
  return FREQUENCY_HOURS[typeof freq === "string" ? freq : "daily"] ?? FREQUENCY_HOURS.daily;
}
