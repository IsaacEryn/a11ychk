import "server-only";
import { decryptBillingKey } from "@/lib/billing/crypto";
import {
  addInterval,
  earliestChargeAt,
  graceUntil,
  kstDayOfMonth,
  nextRetryAt,
  reminderLeadMs,
} from "@/lib/billing/period";
import { FATAL_TOSS_CODES, TossError, classifyTossError, isOutcomeUnknown, type TossPayment } from "@/lib/billing/toss";
import type { BillingDeps, PaymentRow, SubscriptionExpectation, SubscriptionRow } from "@/lib/billing/types";
import { closeEndedSubscription } from "@/lib/billing/flows/end";
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
 * 구독은 조건부로만 고친다(읽은 상태·기간 끝과 같을 때만). 크론이 후보를 읽고 처리하는 사이 카드 변경
 * 재결제·해지가 구독을 바꿨다면 덮어쓰지 않는다. 쓰는 순서는 구독을 먼저, 결제 행을 나중에 — 중간에
 * 멈추면 결제 행이 pending으로 남아 다음 날 대사가 토스 조회로 마무리한다. 반대 순서면 결제 행은 끝났는데
 * 구독은 그대로라, 같은 시도 번호에 막혀 영영 갱신되지 않는다.
 *
 * 설정 사고(토스 fatal 코드·빌링키 복호화 실패)는 카드 실패가 아니다. 사용자에게 알리지 않고, 새 시도 번호를
 * 비운 뒤 다음 날 다시 시도한다. 계정 단위 코드(키·권한)면 그 실행의 남은 결제를 멈춘다 — 같은 원인으로
 * 모두 실패한다. 요청 형식 오류·복호화 실패는 그 행만의 사고라 다른 행은 계속 결제한다.
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
/** 설정 사고 뒤 다시 시도하기까지 — 다음 날 크론(Hobby는 정시 ±59분)이 늘 기한이 지난 것으로 보게 24시간보다 짧게 */
const INCIDENT_RETRY_MS = 20 * 3_600_000;
const NO_BILLING_KEY = "NO_BILLING_KEY";
const DECRYPT_FAILED = "DECRYPT_FAILED";
/** 토스 계정 단위 오류 — 다른 행도 같은 이유로 실패하니 그 실행의 결제를 멈춘다 */
const ACCOUNT_HALT_CODES = new Set(["UNAUTHORIZED_KEY", "INVALID_API_KEY", "FORBIDDEN_REQUEST"]);
/**
 * 행 단위 사고(복호화 실패·요청 형식 오류)도 같은 코드로 이만큼 연달아 나면 실제로는 전역 원인(암호화 키
 * 환경변수·요청 조립 회귀)으로 보고 그 실행의 결제를 멈춘다
 */
const INCIDENT_STREAK_HALT = 3;
/**
 * 사용자에게 실패 메일을 보내지 않은 실패 코드 — 설정 사고와 대사로 확정한 실패. 같은 기간에 이것만 있었다면
 * 다음의 실제 카드 거절이 그 기간의 첫 안내다(이 목록은 여기 한 곳에서만 정한다)
 */
const NOT_USER_FACING = { codes: [DECRYPT_FAILED, ...FATAL_TOSS_CODES], prefixes: ["RECONCILED_"] } as const;
const LIVE: SubscriptionExpectation["statuses"] = ["active", "past_due"];
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
/** 읽은 그 기간에 아직 진행 중일 때만 */
const onPeriod = (periodEnd: string): SubscriptionExpectation => ({ statuses: LIVE, currentPeriodEnd: periodEnd });

export function decideRenewalAction(sub: SubscriptionRow, now: number): RenewalAction {
  if (sub.provider !== "toss" || !isLive(sub) || sub.interval === "contract") return "none";
  const end = Date.parse(sub.current_period_end);
  // 해지를 예약했으면 결제하지 않는다. 미납 중 해지는 바로 끝내는 게 규칙이라 원래 없는 조합이지만,
  // 생기더라도 해지한 사람에게 재결제하지 않게 같은 규칙으로 끝낸다
  if (sub.cancel_at_period_end) return now >= end ? "end_canceled" : "none";
  if (sub.status === "active") {
    if (now >= Date.parse(earliestChargeAt(sub.current_period_end))) return "charge";
    if (now >= end - reminderLeadMs(sub.interval) && !sameInstant(sub.reminder_sent_for, sub.current_period_end)) return "remind";
    return "none";
  }
  const grace = Date.parse(sub.grace_until ?? graceUntil(sub.current_period_end));
  if (now >= grace) return "end_unpaid";
  if (sub.next_retry_at !== null && now >= Date.parse(sub.next_retry_at)) return "retry";
  return "none";
}

type KeyLookup = { ok: true; billingKey: string; customerKey: string } | { ok: false; reason: "missing" | "undecryptable" };

/**
 * 고객 행의 빌링키. 고객 행·암호문이 없으면 사용자가 카드를 다시 등록해야 하고(missing),
 * 암호문이 있는데 풀리지 않으면 암호화 키가 바뀐 설정 사고다(undecryptable).
 */
async function loadBillingKey(deps: BillingDeps, sub: SubscriptionRow): Promise<KeyLookup> {
  if (!sub.user_id) return { ok: false, reason: "missing" };
  const customer = await deps.store.getCustomer(sub.user_id, sub.livemode);
  if (!customer?.toss_billing_key_enc || !customer.toss_customer_key) return { ok: false, reason: "missing" };
  const billingKey = decryptBillingKey(customer.toss_billing_key_enc, { userId: sub.user_id, livemode: sub.livemode }, deps.encKey);
  if (!billingKey) return { ok: false, reason: "undecryptable" };
  return { ok: true, billingKey, customerKey: customer.toss_customer_key };
}

/**
 * 결제 성공 — 구독이 아직 이 결제의 기간 시작에 있으면 한 주기 전진시키고(먼저) 결제 행을 paid로 확정한다.
 * 그 사이 구독이 바뀌었으면 되살리거나 덮어쓰지 않는다. 앞선 실행이 이미 이 결제로 전진시켰다면 영수증만
 * 마저 보내고, 아니면(끝났거나 다른 기간) 돈은 받았으니 결제는 paid로 두고 운영자 확인을 남긴다.
 */
async function settlePaid(deps: BillingDeps, sub: SubscriptionRow, payment: PaymentRow, charged: TossPayment): Promise<void> {
  if (!payment.period_start || !payment.period_end) throw new Error(`billing payment ${payment.id} has no period`);
  const { store } = deps;
  await warnIfResponseDiffers(deps, payment, charged);
  const advanced = await store.updateSubscriptionIf(sub.id, onPeriod(payment.period_start), {
    status: "active",
    current_period_start: payment.period_start,
    current_period_end: payment.period_end,
    dunning_attempts: 0,
    next_retry_at: null,
    grace_until: null,
    reminder_sent_for: null,
  });
  await store.updatePayment(payment.id, { status: "paid", ...paidFields(deps, charged) });
  if (!advanced) {
    const current = await store.getSubscription(sub.id);
    if (!current || !isLive(current) || !sameInstant(current.current_period_end, payment.period_end)) {
      await deps.log(`billing payment ${payment.id} is paid but subscription ${sub.id} is no longer on that period; needs review`);
      return;
    }
  }
  await sendReceipt(deps, sub.user_id, sub.plan_code, payment, charged);
}

/**
 * 결제 실패(카드 거절·빌링키 없음·대사로 확정된 실패) — 미납으로 넘기고(먼저) 결제 행을 확정한다.
 * 기간 끝(결제 예정 시각)은 미납 동안 바뀌지 않아 재시도·유예가 모두 그 시각 기준이다.
 * 메일은 notify이고 구독을 실제로 바꿨을 때만. 카드를 바꿔야 하는 실패는 늘 보내고, 재시도로 풀릴 수 있는
 * 실패는 그 기간에 사용자에게 알린 실패가 아직 없을 때만 보낸다(설정 사고·대사 실패 뒤의 첫 거절도 알린다).
 */
async function settleUnpaid(
  deps: BillingDeps,
  sub: SubscriptionRow,
  payment: PaymentRow,
  failure: { failures: number; retryable: boolean; notify: boolean },
  paymentPatch: Partial<Omit<PaymentRow, "id">>,
): Promise<void> {
  const end = sub.current_period_end;
  const grace = graceUntil(end);
  const moved = await deps.store.updateSubscriptionIf(sub.id, onPeriod(end), {
    status: "past_due",
    dunning_attempts: failure.failures,
    next_retry_at: failure.retryable ? nextRetryAt(end, failure.failures) : null,
    grace_until: grace,
  });
  // 이번 결제 행은 아직 pending이라 세지 않는다 — 확정하기 전에 본다
  const notify =
    moved &&
    failure.notify &&
    (!failure.retryable || !(await deps.store.hasUserFacingFailure(sub.id, payment.period_start ?? end, NOT_USER_FACING)));
  await deps.store.updatePayment(payment.id, paymentPatch);
  if (notify) {
    await sendBillingMail(
      deps,
      sub.user_id,
      "failed",
      { planName: planNameFor(sub.plan_code), amount: sub.amount, currency: sub.currency, graceUntil: grace, needsCardChange: !failure.retryable },
      `payment ${payment.id}`,
    );
  }
}

/**
 * 설정 사고 — 사용자 탓이 아니라 메일을 보내지 않는다. 시도 번호를 하나 올려 새 시도 칸을 비우고 다음 날
 * 다시 시도한다. 유예는 기간 끝 기준 그대로(이미 정했으면 바꾸지 않는다). 기록에는 코드만 남긴다.
 */
async function settleIncident(
  deps: BillingDeps,
  sub: SubscriptionRow,
  payment: PaymentRow,
  kind: "renewal" | "retry",
  code: string,
  halt: boolean,
): Promise<void> {
  await deps.store.updateSubscriptionIf(sub.id, onPeriod(sub.current_period_end), {
    status: "past_due",
    dunning_attempts: sub.dunning_attempts + 1,
    next_retry_at: iso(deps.now() + INCIDENT_RETRY_MS),
    grace_until: sub.grace_until ?? graceUntil(sub.current_period_end),
  });
  await deps.store.updatePayment(payment.id, { status: "failed", failure_code: code, failure_message: null });
  await deps.log(
    halt
      ? `billing ${kind} charging halted by operational error ${code}, payment ${payment.id}; remaining charges in this run skipped`
      : `billing ${kind} operational error ${code}, payment ${payment.id}; retrying later`,
  );
}

/** 크론용 결과 — incident: 그 행만의 설정 사고, halted: 계정 단위 사고라 이 실행의 남은 결제를 멈춰야 한다 */
type ChargeOutcome = { result: ChargeResult } | { result: "incident" | "halted"; code: string };

/**
 * 결제 행을 쓴 뒤 다시 읽은 구독이 판정한 그대로인지 — 같은 상태·같은 기간 끝·해지 예약 없음, 재시도면 같은 실패 횟수.
 * 크론은 후보를 실행 처음에 한 번 읽어 그 사이 해지 예약·카드 변경 재결제·종료를 모른다. 해지는 예약을 먼저 쓰고
 * 결과를 모르는 결제가 있는지 본다 — 양쪽 다 먼저 쓰고 나중에 읽으므로 둘 중 하나는 반드시 상대를 본다.
 */
function stillChargeable(candidate: SubscriptionRow, fresh: SubscriptionRow | null, kind: "renewal" | "retry"): fresh is SubscriptionRow {
  return (
    !!fresh &&
    fresh.status === candidate.status &&
    sameInstant(fresh.current_period_end, candidate.current_period_end) &&
    !fresh.cancel_at_period_end &&
    (kind !== "retry" || fresh.dunning_attempts === candidate.dunning_attempts)
  );
}

/**
 * 보내지 않은 결제 행을 지운다 — 실패로 닫으면 안 된다: 결제 행 유니크(구독·기간 시작·시도 번호)는 상태와 무관하고
 * 갱신은 늘 시도 1이라, 실패 행이 남으면 그 기간의 다음 갱신이 모두 duplicate(skipped)가 되어 영영 결제·미납·종료되지 않는다.
 * 지우지 못하면 운영자 확인을 남긴다(id만).
 */
async function discardUnsentPayment(deps: BillingDeps, payment: PaymentRow): Promise<void> {
  let removed = false;
  try {
    removed = await deps.store.deletePendingPayment(payment.id);
  } catch {
    removed = false;
  }
  if (!removed) {
    await deps.log(`billing needs review: unsent payment ${payment.id} for subscription ${payment.subscription_id ?? "none"} could not be removed`);
  }
}

async function chargeOnce(deps: BillingDeps, candidate: SubscriptionRow, kind: "renewal" | "retry"): Promise<ChargeOutcome> {
  if (candidate.provider !== "toss" || !isLive(candidate) || candidate.interval === "contract") return { result: "skipped" };
  const interval = candidate.interval;
  // 앵커일로 계산한다 — 앞 기간 끝의 일자를 쓰면 2월을 지난 31일 구독이 28일로 굳는다
  const anchor = candidate.billing_anchor_day ?? kstDayOfMonth(Date.parse(candidate.current_period_end));
  const failures = candidate.dunning_attempts + 1;

  // 결제 행을 먼저 만든다 — 같은 주기·같은 시도의 행이 있으면 다른 실행이 맡았다. 행 id가 토스 멱등 키다
  const payment = await deps.store.insertPayment({
    user_id: candidate.user_id,
    subscription_id: candidate.id,
    checkout_id: null,
    provider: "toss",
    livemode: candidate.livemode,
    kind,
    order_id: newOrderId(),
    amount: candidate.amount,
    currency: candidate.currency,
    period_start: candidate.current_period_end,
    period_end: addInterval(candidate.current_period_end, interval, anchor),
    attempt: kind === "renewal" ? 1 : failures,
    status: "pending",
  });
  if (payment === "duplicate") return { result: "skipped" };

  // 그다음 구독을 다시 읽는다 — 판정한 뒤 해지 예약·재결제·종료가 있었으면 토스를 부르지 않고 행을 거둔다
  const fresh = await deps.store.getSubscription(candidate.id);
  if (!stillChargeable(candidate, fresh, kind)) {
    await discardUnsentPayment(deps, payment);
    return { result: "skipped" };
  }
  const sub = fresh;

  const key = await loadBillingKey(deps, sub);
  if (!key.ok) {
    if (key.reason === "undecryptable") {
      await settleIncident(deps, sub, payment, kind, DECRYPT_FAILED, false);
      return { result: "incident", code: DECRYPT_FAILED };
    }
    await settleUnpaid(deps, sub, payment, { failures, retryable: false, notify: true }, { status: "failed", failure_code: NO_BILLING_KEY, failure_message: null });
    return { result: "failed" };
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
        return { result: "pending" };
      }
      // 토스가 거절했다고 답했다 — 돈은 움직이지 않았다
      moneyInFlight = false;
      const errKind = classifyTossError(e.code);
      if (errKind === "fatal") {
        const halt = ACCOUNT_HALT_CODES.has(e.code);
        await settleIncident(deps, sub, payment, kind, e.code, halt);
        return { result: halt ? "halted" : "incident", code: e.code };
      }
      await settleUnpaid(
        deps,
        sub,
        payment,
        { failures, retryable: errKind === "retryable", notify: true },
        { status: "failed", failure_code: e.code, failure_message: e.message },
      );
      return { result: "failed" };
    }
    if (charged.status !== "DONE") {
      await deps.log(`billing ${kind} charge payment ${payment.id} returned status ${charged.status.slice(0, 40)}, left pending`);
      return { result: "pending" };
    }
    await settlePaid(deps, sub, payment, charged);
    return { result: "paid" };
  } catch (e) {
    if (!moneyInFlight) throw e;
    await deps.log(`billing ${kind} payment ${payment.id} may have been charged but was not settled, left pending: ${errorText(e)}`);
    return { result: "pending" };
  }
}

/**
 * 갱신·재시도 결제 한 번 — 카드 변경 직후 재결제도 쓴다.
 * paid: 결제됨 / failed: 미납으로 넘김(설정 사고 포함) / pending: 결과 불명(대사가 확정) / skipped: 이 주기·시도는 이미 처리 중이거나 끝남.
 * 돈이 움직이기 전의 저장소 오류는 그대로 던진다(호출부가 기록). 결제 행이 먼저 만들어졌다면 pending으로 남아 대사가 정리한다.
 */
export async function chargeSubscription(deps: BillingDeps, sub: SubscriptionRow, kind: "renewal" | "retry"): Promise<ChargeResult> {
  const { result } = await chargeOnce(deps, sub, kind);
  return result === "halted" || result === "incident" ? "failed" : result;
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

  if (p.kind === "initial") {
    if (returned) await deps.log(`billing reconcile: initial payment ${p.id} was ${status.toLowerCase()} at toss, recorded as ${returned}; manual check`);
    await store.updatePayment(p.id, patch);
    // 끝나지 않은(open·processing) 시도만 닫힌다
    if (p.checkout_id) await store.finishCheckout(p.checkout_id, { status: "failed", failure_code: code });
    return "failed";
  }

  const sub = isAttempt(p) && p.subscription_id ? await store.getSubscription(p.subscription_id) : null;
  const onThisPeriod = !!sub && sub.provider === "toss" && isLive(sub) && sameInstant(sub.current_period_end, p.period_start);

  if (returned) {
    // 우리 흐름은 갱신 결제를 취소하지 않는다 — 토스 쪽에서 돌려준 결제다. 다시 청구하지 않고(재시도 없음)
    // 유예가 끝나면 저절로 끝나게 미납으로 둔다. 시도 번호는 올려 둔다(카드 변경 재결제가 막히지 않게)
    if (sub && onThisPeriod) {
      await store.updateSubscriptionIf(sub.id, onPeriod(sub.current_period_end), {
        status: "past_due",
        dunning_attempts: Math.max(sub.dunning_attempts, p.attempt),
        next_retry_at: null,
        grace_until: graceUntil(sub.current_period_end),
      });
    }
    await store.updatePayment(p.id, patch);
    await deps.log(`billing manual check: ${p.kind} canceled at Toss, subscription ${p.subscription_id ?? "none"}, payment ${p.id}`);
    return "failed";
  }

  // 실패로 확정된 시도(결제를 보내자마자 멈춘 경우 등) — 미납으로 넘겨야 다음 시도 번호로 재시도한다.
  // 그대로 두면 같은 시도 번호의 실패 행에 막혀 이 주기를 영영 결제하지 못한다. 카드 거절이 확인된 게
  // 아니라 사용자 메일은 보내지 않는다
  if (sub && onThisPeriod && sub.dunning_attempts < p.attempt) {
    await settleUnpaid(deps, sub, p, { failures: p.attempt, retryable: true, notify: false }, patch);
    return "failed";
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
    // duplicateRefunded: 다른 시도가 먼저 구독을 만들어 이번 결제는 돌려줬다(또는 수동 환불 대상) — 이용 기간을 주지 않았다
    return activated === "duplicateRefunded" ? "failed" : "paid";
  }
  if (!isAttempt(p) || !p.subscription_id) {
    await deps.log(`billing reconcile: payment ${p.id} (${p.kind}) cannot be settled automatically, left pending`);
    return "unresolved";
  }
  const sub = await store.getSubscription(p.subscription_id);
  if (!sub) {
    await store.updatePayment(p.id, { status: "paid", ...paidFields(deps, found) });
    await deps.log(`billing payment ${p.id} is paid but subscription ${p.subscription_id} is gone; needs review`);
    return "paid";
  }
  await settlePaid(deps, sub, p, found);
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

async function reconcile(deps: BillingDeps, livemode: boolean, deadline: number): Promise<{ paid: number; failed: number; unresolved: number }> {
  const counts = { paid: 0, failed: 0, unresolved: 0 };
  const pending = await deps.store.listPendingPayments(livemode, iso(deps.now() - RECONCILE_AFTER_MS), RECONCILE_LIMIT);
  for (const p of pending) {
    if (deps.now() >= deadline) {
      counts.unresolved++;
      continue;
    }
    try {
      counts[await reconcileOne(deps, p)]++;
    } catch (e) {
      await deps.log(`billing reconcile failed for payment ${p.id}: ${errorText(e)}`);
      counts.unresolved++;
    }
  }
  return counts;
}

/** 10분 지난 pending 결제를 토스 주문 조회로 확정한다 */
export async function reconcilePending(deps: BillingDeps, livemode: boolean): Promise<{ paid: number; failed: number; unresolved: number }> {
  return reconcile(deps, livemode, Number.POSITIVE_INFINITY);
}

/**
 * 해지 예약 만료·미납 유예 만료 — 판정한 그 기간에 아직 있을 때만 끝낸다(false면 그 사이 바뀜).
 * 끝낸 뒤 빌링키를 거둔다: 먼저 거두면 그 사이 재결제로 되살아난 구독이 갱신할 카드를 잃는다.
 */
async function endSubscription(deps: BillingDeps, sub: SubscriptionRow, action: "end_canceled" | "end_unpaid"): Promise<boolean> {
  const { store } = deps;
  // 해지 예약 만료는 그 사이 해지를 취소(재개)했으면 끝내지 않는다
  const expected = action === "end_canceled" ? { ...onPeriod(sub.current_period_end), cancelAtPeriodEnd: true } : onPeriod(sub.current_period_end);
  const ended = await store.updateSubscriptionIf(sub.id, expected, {
    status: "ended",
    ended_reason: action === "end_canceled" ? "user_canceled" : "payment_failed",
    ended_at: iso(deps.now()),
  });
  if (!ended) return false;
  // 빌링키(읽은 암호문일 때만)를 거두고 종료 메일 — 사용자의 즉시 해지(manage.ts)와 같은 정리
  await closeEndedSubscription(deps, sub, action === "end_canceled" ? "canceled" : "unpaid");
  return true;
}

/** 결제 예정 안내 — 이번 기간 안내를 먼저 선점(기록)한 실행만 보낸다. 겹친 크론이 두 번 보내지 않게 */
async function sendReminder(deps: BillingDeps, sub: SubscriptionRow): Promise<boolean> {
  const end = sub.current_period_end;
  const claimed = await deps.store.updateSubscriptionIf(
    sub.id,
    { statuses: ["active"], currentPeriodEnd: end, reminderNotSentFor: end },
    { reminder_sent_for: end },
  );
  if (!claimed) return false;
  await sendBillingMail(
    deps,
    sub.user_id,
    "reminder",
    {
      planName: planNameFor(sub.plan_code),
      amount: sub.amount,
      currency: sub.currency,
      // 결제는 기간 끝 하루 전부터 시도한다 — 안내한 날보다 먼저 청구되지 않게 가장 이른 시각을 적는다(결제 확인 화면과 같은 규칙)
      chargeAt: earliestChargeAt(end),
    },
    `subscription ${sub.id}`,
  );
  return true;
}

/**
 * 결제 크론 한 번 — ① 대사 ② 후보 구독마다 판정·처리. 예산(기본 240초)을 넘기면 멈추고 남은 건은 다음 날.
 * 계정 단위 설정 사고가 나면 halted = 1이고 그 실행의 남은 결제·재시도는 halt_skipped로 미룬다(종료·안내는 계속).
 * 그 행만의 사고는 charge_incident·retry_incident로 세고 다음 행을 계속 처리한다. 다만 같은 코드의 행 사고가
 * 연달아 INCIDENT_STREAK_HALT번 나면 그 자리에서 같은 방식으로 멈춘다(결제 결과가 하나라도 끼면 다시 센다).
 * 반환은 대사 결과·처리 결과별 개수(예: charge_paid, retry_failed, remind, end_unpaid, held, errors, deferred).
 */
export async function runBillingCycle(
  deps: BillingDeps,
  livemode: boolean,
  opts: { budgetMs?: number; limit?: number } = {},
): Promise<Record<string, number>> {
  const { store } = deps;
  const deadline = deps.now() + (opts.budgetMs ?? DEFAULT_BUDGET_MS);
  const rec = await reconcile(deps, livemode, deadline);
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
  let halted = false;
  /** 같은 코드의 행 단위 사고가 몇 번 연달아 났는지 — 결제·재시도 결과만 센다 */
  const streak = { code: "", count: 0 };

  const candidates = await store.listCycleCandidates(livemode, iso(deps.now()), opts.limit ?? DEFAULT_LIMIT);
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
          bump((await sendReminder(deps, sub)) ? "remind" : "remind_skipped");
          break;
        case "charge":
        case "retry": {
          if (halted) {
            bump("halt_skipped");
            break;
          }
          const outcome = await chargeOnce(deps, sub, action === "charge" ? "renewal" : "retry");
          bump(`${action}_${outcome.result}`);
          if (outcome.result === "halted") {
            halted = true;
            summary.halted = 1;
          } else if (outcome.result === "incident") {
            streak.count = streak.code === outcome.code ? streak.count + 1 : 1;
            streak.code = outcome.code;
            if (streak.count >= INCIDENT_STREAK_HALT) {
              // 이미 처리한 행은 행 단위 사고 상태 그대로 두고, 남은 결제만 멈춘다. 기록은 코드만 한 번
              halted = true;
              summary.halted = 1;
              await deps.log(`billing halted: ${outcome.code} repeated`);
            }
          } else {
            streak.code = "";
            streak.count = 0;
          }
          break;
        }
        case "end_canceled":
        case "end_unpaid": {
          // 결과를 모르는 결제가 있으면(나이·대사 한도와 무관하게) 끝내지 않는다 — 결제가 됐을 수 있다
          if (await store.hasPendingPayment(sub.id)) {
            bump("held");
            break;
          }
          // 후보를 읽은 뒤 카드 변경 재결제·해지 취소가 있었을 수 있다 — 다시 읽고 다시 판정한 뒤 조건부로 끝낸다
          const fresh = await store.getSubscription(sub.id);
          if (!fresh || decideRenewalAction(fresh, now) !== action || !(await endSubscription(deps, fresh, action))) {
            bump("changed");
            break;
          }
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
