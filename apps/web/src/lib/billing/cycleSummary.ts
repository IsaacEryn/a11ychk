/**
 * 결제 크론 요약(runBillingCycle이 돌려준 개수)을 관리자 도구가 읽는 방법. 키 이름은 renew.ts가 정한다.
 * 클라이언트 컴포넌트(RunCycleForm)가 쓰므로 순수 데이터·함수만 둔다.
 */

/** 화면에 이름을 붙여 보여 줄 요약 키 — 목록에 없는 키는 이름 그대로 보인다 */
export const CYCLE_SUMMARY_KEYS = [
  "reconciled_paid",
  "reconciled_failed",
  "reconciled_unresolved",
  "reconciled_review",
  "candidates",
  "errors",
  "deferred",
  "none",
  "remind",
  "remind_skipped",
  "charge_paid",
  "charge_failed",
  "charge_pending",
  "charge_skipped",
  "charge_incident",
  "charge_halted",
  "charge_refunded",
  "charge_review",
  "retry_paid",
  "retry_failed",
  "retry_pending",
  "retry_skipped",
  "retry_incident",
  "retry_halted",
  "retry_refunded",
  "retry_review",
  "halt_skipped",
  "end_canceled",
  "end_unpaid",
  "held",
  "changed",
  "halted",
] as const;

/** 결제는 paid로 남았지만 운영자 확인이 필요한 건(자동 취소 실패, 진행 중 구독이 다른 기간에 있음) */
export const REVIEW_SUMMARY_KEYS = ["reconciled_review", "charge_review", "retry_review"] as const;

export interface CycleIssues {
  errors: number;
  halted: number;
  /** 운영자 확인이 필요한 결제 수(REVIEW_SUMMARY_KEYS의 합) */
  review: number;
  /** 하나라도 있으면 성공 표시로 덮지 않는다 */
  any: boolean;
}

/** 크론이 끝까지 돌았어도 오류·설정 사고로 인한 중단·운영자 확인이 필요한 결제가 있으면 문제로 보인다 */
export function cycleIssues(summary: Record<string, number> | undefined): CycleIssues {
  const count = (key: string) => summary?.[key] ?? 0;
  const errors = count("errors");
  const halted = count("halted");
  const review = REVIEW_SUMMARY_KEYS.reduce((sum, key) => sum + count(key), 0);
  return { errors, halted, review, any: errors > 0 || halted > 0 || review > 0 };
}
