/**
 * 구독의 화면용 상태 키 — 종료 처리되지 않았는데 기간이 지났으면 "expired".
 * 이용 권한은 기간 시각으로만 판정되므로(lib/entitlements.ts) 상태 정리(ended)가 늦어도
 * 화면에서는 기간 만료로 보여 준다. 목록·상세가 같은 판정을 쓴다.
 * Date.now()를 컴포넌트 밖으로 뺀 이유: react-hooks/purity가 렌더 안의 호출을 막는다.
 */
export function displayStatus(status: string, periodEndIso: string): string {
  return status !== "ended" && Date.parse(periodEndIso) < Date.now() ? "expired" : status;
}
