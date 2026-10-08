import { isSubscriptionEntitled, type SubscriptionEntitlementFields } from "@/lib/entitlements";

/**
 * 구독의 화면용 상태 키 — 이용 권한 판정(lib/entitlements.ts의 isSubscriptionEntitled)과 같은 기준으로 보여 준다.
 * - ended: 그대로 ended
 * - 권한이 없으면 expired — 종료 처리(ended)가 늦어도 기간 만료로 보인다. 해지 예약·기관 계약은 기간 끝에,
 *   미납(past_due)은 유예 기한에 expired가 된다
 * - 권한이 있으면 원래 상태 — 카드 구독의 기간 끝 뒤 48시간 여유(크론·웹훅이 늦는 동안)와 미납 유예 중에는
 *   active·past_due로 보인다. 크론이 곧 정리할 구독을 expired로 오해하지 않게
 * - 아직 시작하지 않은 기관 계약은 기간이 끝난 것이 아니라 원래 상태 그대로 둔다
 * 목록·상세·테스트 도구가 같은 판정을 쓴다.
 * Date.now()를 컴포넌트 밖으로 뺀 이유: react-hooks/purity가 렌더 안의 호출을 막는다 — 기본값으로 이 함수 안에서 읽는다.
 */
export function displayStatus(sub: SubscriptionEntitlementFields, now: number = Date.now()): string {
  if (sub.status === "ended") return "ended";
  if (isSubscriptionEntitled(sub, now)) return sub.status;
  return now < Date.parse(sub.current_period_start) ? sub.status : "expired";
}
