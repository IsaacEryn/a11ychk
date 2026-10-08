import "server-only";
import { decryptBillingKey } from "@/lib/billing/crypto";
import {
  CHARGE_LEAD_MS,
  addInterval,
  graceUntil,
  kstDayOfMonth,
  nextRetryAt,
  reminderLeadMs,
} from "@/lib/billing/period";
import { TossError, classifyTossError, isOutcomeUnknown, type TossErrorKind, type TossPayment } from "@/lib/billing/toss";
import type { BillingDeps, PaymentRow, SubscriptionRow } from "@/lib/billing/types";
import {
  activateInitialPayment,
  errorText,
  newOrderId,
  orderNameFor,
  paidFields,
  planNameFor,
  sendBillingMail,
  sendReceipt,
  warnIfResponseDiffers,
} from "@/lib/billing/flows/subscribe";

/**
 * 정기결제 크론의 흐름 — 갱신 결제, 미납 재시도, 해지·미납 종료, 결제 예정 안내, 결과 불명 결제의 대사.
 *
 * 두 번 결제하지 않는 장치는 결제 행 유니크(구독·기간 시작·시도 번호)다. 결제를 보내기 전에 행을 먼저
 * 만들고, 같은 주기·같은 시도의 행이 이미 있으면 결제하지 않는다(skipped). 크론이 겹치거나 다시 돌아도,
 * 카드 변경 뒤 재결제가 크론과 엇갈려도 같다.
 *
 * 쓰는 순서도 같은 이유로 정했다 — 구독을 먼저 고치고 결제 행을 나중에 확정한다. 중간에 멈추면 결제 행이
 * pending으로 남아 다음 날 대사가 토스 조회로 마무리한다. 반대 순서면 결제 행은 끝났는데 구독은 그대로라,
 * 같은 시도 번호에 막혀 영영 갱신되지 않는다.
 *
 * 시각은 모두 Date.parse로 비교한다(DB는 +00:00, 흐름은 Z로 쓴다). 빌링키 평문은 결제 요청 인자로만 쓴다.
 */

export type RenewalAction = "end_canceled" | "end_unpaid" | "charge" | "retry" | "remind" | "none";
export type ChargeResult = "paid" | "failed" | "pending" | "skipped";

/** 대사 대상 — 토스 요청 시간 제한(15초)보다 충분히 오래된 pending만. 아직 진행 중인 요청을 건드리지 않는다 */
const RECONCILE_AFTER_MS = 10 * 60_000;
const RECONCILE_LIMIT = 50;
/** 크론 최대 실행 시간(300초) 안에 끝나게 — 남은 건은 다음 날 */
const DEFAULT_BUDGET_MS = 240_000;
const DEFAULT_LIMIT = 500;
const NO_BILLING_KEY = "NO_BILLING_KEY";
/** 토스가 이 결제는 돈이 움직이지 않았다고 답한 상태 */
const NOT_PAID = new Set(["ABORTED", "EXPIRED"]);
/** 승인 뒤 돌려준 상태 — 돈이 돌아갔다 */
const RETURNED = new Map<string, "refunded" | "partially_refunded">([
  ["CANCELED", "refunded"],
  ["PARTIAL_CANCELED", "partially_refunded"],
]);

const iso = (t: number) => new Date(t).toISOString();
const sameInstant = (a: string | null, b: string | null) => a !== null && b !== null && Date.parse(a) === Date.parse(b);
const isLive = (s: SubscriptionRow) => s.status === "active" || s.status === "past_due";
const isAttempt = (p: PaymentRow) => p.kind === "renewal" || p.kind === "retry";

export function decideRenewalAction(sub: SubscriptionRow, now: number): RenewalAction {
  if (sub.provider !== "toss" || !isLive(sub) || sub.interval === "contract") return "none";
  const end = Date.parse(sub.current_period_end);
  // 해지를 예약했으면 결제하지 않는다. 미납 중 해지는 바로 끝내는 게 규칙이라 원래 없는 조합이지만,
  // 생기더라도 해지한 사람에게 재결제하지 않게 같은 규칙으로 끝낸다
  if (sub.cancel_at_period_end) return now >= end ? "end_canceled" : "none";
  if (sub.status === "active") {
    if (now >= end - CHARGE_LEAD_MS) return "charge";
    if (now >= end - reminderLeadMs(sub.interval) && !sameInstant(sub.reminder_sent_for, sub.current_period_end)) return "remind";
    return "none";
  }
  const grace = Date.parse(sub.grace_until ?? graceUntil(sub.current_period_end));
  if (now >= grace) return "end_unpaid";
  if (sub.next_retry_at !== null && now >= Date.parse(sub.next_retry_at)) return "retry";
  return "none";
}

/** 고객 행의 빌링키 — 없거나 풀 수 없으면 null(카드를 다시 등록해야 한다) */
async function loadBillingKey(deps: BillingDeps, sub: SubscriptionRow): Promise<{ billingKey: string; customerKey: string } | null> {
  if (!sub.user_id) return null;
  const customer = await deps.store.getCustomer(sub.user_id, sub.livemode);
  if (!customer?.toss_billing_key_enc || !customer.toss_customer_key) return null;
  const billingKey = decryptBillingKey(customer.toss_billing_key_enc, { userId: sub.user_id, livemode: sub.livemode }, deps.encKey);
  if (!billingKey) {
    // 암호화 키가 바뀌었거나 행이 옮겨졌다 — 사용자 카드 문제가 아니라 운영자가 봐야 한다
    await deps.log(`billing key for subscription ${sub.id} could not be decrypted`);
    return null;
  }
  return { billingKey, customerKey: customer.toss_customer_key };
}

/** 이번 주기 결제 성공 — 구독을 한 주기 전진시키고(먼저) 결제 행을 확정한 뒤 영수증 */
async function settlePaid(deps: BillingDeps, sub: SubscriptionRow, payment: PaymentRow, charged: TossPayment): Promise<void> {
  if (!payment.period_start || !payment.period_end) throw new Error(`billing payment ${payment.id} has no period`);
  await warnIfResponseDiffers(deps, payment, charged);
  await deps.store.updateSubscription(sub.id, {
    status: "active",
    current_period_start: payment.period_start,
    current_period_end: payment.period_end,
    dunning_attempts: 0,
    next_retry_at: null,
    grace_until: null,
    reminder_sent_for: null,
  });
  await deps.store.updatePayment(payment.id, { status: "paid", ...paidFields(deps, charged) });
  await sendReceipt(deps, sub.user_id, sub.plan_code, payment, charged);
}

/**
 * 이번 주기 결제 실패 — 미납으로 넘기고(먼저) 결제 행을 확정한다. 기간 끝(결제 예정 시각)은 미납 동안
 * 바뀌지 않아 재시도·유예가 모두 그 시각 기준이다. 메일은 첫 실패, 또는 재시도로 풀리지 않는 실패일 때만.
 */
async function settleUnpaid(
  deps: BillingDeps,
  sub: SubscriptionRow,
  payment: PaymentRow,
  failure: { failures: number; errKind: TossErrorKind },
  paymentPatch: Partial<Omit<PaymentRow, "id">>,
): Promise<void> {
  const end = sub.current_period_end;
  const grace = graceUntil(end);
  const retryable = failure.errKind === "retryable";
  await deps.store.updateSubscription(sub.id, {
    status: "past_due",
    dunning_attempts: failure.failures,
    next_retry_at: retryable ? nextRetryAt(end, failure.failures) : null,
    grace_until: grace,
  });
  await deps.store.updatePayment(payment.id, paymentPatch);
  if (failure.failures === 1 || !retryable) {
    await sendBillingMail(
      deps,
      sub.user_id,
      "failed",
      { planName: planNameFor(sub.plan_code), amount: sub.amount, currency: sub.currency, graceUntil: grace, needsCardChange: !retryable },
      `payment ${payment.id}`,
    );
  }
}

/**
 * 갱신·재시도 결제 한 번 — 카드 변경 직후 재결제도 쓴다.
 * paid: 구독 전진 / failed: 미납으로 넘김 / pending: 결과 불명(대사가 확정) / skipped: 이 주기·시도는 이미 처리 중이거나 끝남.
 * 돈이 움직이기 전의 저장소 오류는 그대로 던진다(호출부가 기록). 결제 행이 먼저 만들어졌다면 pending으로 남아 대사가 정리한다.
 */
export async function chargeSubscription(deps: BillingDeps, sub: SubscriptionRow, kind: "renewal" | "retry"): Promise<ChargeResult> {
  if (sub.provider !== "toss" || !isLive(sub) || sub.interval === "contract") return "skipped";
  const interval = sub.interval;
  // 앵커일로 계산한다 — 앞 기간 끝의 일자를 쓰면 2월을 지난 31일 구독이 28일로 굳는다
  const anchor = sub.billing_anchor_day ?? kstDayOfMonth(Date.parse(sub.current_period_end));
  const failures = sub.dunning_attempts + 1;

  // 결제 행을 먼저 만든다 — 같은 주기·같은 시도의 행이 있으면 다른 실행이 맡았다. 행 id가 토스 멱등 키다
  const payment = await deps.store.insertPayment({
    user_id: sub.user_id,
    subscription_id: sub.id,
    checkout_id: null,
    provider: "toss",
    livemode: sub.livemode,
    kind,
    order_id: newOrderId(),
    amount: sub.amount,
    currency: sub.currency,
    period_start: sub.current_period_end,
    period_end: addInterval(sub.current_period_end, interval, anchor),
    attempt: kind === "renewal" ? 1 : failures,
    status: "pending",
  });
  if (payment === "duplicate") return "skipped";

  const key = await loadBillingKey(deps, sub);
  if (!key) {
    await settleUnpaid(deps, sub, payment, { failures, errKind: "card_action_required" }, { status: "failed", failure_code: NO_BILLING_KEY, failure_message: null });
    return "failed";
  }

  let moneyInFlight = true;
  try {
    let charged: TossPayment;
    try {
      charged = await deps.toss.chargeBillingKey(
        key.billingKey,
        { customerKey: key.customerKey, amount: payment.amount, orderId: payment.order_id, orderName: orderNameFor(sub.plan_code, interval) },
        payment.id,
      );
    } catch (e) {
      if (!(e instanceof TossError) || isOutcomeUnknown(e)) {
        // 결과 불명 — 결제 pending·구독 그대로. 다음 실행의 대사가 확정한다
        await deps.log(`billing ${kind} charge outcome unknown, payment ${payment.id}: ${errorText(e)}`);
        return "pending";
      }
      // 토스가 거절했다고 답했다 — 돈은 움직이지 않았다
      moneyInFlight = false;
      const errKind = classifyTossError(e.code);
      if (errKind === "fatal") await deps.log(`billing ${kind} charge fatal error, payment ${payment.id}: ${e.code}`);
      await settleUnpaid(deps, sub, payment, { failures, errKind }, { status: "failed", failure_code: e.code, failure_message: e.message });
      return "failed";
    }
    if (charged.status !== "DONE") {
      await deps.log(`billing ${kind} charge payment ${payment.id} returned status ${charged.status.slice(0, 40)}, left pending`);
      return "pending";
    }
    await settlePaid(deps, sub, payment, charged);
    return "paid";
  } catch (e) {
    if (!moneyInFlight) throw e;
    await deps.log(`billing ${kind} payment ${payment.id} may have been charged but was not settled, left pending: ${errorText(e)}`);
    return "pending";
  }
}

type Resolution = "paid" | "failed" | "unresolved";

/** 토스가 돌려준 금액 — 응답의 결제액·남은 금액으로 계산하고, 응답에 없으면 결제 금액 전액으로 본다 */
function returnedAmount(payment: PaymentRow, found: TossPayment): number {
  if (found.balanceAmount !== null && found.totalAmount > 0) {
    const returned = found.totalAmount - found.balanceAmount;
    if (returned >= 0) return returned;
  }
  return payment.amount;
}

/** 대사: 토스가 결제가 없다(null)·실패·취소라고 답했다 — 이용 기간을 주지 않는다 */
async function reconcileNotPaid(deps: BillingDeps, p: PaymentRow, found: TossPayment | null, status: string): Promise<Resolution> {
  const { store } = deps;
  const code = `RECONCILED_${status}`;
  const returned = found ? RETURNED.get(status) : undefined;
  const patch: Partial<Omit<PaymentRow, "id">> =
    found && returned
      ? { ...paidFields(deps, found), status: returned, refunded_amount: returnedAmount(p, found), failure_code: code }
      : { status: "failed", failure_code: code };
  if (returned) {
    // 우리 흐름은 갱신 결제를 취소하지 않는다 — 토스 쪽에서 돌려준 결제라 운영자가 확인한다
    await deps.log(`billing reconcile: payment ${p.id} was ${status.toLowerCase()} at toss, recorded as ${returned}; subscription left as is for review`);
  }

  if (p.kind === "initial") {
    await store.updatePayment(p.id, patch);
    // 끝나지 않은(open·processing) 시도만 닫힌다
    if (p.checkout_id) await store.finishCheckout(p.checkout_id, { status: "failed", failure_code: code });
    return "failed";
  }

  if (!returned && isAttempt(p) && p.subscription_id) {
    // 실패로 확정된 시도 — 결제를 보내자마자 멈춘 경우 등. 미납으로 넘겨야 다음 시도 번호로 재시도한다
    // (그대로 두면 같은 시도 번호의 실패 행에 막혀 이 주기를 영영 결제하지 못한다)
    const sub = await store.getSubscription(p.subscription_id);
    if (
      sub &&
      sub.provider === "toss" &&
      isLive(sub) &&
      sameInstant(sub.current_period_end, p.period_start) &&
      sub.dunning_attempts < p.attempt
    ) {
      await settleUnpaid(deps, sub, p, { failures: p.attempt, errKind: "retryable" }, patch);
      return "failed";
    }
  }
  await store.updatePayment(p.id, patch);
  return "failed";
}

/** 대사: 토스가 승인됐다고 답했다 */
async function reconcileDone(deps: BillingDeps, p: PaymentRow, found: TossPayment): Promise<Resolution> {
  const { store } = deps;
  if (p.kind === "initial") {
    const checkout = p.checkout_id ? await store.getCheckout(p.checkout_id) : null;
    if (checkout?.status === "failed") {
      // 거절 확정 뒤 정리가 실패해 시도만 failed로 닫힌 경우 — 토스가 승인했다니 구독을 만든다
      await deps.log(`billing reconcile: payment ${p.id} is DONE at toss but checkout ${checkout.id} was closed as failed; activating`);
    }
    const activated = await activateInitialPayment(deps, p, found);
    if (activated === null) {
      await deps.log(`billing reconcile: initial payment ${p.id} is DONE at toss but could not be activated, left pending`);
      return "unresolved";
    }
    // hasActive: 다른 시도가 먼저 구독을 만들어 이번 결제는 돌려줬다 — 이용 기간을 주지 않았다
    return activated === "hasActive" ? "failed" : "paid";
  }
  if (!isAttempt(p) || !p.subscription_id) {
    await deps.log(`billing reconcile: payment ${p.id} (${p.kind}) cannot be settled automatically, left pending`);
    return "unresolved";
  }
  const sub = await store.getSubscription(p.subscription_id);
  if (sub && sub.provider === "toss" && isLive(sub) && sameInstant(sub.current_period_end, p.period_start)) {
    await settlePaid(deps, sub, p, found);
    return "paid";
  }
  await store.updatePayment(p.id, { status: "paid", ...paidFields(deps, found) });
  if (sub && isLive(sub) && sameInstant(sub.current_period_end, p.period_end)) {
    // 앞선 실행이 구독을 전진시킨 뒤 결제 행을 확정하기 전에 멈췄다 — 영수증만 마저 보낸다
    await sendReceipt(deps, sub.user_id, sub.plan_code, p, found);
  } else {
    await deps.log(`billing reconcile: payment ${p.id} is DONE at toss but subscription ${p.subscription_id} is not on its period; needs review`);
  }
  return "paid";
}

async function reconcileOne(deps: BillingDeps, p: PaymentRow): Promise<Resolution> {
  let found: TossPayment | null;
  try {
    found = await deps.toss.getPaymentByOrderId(p.order_id);
  } catch (e) {
    // 결과 불명(연결·5xx)이든 설정 오류든 확정할 근거가 없다 — 그대로 두고 다음 실행에서 다시 본다
    await deps.log(`billing reconcile lookup failed for payment ${p.id}, left pending: ${errorText(e)}`);
    return "unresolved";
  }
  if (found === null) return reconcileNotPaid(deps, p, null, "NOT_FOUND");
  if (found.status === "DONE") return reconcileDone(deps, p, found);
  if (NOT_PAID.has(found.status) || RETURNED.has(found.status)) return reconcileNotPaid(deps, p, found, found.status);
  // IN_PROGRESS 등 — 아직 끝나지 않았다
  await deps.log(`billing reconcile: payment ${p.id} is ${found.status.slice(0, 40)} at toss, left pending`);
  return "unresolved";
}

/** held: 결과를 확정하지 못한 갱신·재시도 결제의 구독 — 이번 실행에서는 끝내지 않는다(결제가 됐을 수 있다) */
async function reconcile(
  deps: BillingDeps,
  livemode: boolean,
  deadline: number,
): Promise<{ counts: { paid: number; failed: number; unresolved: number }; held: Set<string> }> {
  const counts = { paid: 0, failed: 0, unresolved: 0 };
  const held = new Set<string>();
  const pending = await deps.store.listPendingPayments(livemode, iso(deps.now() - RECONCILE_AFTER_MS), RECONCILE_LIMIT);
  for (const p of pending) {
    let result: Resolution;
    if (deps.now() >= deadline) {
      result = "unresolved";
    } else {
      try {
        result = await reconcileOne(deps, p);
      } catch (e) {
        await deps.log(`billing reconcile failed for payment ${p.id}: ${errorText(e)}`);
        result = "unresolved";
      }
    }
    counts[result]++;
    if (result === "unresolved" && p.subscription_id) held.add(p.subscription_id);
  }
  return { counts, held };
}

/** 10분 지난 pending 결제를 토스 주문 조회로 확정한다 */
export async function reconcilePending(deps: BillingDeps, livemode: boolean): Promise<{ paid: number; failed: number; unresolved: number }> {
  return (await reconcile(deps, livemode, Number.POSITIVE_INFINITY)).counts;
}

/** 해지 예약 만료·미납 유예 만료 — 빌링키를 먼저 거두고 구독을 끝낸다(중간에 멈추면 다음 날 다시 끝낸다) */
async function endSubscription(deps: BillingDeps, sub: SubscriptionRow, action: "end_canceled" | "end_unpaid"): Promise<void> {
  const { store } = deps;
  if (sub.user_id) {
    // 사용자·모드당 진행 중 구독은 하나라 지금 고객 행의 빌링키가 이 구독의 것이다.
    // 읽은 암호문일 때만 지운다 — 그 사이 새 결제창이 쓴 빌링키는 남긴다
    const customer = await store.getCustomer(sub.user_id, sub.livemode);
    if (customer?.toss_billing_key_enc) await store.clearCustomerKeyIf(customer.id, customer.toss_billing_key_enc);
  }
  await store.updateSubscription(sub.id, {
    status: "ended",
    ended_reason: action === "end_canceled" ? "user_canceled" : "payment_failed",
    ended_at: iso(deps.now()),
  });
  await sendBillingMail(
    deps,
    sub.user_id,
    "ended",
    { planName: planNameFor(sub.plan_code), reason: action === "end_canceled" ? "canceled" : "unpaid" },
    `subscription ${sub.id}`,
  );
}

/** 결제 예정 안내 — 보내고 나서 기록한다(못 보낸 채 기록되는 것보다 두 번 가는 편이 낫다) */
async function sendReminder(deps: BillingDeps, sub: SubscriptionRow): Promise<void> {
  await sendBillingMail(
    deps,
    sub.user_id,
    "reminder",
    {
      planName: planNameFor(sub.plan_code),
      amount: sub.amount,
      currency: sub.currency,
      // 결제는 기간 끝 하루 전부터 시도한다 — 안내한 날보다 먼저 청구되지 않게 가장 이른 시각을 적는다
      chargeAt: iso(Date.parse(sub.current_period_end) - CHARGE_LEAD_MS),
    },
    `subscription ${sub.id}`,
  );
  await deps.store.updateSubscription(sub.id, { reminder_sent_for: sub.current_period_end });
}

/**
 * 결제 크론 한 번 — ① 대사 ② 후보 구독마다 판정·처리. 예산(기본 240초)을 넘기면 멈추고 남은 건은 다음 날.
 * 반환은 대사 결과·처리 결과별 개수(예: charge_paid, retry_failed, remind, end_unpaid, errors, deferred).
 */
export async function runBillingCycle(
  deps: BillingDeps,
  livemode: boolean,
  opts: { budgetMs?: number; limit?: number } = {},
): Promise<Record<string, number>> {
  const deadline = deps.now() + (opts.budgetMs ?? DEFAULT_BUDGET_MS);
  const { counts: rec, held } = await reconcile(deps, livemode, deadline);
  const summary: Record<string, number> = {
    reconciled_paid: rec.paid,
    reconciled_failed: rec.failed,
    reconciled_unresolved: rec.unresolved,
    candidates: 0,
    errors: 0,
    deferred: 0,
  };
  const bump = (key: string) => {
    summary[key] = (summary[key] ?? 0) + 1;
  };

  const candidates = await deps.store.listCycleCandidates(livemode, iso(deps.now()), opts.limit ?? DEFAULT_LIMIT);
  summary.candidates = candidates.length;
  for (let i = 0; i < candidates.length; i++) {
    if (deps.now() >= deadline) {
      summary.deferred = candidates.length - i;
      break;
    }
    const sub = candidates[i];
    const now = deps.now();
    const action = decideRenewalAction(sub, now);
    try {
      switch (action) {
        case "none":
          bump("none");
          break;
        case "remind":
          await sendReminder(deps, sub);
          bump("remind");
          break;
        case "charge":
          bump(`charge_${await chargeSubscription(deps, sub, "renewal")}`);
          break;
        case "retry":
          bump(`retry_${await chargeSubscription(deps, sub, "retry")}`);
          break;
        case "end_canceled":
        case "end_unpaid": {
          if (held.has(sub.id)) {
            bump("held");
            break;
          }
          // 후보를 읽은 뒤 카드 변경 재결제·해지 취소가 있었을 수 있다 — 끝내기 직전에 다시 읽고 다시 판정한다
          const fresh = await deps.store.getSubscription(sub.id);
          if (!fresh || decideRenewalAction(fresh, now) !== action) {
            bump("changed");
            break;
          }
          await endSubscription(deps, fresh, action);
          bump(action);
          break;
        }
      }
    } catch (e) {
      summary.errors++;
      await deps.log(`billing cycle ${action} failed for subscription ${sub.id}: ${errorText(e)}`);
    }
  }
  return summary;
}
