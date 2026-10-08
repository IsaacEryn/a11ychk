import "server-only";
import { clearBillingKey, closeEndedSubscription } from "@/lib/billing/flows/end";
import { planNameFor, sendBillingMail } from "@/lib/billing/flows/subscribe";
import type { BillingDeps, BillingStore, SubscriptionExpectation, SubscriptionRow } from "@/lib/billing/types";

/**
 * 결제 관리 화면의 흐름 — 사용자의 해지·해지 취소(재개)와 탈퇴 전 정리.
 *
 * 구독은 조건부로만 고친다(읽은 상태·기간 끝·해지 예약 여부와 같을 때만). 크론이 그 사이 갱신하거나 끝냈다면
 * 덮어쓰지 않고, 다시 읽어 지금 상태대로 판정한다 — 아무것도 바꾸지 못했으면 성공으로 알리지 않는다.
 *
 * 해지는 크론의 결제와 엇갈릴 수 있다. 양쪽 다 먼저 쓰고 나중에 읽는다: 해지는 예약(cancel_at_period_end)을 먼저 쓰고
 * 결과를 모르는(pending) 결제가 있는지 보고, 크론은 결제 행을 먼저 쓰고 구독을 다시 읽어 예약이 있으면 결제하지 않는다
 * (renew.ts chargeOnce). 그래서 해지가 끝났다고 알린 뒤에 청구되는 일은 없다. 둘 다 물러날 수는 있다(해지는 busy).
 * - active 해지: 기간 끝에 끝나게 예약한다(그때까지 이용, 그 뒤로는 결제하지 않는다). 크론이 기간 끝에 끝낸다.
 * - past_due 해지: 바로 끝낸다(미납 구독을 유예 끝까지 끌고 가지 않는다).
 * - 결과를 모르는 결제가 있으면 둘 다 하지 않는다(busy) — 그 결제가 실제로 청구됐을 수 있다. 쓴 예약은 되돌린다.
 *   pending은 다음 날 크론의 대사가 확정한다.
 * - 예약을 쓴 뒤 끝내기 전에 멈추면 past_due + 예약이 남는다. 크론은 이 행을 재결제하지 않고 기간 끝이 지났으니
 *   end_canceled로 끝낸다(decideRenewalAction — 해지 예약을 결제 규칙보다 먼저 본다).
 * - 재개: 해지 예약을 기간 끝 전에만 푼다. 미납 구독은 예약 상태가 아니라 재개가 아니라 카드 변경으로 푼다.
 */

/** retryLater: 다시 읽어 판정해도 계속 엇갈렸다(바꾼 것 없음) */
export type CancelResult = "scheduled" | "endedNow" | "notFound" | "already" | "busy" | "retryLater";
export type ResumeResult = "resumed" | "notFound" | "tooLate" | "retryLater";

/** 조건부 갱신이 엇갈렸을 때 다시 읽어 판정하는 횟수 — 넘기면 성공으로 알리지 않는다 */
const MAX_ATTEMPTS = 3;

const iso = (t: number) => new Date(t).toISOString();
/** 사용자가 관리할 수 있는 구독 — 토스 정기결제만(기관 계약은 관리자가 다룬다) */
const isManageable = (sub: SubscriptionRow) => sub.provider === "toss" && sub.interval !== "contract";

/** 해지 한 번 — null이면 읽은 뒤 바뀌어 조건부 갱신이 실패했다(다시 읽는다) */
async function cancelOnce(deps: BillingDeps, sub: SubscriptionRow): Promise<CancelResult | null> {
  const { store } = deps;
  const nowIso = iso(deps.now());
  if (sub.status === "active" && sub.cancel_at_period_end) return "already";
  const asRead = (cancelAtPeriodEnd: boolean): SubscriptionExpectation => ({
    statuses: [sub.status as "active" | "past_due"],
    currentPeriodEnd: sub.current_period_end,
    cancelAtPeriodEnd,
  });

  // 1. 예약을 먼저 쓴다. 미납 구독에 예약이 이미 있으면(앞선 요청이 끝내기 전에 멈춘 경우) 그대로 이어 간다
  const wrote = !sub.cancel_at_period_end;
  if (wrote && !(await store.updateSubscriptionIf(sub.id, asRead(false), { cancel_at_period_end: true, canceled_at: nowIso }))) {
    return null;
  }

  // 2. 그다음 결과를 모르는 결제를 본다 — 있으면 이번에 쓴 예약을 되돌리고 busy. 앞선 요청이 남긴 예약은 그대로 둔다
  //    (미납 + 예약은 크론이 결제를 확인한 뒤 끝낸다)
  if (await store.hasPendingPayment(sub.id)) {
    if (!wrote) return "busy";
    if (await store.updateSubscriptionIf(sub.id, asRead(true), { cancel_at_period_end: false, canceled_at: null })) return "busy";
    // 되돌리는 사이 바뀌었다(결제 확정·종료) — 다시 읽어 지금 상태대로 알린다
    await deps.log(`billing cancel: reverting the cancellation of subscription ${sub.id} failed, state changed; re-reading`);
    return null;
  }

  if (sub.status === "active") {
    // 크론은 이제 이 구독을 결제하지 않는다 — 확인한 뒤에만 안내 메일
    await sendBillingMail(
      deps,
      sub.user_id,
      "cancelScheduled",
      { planName: planNameFor(sub.plan_code), endsAt: sub.current_period_end },
      `subscription ${sub.id}`,
    );
    return "scheduled";
  }

  // 3. 미납 — 바로 끝낸다(예약이 걸린 그 행일 때만)
  const ended = await store.updateSubscriptionIf(sub.id, asRead(true), { status: "ended", ended_reason: "user_canceled", ended_at: nowIso });
  if (!ended) return null;
  await closeEndedSubscription(deps, sub, "canceledNow");
  return "endedNow";
}

/**
 * 해지 — scheduled: 기간 끝 해지 예약 / endedNow: 미납 구독을 바로 끝냄 / already: 이미 예약됨 /
 * busy: 결과를 모르는 결제가 있음(대사가 확정한 뒤 다시) / retryLater: 계속 엇갈림 /
 * notFound: 이 모드의 진행 중 토스 구독이 없음. 저장소 오류는 던진다(액션이 기록한다).
 */
export async function cancelSubscription(deps: BillingDeps, userId: string, livemode: boolean): Promise<CancelResult> {
  for (let i = 0; i < MAX_ATTEMPTS; i++) {
    const sub = await deps.store.getLiveSubscription(userId, livemode);
    if (!sub || !isManageable(sub)) return "notFound";
    const result = await cancelOnce(deps, sub);
    if (result) return result;
  }
  return "retryLater";
}

/**
 * 해지 취소(재개) — resumed: 예약을 풀었음 / tooLate: 기간이 이미 끝남(크론이 곧 끝낸다) / retryLater: 계속 엇갈림 /
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
  return "retryLater";
}

/**
 * 탈퇴 전 정리 — 그 사용자의 진행 중 토스 구독(두 livemode 모두)을 ended(user_canceled)로 끝내고, 끝낸 모드의
 * 빌링키를 지운다(읽은 암호문일 때만). 메일은 보내지 않는다(곧 계정이 사라진다). 기관 계약은 건드리지 않는다.
 * 끝낸 개수를 돌려준다 — 그 사이 크론이 끝낸 구독은 세지 않는다.
 *
 * 끝낸 뒤에 결과를 모르는(pending) 결제를 읽는다(먼저 쓰고 나중에 읽는다 — 이 파일 머리말). 있으면 탈퇴를 막지 않고
 * log에 "확인 필요" 한 줄을 남긴다: 계정은 지워져도 그 결제는 실제로 청구됐을 수 있어, 운영자가 대사한 뒤 환불을 판단한다.
 * 기록에는 구독 id와 개수만 넣는다. 이 확인이 실패해도 던지지 않는다 — 구독은 이미 끝났다.
 *
 * 구독을 읽거나 끝내는 저장소 오류는 던진다(탈퇴를 멈출지는 호출부가 정한다 — 진행 중 구독을 둔 채 계정을 지우면 안 된다).
 */
export async function endSubscriptionsForDeletion(
  store: BillingStore,
  userId: string,
  now: number,
  log: (message: string) => Promise<void>,
): Promise<number> {
  const live = await store.listLiveSubscriptions(userId);
  const endedModes = new Set<boolean>();
  const endedIds: string[] = [];
  for (const sub of live) {
    if (sub.provider !== "toss") continue;
    // 상태만 본다 — 그 사이 갱신으로 기간이 넘어갔어도 끝내는 게 맞다
    const ended = await store.updateSubscriptionIf(
      sub.id,
      { statuses: ["active", "past_due"] },
      { status: "ended", ended_reason: "user_canceled", ended_at: iso(now) },
    );
    if (!ended) continue;
    endedIds.push(sub.id);
    endedModes.add(sub.livemode);
  }
  // 빌링키를 거두기 전에 — 키 정리가 던져도 확인 필요 기록은 남는다
  await logPendingPaymentsForDeletion(store, userId, endedIds, log);
  for (const livemode of endedModes) await clearBillingKey(store, userId, livemode);
  return endedIds.length;
}

/**
 * 탈퇴하는 사용자에게 결과를 모르는 결제가 남았는지 본다 — 방금 끝낸 구독에 걸린 결제와, 구독이 만들어지기 전의
 * 첫 결제(두 모드 모두). 구독이 없어도 첫 결제는 청구됐을 수 있으니 끝낸 구독이 0개여도 본다.
 */
async function logPendingPaymentsForDeletion(
  store: BillingStore,
  userId: string,
  endedIds: string[],
  log: (message: string) => Promise<void>,
): Promise<void> {
  const subscriptionIds: string[] = [];
  let initialModes = 0;
  try {
    for (const id of endedIds) if (await store.hasPendingPayment(id)) subscriptionIds.push(id);
    for (const livemode of [false, true]) if (await store.hasPendingInitialPayment(userId, livemode)) initialModes++;
  } catch (e) {
    const reason = (e instanceof Error ? e.message : String(e)).slice(0, 200);
    await log(`billing needs review: account deleted without checking pending payments (${endedIds.length} subscriptions ended): ${reason}`);
    return;
  }
  if (subscriptionIds.length === 0 && initialModes === 0) return;
  await log(
    `billing needs review: account deleted with pending payment (subscriptions: ${subscriptionIds.join(",") || "none"}; modes with pending initial payment: ${initialModes})`,
  );
}
