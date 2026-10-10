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
  "mor_candidates",
  "mor_synced",
  "mor_refunded",
  "mor_review",
  "mor_failed",
  "mor_ended",
  "mor_changed",
  "mor_deferred",
  "mor_expired",
  "mor_stale_refunds",
  "mor_halted",
] as const;

/**
 * 운영자 확인이 필요한 건 — 결제는 paid로 남았지만 확인이 필요한 결제(자동 취소 실패, 진행 중 구독이 다른 기간에 있음)와
 * MoR 대사의 needs review(동기화 확인 필요, Polar에 없어 끝낸 구독, Polar 환불 id 없이 남은 자동 환불)
 */
export const REVIEW_SUMMARY_KEYS = ["reconciled_review", "charge_review", "retry_review", "mor_review", "mor_ended", "mor_stale_refunds"] as const;
/** 오류로 세는 키 — 처리 중 예외(errors)와 MoR 대사의 실패(mor_failed) */
export const ERROR_SUMMARY_KEYS = ["errors", "mor_failed"] as const;
/** 중단으로 세는 키 — 토스 설정 사고(halted)와 Polar 토큰·권한 거부(mor_halted) */
export const HALT_SUMMARY_KEYS = ["halted", "mor_halted"] as const;

export interface CycleIssues {
  /** ERROR_SUMMARY_KEYS의 합 */
  errors: number;
  /** HALT_SUMMARY_KEYS의 합 */
  halted: number;
  /** 운영자 확인이 필요한 건수(REVIEW_SUMMARY_KEYS의 합) */
  review: number;
  /** 하나라도 있으면 성공 표시로 덮지 않는다 */
  any: boolean;
}

/** 크론이 끝까지 돌았어도 오류·설정 사고로 인한 중단·운영자 확인이 필요한 건이 있으면 문제로 보인다 */
export function cycleIssues(summary: Record<string, number> | undefined): CycleIssues {
  const count = (key: string) => summary?.[key] ?? 0;
  const sum = (keys: readonly string[]) => keys.reduce((total, key) => total + count(key), 0);
  const errors = sum(ERROR_SUMMARY_KEYS);
  const halted = sum(HALT_SUMMARY_KEYS);
  const review = sum(REVIEW_SUMMARY_KEYS);
  return { errors, halted, review, any: errors > 0 || halted > 0 || review > 0 };
}
