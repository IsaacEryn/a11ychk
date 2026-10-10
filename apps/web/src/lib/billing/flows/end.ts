import "server-only";
import type { BillingEmailData } from "@/lib/billing/emails";
import type { BillingDeps, BillingStore, SubscriptionRow } from "@/lib/billing/types";
// subscribe.ts → renew.ts → 이 모듈 → subscribe.ts(순환). 모두 함수 안에서만 부르고 모듈 최상위에서는 쓰지 않아 안전하다
import { planNameFor, sendBillingMail } from "@/lib/billing/flows/subscribe";

/**
 * 구독을 끝낸 뒤의 공통 정리 — 크론의 해지 예약·미납 종료(renew.ts), 사용자의 즉시 해지(manage.ts)가 함께 쓴다.
 * (탈퇴 정리는 쓰지 않는다 — 계정을 지운 뒤 끝내므로 빌링키는 고객 행 cascade로 이미 없고 메일 받을 사람도 없다.)
 * 끝내는 조건부 갱신은 호출부가 먼저 한다. 빌링키를 먼저 거두면 그 사이 재결제로 되살아난 구독이 갱신할 카드를 잃는다.
 */

/**
 * 그 사용자·모드의 빌링키·카드 요약을 지운다(지웠으면 true). 사용자·모드당 진행 중 구독은 하나라, 구독을 끝낸 직후
 * 고객 행의 빌링키는 그 구독의 것이다. 읽은 암호문일 때만 지운다 — 그 사이 새 결제창이 쓴 빌링키는 남긴다.
 * 저장소 오류는 던진다.
 */
async function clearBillingKey(store: BillingStore, userId: string, livemode: boolean): Promise<boolean> {
  const customer = await store.getCustomer(userId, livemode);
  if (!customer?.toss_billing_key_enc) return false;
  return store.clearCustomerKeyIf(customer.id, customer.toss_billing_key_enc);
}

/**
 * 방금 끝낸 구독의 빌링키를 거두고 종료 메일을 보낸다. 키 정리가 실패해도 던지지 않는다 — 구독은 이미 끝났고,
 * 남은 빌링키는 운영자가 지운다(기록에는 구독 id만, 값은 넣지 않는다).
 */
export async function closeEndedSubscription(
  deps: BillingDeps,
  sub: Pick<SubscriptionRow, "id" | "user_id" | "livemode" | "plan_code">,
  /** canceled: 해지 예약 만료(크론) / canceledNow: 사용자가 미납 구독을 바로 해지 / unpaid: 미납 유예 만료 */
  reason: BillingEmailData["ended"]["reason"],
): Promise<void> {
  if (sub.user_id) {
    try {
      await clearBillingKey(deps.store, sub.user_id, sub.livemode);
    } catch {
      await deps.log(`billing needs review: key cleanup failed for subscription ${sub.id}`);
    }
  }
  await sendBillingMail(deps, sub.user_id, "ended", { planName: planNameFor(sub.plan_code), reason }, `subscription ${sub.id}`);
}
