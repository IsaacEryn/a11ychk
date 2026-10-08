import "server-only";
import { closeEndedSubscription } from "@/lib/billing/flows/end";
import { planNameFor, sendBillingMail } from "@/lib/billing/flows/subscribe";
import { iso } from "@/lib/billing/period";
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
 * - 해지 예약을 알릴 때는 구독을 다시 읽어 그 기간 끝으로 알린다 — 예약을 쓰기 전에 보낸 결제가 그 사이 확정돼 기간이
 *   넘어갔을 수 있다(settlePaid는 예약을 건드리지 않는다). 다시 읽으니 끝났으면 notFound.
 */

/** retryLater: 다시 읽어 판정해도 계속 엇갈렸다(바꾼 것 없음) */
export type CancelResult = "scheduled" | "endedNow" | "notFound" | "already" | "busy" | "retryLater";
export type ResumeResult = "resumed" | "notFound" | "tooLate" | "retryLater";

/** 조건부 갱신이 엇갈렸을 때 다시 읽어 판정하는 횟수 — 넘기면 성공으로 알리지 않는다 */
const MAX_ATTEMPTS = 3;

/** 사용자가 관리할 수 있는 구독 — 토스 정기결제만(기관 계약은 관리자가 다룬다) */
const isManageable = (sub: SubscriptionRow) => sub.provider === "toss" && sub.interval !== "contract";

/**
 * 이 요청이 쓴(또는 이어 간) 해지 예약이 지금 어떻게 남았는지 다시 읽어 알린다 — pending이 없다고 본 뒤, 되돌리지 못했을 때,
 * 미납 즉시 종료가 엇갈렸을 때. 예약을 쓰기 전에 보낸 결제가 그 사이 확정돼 기간이 전진했을 수 있어(settlePaid는 예약을
 * 건드리지 않는다) 메일의 끝나는 날은 다시 읽은 기간 끝이다. 끝났으면 notFound, 예약이 풀렸거나 미납이면 null
 * (다시 읽어 판정한다 — 미납 + 예약은 다음 차례에 바로 끝낸다).
 */
async function reportScheduled(deps: BillingDeps, id: string): Promise<CancelResult | null> {
  const fresh = await deps.store.getSubscription(id);
  if (!fresh || (fresh.status !== "active" && fresh.status !== "past_due")) return "notFound";
  if (fresh.status !== "active" || !fresh.cancel_at_period_end) return null;
  // 크론은 이제 이 구독을 결제하지 않는다 — 확인한 뒤에만 안내 메일
  await sendBillingMail(
    deps,
    fresh.user_id,
    "cancelScheduled",
    { planName: planNameFor(fresh.plan_code), endsAt: fresh.current_period_end },
    `subscription ${id}`,
  );
  return "scheduled";
}

/** 오류 뒤 이번에 쓴 예약을 되돌린다 — 되돌리지 못하면(엇갈림·저장소 오류) 운영자 확인을 남긴다(구독 id만) */
async function revertAfterError(deps: BillingDeps, id: string, expected: SubscriptionExpectation): Promise<void> {
  let reverted = false;
  try {
    reverted = await deps.store.updateSubscriptionIf(id, expected, { cancel_at_period_end: false, canceled_at: null });
  } catch {
    reverted = false;
  }
  if (!reverted) await deps.log(`billing needs review: cancellation of subscription ${id} could not be reverted after an error`);
}

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
  //    (미납 + 예약은 크론이 결제를 확인한 뒤 끝낸다). 확인 자체가 실패하면 해지를 알릴 수 없다 — 이번에 쓴 예약을 되돌리고
  //    던진다(액션이 기록하고 failed로 안내한다). 되돌리기도 실패하면 운영자 확인을 남긴다
  let pending: boolean;
  try {
    pending = await store.hasPendingPayment(sub.id);
  } catch (e) {
    if (wrote) await revertAfterError(deps, sub.id, asRead(true));
    throw e;
  }
  if (pending) {
    if (!wrote) return "busy";
    if (await store.updateSubscriptionIf(sub.id, asRead(true), { cancel_at_period_end: false, canceled_at: null })) return "busy";
    // 되돌리는 사이 바뀌었다(결제 확정·종료) — 다시 읽어, 이 요청의 예약이 남았으면 그 기간 끝으로 알린다
    await deps.log(`billing cancel: reverting the cancellation of subscription ${sub.id} failed, state changed; re-reading`);
    return reportScheduled(deps, sub.id);
  }

  // 3. 진행 중 — 예약으로 끝. 끝나는 날은 다시 읽은 기간 끝이다
  if (sub.status === "active") return reportScheduled(deps, sub.id);

  // 4. 미납 — 바로 끝낸다(예약이 걸린 그 행일 때만). 엇갈렸으면(그 사이 재결제 성공 등) 다시 읽어 남은 예약대로 알린다
  const ended = await store.updateSubscriptionIf(sub.id, asRead(true), { status: "ended", ended_reason: "user_canceled", ended_at: nowIso });
  if (!ended) return reportScheduled(deps, sub.id);
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

/** 탈퇴 전에 읽어 두는 결제 정리 대상 — 계정을 지우면 구독·결제의 user_id가 비어(set null) 더는 사용자로 찾을 수 없다 */
export interface DeletionTargets {
  /** 계정을 지운 뒤 끝낼 진행 중 토스 구독 id(두 livemode — 기관 계약은 건드리지 않는다) */
  subscriptionIds: string[];
  /** 결과를 모르는 첫 결제가 있는 모드 수 — 확인하지 못했으면 null(탈퇴 뒤 그 사실을 기록한다) */
  pendingInitialModes: number | null;
}

/**
 * 탈퇴 전 — 끝낼 구독 id와 결과를 모르는 첫 결제를 모은다. 아무것도 바꾸지 않는다(계정 삭제가 실패하면 유료 기간을 그대로 둔다).
 * 구독을 읽는 저장소 오류는 던진다 — 호출부가 0041 미적용(테이블 없음)이면 빈 목록으로 보고, 그 밖이면 탈퇴를 멈춘다(끝낼 구독을
 * 모른 채 계정을 지우지 않는다). 첫 결제 확인이 실패하면 null로 두고 탈퇴를 막지 않는다 — 탈퇴한 사용자의 첫 결제가 나중에
 * 승인으로 확인되면 대사가 자동 취소한다(renew.ts 머리말의 불변식).
 */
export async function collectDeletionTargets(store: BillingStore, userId: string): Promise<DeletionTargets> {
  const live = await store.listLiveSubscriptions(userId);
  const subscriptionIds = live.filter((sub) => sub.provider === "toss").map((sub) => sub.id);
  let pendingInitialModes: number | null = 0;
  try {
    for (const livemode of [false, true]) if (await store.hasPendingInitialPayment(userId, livemode)) pendingInitialModes++;
  } catch {
    pendingInitialModes = null;
  }
  return { subscriptionIds, pendingInitialModes };
}

/**
 * 탈퇴 뒤 정리 — 계정을 지운(deleteUser 성공) 다음, 모아 둔 구독을 id로 ended(user_canceled)로 끝낸다. 상태만 조건으로 건다:
 * 사용자 id는 이미 비었고, 그 사이 갱신으로 기간이 넘어갔어도 끝내는 게 맞다. 메일은 보내지 않는다(계정이 없다).
 * 끝낸 개수를 돌려준다 — 그 사이 크론이 끝낸 구독은 세지 않는다.
 *
 * 계정을 지운 뒤 끝내도 그 사이 청구되지 않는다: 고객 행(빌링키 암호문)이 계정과 함께 cascade로 지워져 크론이 결제할 카드가 없다
 * (NO_BILLING_KEY). 빌링키를 따로 거둘 것도 없다. 끝내기가 실패한 구독은 needs review(구독 id)로 남기고 탈퇴는 성공으로 둔다 —
 * 남은 구독은 키가 없어 크론이 미납 → 유예 → 종료로 스스로 끝낸다.
 *
 * 끝낸 뒤에 결과를 모르는(pending) 결제를 읽는다(먼저 쓰고 나중에 읽는다 — 이 파일 머리말). 있으면 log에 "확인 필요" 한 줄을
 * 남긴다: 그 결제가 실제로 승인됐다면 대사가 줄 기간이 없음을 보고 자동 취소한다. 기록에는 구독 id와 개수만 넣는다.
 * 던지지 않는다 — 계정은 이미 지워졌다.
 */
export async function endSubscriptionsForDeletion(
  store: BillingStore,
  targets: DeletionTargets,
  now: number,
  log: (message: string) => Promise<void>,
): Promise<number> {
  const endedIds: string[] = [];
  const failedIds: string[] = [];
  for (const id of targets.subscriptionIds) {
    try {
      const ended = await store.updateSubscriptionIf(id, { statuses: ["active", "past_due"] }, { status: "ended", ended_reason: "user_canceled", ended_at: iso(now) });
      if (ended) endedIds.push(id);
    } catch {
      failedIds.push(id);
    }
  }
  if (failedIds.length > 0) {
    await log(`billing needs review: subscriptions ${failedIds.join(",")} could not be ended after account deletion (no billing key remains; the cron ends them as unpaid)`);
  }
  await logPendingPaymentsForDeletion(store, endedIds, targets.pendingInitialModes, log);
  return endedIds.length;
}

/**
 * 탈퇴한 사용자에게 결과를 모르는 결제가 남았는지 본다 — 방금 끝낸 구독에 걸린 결제와, 계정을 지우기 전에 확인해 둔 첫 결제
 * (두 모드 모두 — 구독이 없어도 첫 결제는 청구됐을 수 있다).
 */
async function logPendingPaymentsForDeletion(
  store: BillingStore,
  endedIds: string[],
  pendingInitialModes: number | null,
  log: (message: string) => Promise<void>,
): Promise<void> {
  const subscriptionIds: string[] = [];
  try {
    if (pendingInitialModes === null) throw new Error("pending initial payments were not checked");
    for (const id of endedIds) if (await store.hasPendingPayment(id)) subscriptionIds.push(id);
  } catch (e) {
    const reason = (e instanceof Error ? e.message : String(e)).slice(0, 200);
    await log(`billing needs review: account deleted without checking pending payments (${endedIds.length} subscriptions ended): ${reason}`);
    return;
  }
  if (subscriptionIds.length === 0 && pendingInitialModes === 0) return;
  await log(
    `billing needs review: account deleted with pending payment (subscriptions: ${subscriptionIds.join(",") || "none"}; modes with pending initial payment: ${pendingInitialModes})`,
  );
}
