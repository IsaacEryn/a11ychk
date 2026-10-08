import "server-only";
import { clearBillingKey, closeEndedSubscription } from "@/lib/billing/flows/end";
import { planNameFor, sendBillingMail } from "@/lib/billing/flows/subscribe";
import type { BillingDeps, BillingStore, SubscriptionRow } from "@/lib/billing/types";

/**
 * 결제 관리 화면의 흐름 — 사용자의 해지·해지 취소(재개)와 탈퇴 전 정리.
 *
 * 구독은 조건부로만 고친다(읽은 상태·기간 끝·해지 예약 여부와 같을 때만). 크론이 그 사이 갱신하거나 끝냈다면
 * 덮어쓰지 않고, 다시 읽어 지금 상태대로 판정한다 — 아무것도 바꾸지 못했으면 성공으로 알리지 않는다.
 * - active 해지: 기간 끝에 끝나게 예약한다(그때까지 이용, 그 뒤로는 결제하지 않는다). 크론이 기간 끝에 끝낸다.
 * - past_due 해지: 바로 끝낸다(미납 구독을 유예 끝까지 끌고 가지 않는다). 다만 결과를 모르는(pending) 결제가 있으면
 *   끝내지 않는다 — 그 재시도가 실제로 청구됐을 수 있어, 끝낸 뒤 대사가 paid로 확정하면 끝난 구독에 돈만 받게 된다.
 * - 재개: 해지 예약을 기간 끝 전에만 푼다. 미납 구독은 예약 상태가 아니라 재개가 아니라 카드 변경으로 푼다.
 */

export type CancelResult = "scheduled" | "endedNow" | "notFound" | "already" | "busy";
export type ResumeResult = "resumed" | "notFound" | "tooLate";

/** 조건부 갱신이 엇갈렸을 때 다시 읽어 판정하는 횟수 — 넘기면 성공으로 알리지 않는다 */
const MAX_ATTEMPTS = 3;

const iso = (t: number) => new Date(t).toISOString();
/** 사용자가 관리할 수 있는 구독 — 토스 정기결제만(기관 계약은 관리자가 다룬다) */
const isManageable = (sub: SubscriptionRow) => sub.provider === "toss" && sub.interval !== "contract";

/** 해지 한 번 — null이면 읽은 뒤 바뀌어 조건부 갱신이 실패했다(다시 읽는다) */
async function cancelOnce(deps: BillingDeps, sub: SubscriptionRow): Promise<CancelResult | null> {
  const { store } = deps;
  const nowIso = iso(deps.now());
  if (sub.status === "active") {
    if (sub.cancel_at_period_end) return "already";
    const scheduled = await store.updateSubscriptionIf(
      sub.id,
      { statuses: ["active"], currentPeriodEnd: sub.current_period_end, cancelAtPeriodEnd: false },
      { cancel_at_period_end: true, canceled_at: nowIso },
    );
    if (!scheduled) return null;
    await sendBillingMail(
      deps,
      sub.user_id,
      "cancelScheduled",
      { planName: planNameFor(sub.plan_code), endsAt: sub.current_period_end },
      `subscription ${sub.id}`,
    );
    return "scheduled";
  }

  // past_due — 결과를 모르는 결제가 있으면(나이와 무관하게) 끝내지 않는다. 크론의 종료와 같은 규칙
  if (await store.hasPendingPayment(sub.id)) return "busy";
  const ended = await store.updateSubscriptionIf(
    sub.id,
    { statuses: ["past_due"], currentPeriodEnd: sub.current_period_end, cancelAtPeriodEnd: sub.cancel_at_period_end },
    { status: "ended", ended_reason: "user_canceled", ended_at: nowIso },
  );
  if (!ended) return null;
  await closeEndedSubscription(deps, sub, "canceled");
  return "endedNow";
}

/**
 * 해지 — scheduled: 기간 끝 해지 예약 / endedNow: 미납 구독을 바로 끝냄 / already: 이미 예약됨 /
 * busy: 결과를 모르는 결제가 있거나 계속 엇갈림(몇 분 뒤 다시) / notFound: 이 모드의 진행 중 토스 구독이 없음.
 * 저장소 오류는 던진다(액션이 기록한다).
 */
export async function cancelSubscription(deps: BillingDeps, userId: string, livemode: boolean): Promise<CancelResult> {
  for (let i = 0; i < MAX_ATTEMPTS; i++) {
    const sub = await deps.store.getLiveSubscription(userId, livemode);
    if (!sub || !isManageable(sub)) return "notFound";
    const result = await cancelOnce(deps, sub);
    if (result) return result;
  }
  return "busy";
}

/**
 * 해지 취소(재개) — resumed: 예약을 풀었음 / tooLate: 기간이 이미 끝남(크론이 곧 끝낸다) /
 * notFound: 풀 해지 예약이 없음(진행 중 토스 구독이 없거나 예약 상태가 아님, 그 사이 끝났거나 다른 요청이 먼저 풀었음).
 */
export async function resumeSubscription(deps: BillingDeps, userId: string, livemode: boolean): Promise<ResumeResult> {
  for (let i = 0; i < MAX_ATTEMPTS; i++) {
    const sub = await deps.store.getLiveSubscription(userId, livemode);
    if (!sub || !isManageable(sub) || sub.status !== "active" || !sub.cancel_at_period_end) return "notFound";
    if (deps.now() >= Date.parse(sub.current_period_end)) return "tooLate";
    const resumed = await deps.store.updateSubscriptionIf(
      sub.id,
      { statuses: ["active"], currentPeriodEnd: sub.current_period_end, cancelAtPeriodEnd: true },
      { cancel_at_period_end: false, canceled_at: null },
    );
    if (resumed) return "resumed";
  }
  // 계속 엇갈렸다 — 바꾼 것이 없으니 성공으로 알리지 않는다(화면을 새로 고쳐 지금 상태를 본다)
  return "notFound";
}

/**
 * 탈퇴 전 정리 — 그 사용자의 진행 중 토스 구독(두 livemode 모두)을 ended(user_canceled)로 끝내고, 끝낸 모드의
 * 빌링키를 지운다(읽은 암호문일 때만). 메일은 보내지 않는다(곧 계정이 사라진다). 기관 계약은 건드리지 않는다.
 * 끝낸 개수를 돌려준다 — 그 사이 크론이 끝낸 구독은 세지 않는다. 저장소 오류는 던진다(탈퇴를 멈출지는 호출부가 정한다).
 */
export async function endSubscriptionsForDeletion(store: BillingStore, userId: string, now: number): Promise<number> {
  const live = await store.listLiveSubscriptions(userId);
  const endedModes = new Set<boolean>();
  let count = 0;
  for (const sub of live) {
    if (sub.provider !== "toss") continue;
    // 상태만 본다 — 그 사이 갱신으로 기간이 넘어갔어도 끝내는 게 맞다
    const ended = await store.updateSubscriptionIf(
      sub.id,
      { statuses: ["active", "past_due"] },
      { status: "ended", ended_reason: "user_canceled", ended_at: iso(now) },
    );
    if (!ended) continue;
    count++;
    endedModes.add(sub.livemode);
  }
  for (const livemode of endedModes) await clearBillingKey(store, userId, livemode);
  return count;
}
