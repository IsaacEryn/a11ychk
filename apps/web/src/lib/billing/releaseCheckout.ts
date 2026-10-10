import type { AbandonCheckoutState } from "@/lib/actions/billing";
import type { CheckoutBlock } from "@/lib/billing/checkout";

/**
 * 결제 확인 화면의 "이전 시도 취소" 결과 — 토스(openBillingAuth.ts)와 해외 결제(MorCheckoutForm)가 함께 쓴다. 브라우저에서만 부른다.
 * released: 닫았다 / nothingToRelease: 닫을 것이 없었다(성공으로 안내하지 않는다) / inProgress: 닫은 뒤에도 처리 중인 결제가 남았다(기다려야 한다)
 */
export interface ReleaseResult {
  error?: "notConfigured" | "failed" | "inProgress";
  /** error가 inProgress일 때 — 닫은 뒤에도 처리 중인 결제가 남았다(기다려야 한다) */
  blockedBy?: CheckoutBlock;
  notice?: "released" | "nothingToRelease";
}

/** 이전 시도 닫기 — abandon은 결제사에 맞는 서버 액션(abandonCheckout·abandonMorCheckout) */
export async function releasePrevious(abandon: () => Promise<AbandonCheckoutState>): Promise<ReleaseResult> {
  const res = await abandon();
  if (res.error) return { error: res.error };
  if (res.blockedBy) return { error: "inProgress", blockedBy: res.blockedBy };
  return { notice: (res.closed ?? 0) > 0 ? "released" : "nothingToRelease" };
}
