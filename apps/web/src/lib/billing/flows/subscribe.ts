import "server-only";
import { randomUUID } from "node:crypto";
import { encryptBillingKey } from "@/lib/billing/crypto";
import type { BillingEmailData, BillingEmailKind } from "@/lib/billing/emails";
import { addInterval, kstDayOfMonth } from "@/lib/billing/period";
import {
  TossError,
  classifyTossError,
  isOutcomeUnknown,
  type CardSummary,
  type TossBillingAuth,
  type TossPayment,
} from "@/lib/billing/toss";
import type { BillingDeps, CheckoutRow, PaymentRow, PriceRow, SubscriptionRow } from "@/lib/billing/types";

/**
 * 결제창(토스 카드 등록) 이후의 첫 정기결제 흐름.
 *
 * 돈이 움직이는 단계의 원칙:
 * - 결제 행을 먼저 만들고 그 id를 토스 멱등 키로 쓴다 — 같은 결제를 다시 보내도 한 번만 청구된다.
 * - 결과를 모르는 실패(연결 끊김·5xx·408)는 실패로 확정하지 않는다. 결제 행을 pending, 시도를
 *   processing으로 두고 크론의 대사가 주문 조회로 확정한다.
 * - 이미 구독 중이면 빌링키를 발급하기 전에 멈춘다(발급하면 기존 구독의 카드가 덮인다).
 * 빌링키·authKey는 암호문 열 말고는 어디에도(로그·오류·메일) 남기지 않는다.
 */

export type CheckoutOutcome =
  | { kind: "subscribed"; subscriptionId: string }
  | { kind: "cardChanged"; subscriptionId: string; retry: "paid" | "failed" | "pending" | "none" }
  | { kind: "pending" }
  | { kind: "error"; code: "notFound" | "expired" | "customerMismatch" | "hasActive" | "priceInactive" | "cardRejected" | "failed"; priceId?: string };

type ErrorCode = Extract<CheckoutOutcome, { kind: "error" }>["code"];

/** 사용자가 결제창을 닫거나 그만둔 경우 — 실패가 아니라 취소로 안내한다 */
const CANCEL_CODES = new Set(["PAY_PROCESS_CANCELED", "PAY_PROCESS_ABORTED"]);
const PLAN_NAMES: Record<string, string> = { pro: "Pro", enterprise: "Enterprise" };
const DUPLICATE_CANCEL_REASON = "중복 구독 자동 취소";

const iso = (t: number) => new Date(t).toISOString();
/** 기록용 오류 문자열 — 저장소·토스 오류 메시지에는 비밀 값이 들어가지 않는다(각 모듈의 규칙) */
export const errorText = (e: unknown) =>
  (e instanceof TossError ? `${e.code} (${e.status})` : e instanceof Error ? e.message : String(e)).slice(0, 500);

/** 메일·주문명에 쓰는 플랜 표시 이름 */
export function planNameFor(planCode: string): string {
  return PLAN_NAMES[planCode] ?? planCode.charAt(0).toUpperCase() + planCode.slice(1);
}

export function orderNameFor(planCode: string, interval: "month" | "year"): string {
  return `A11y Check ${planNameFor(planCode)} ${interval === "year" ? "연간" : "월간"} 구독`;
}

export function newOrderId(): string {
  return `pay_${randomUUID()}`;
}

/** 메일에 싣는 카드 표시 — 토스가 준 마스킹 번호만 쓴다(예: "신용 1234****") */
export function cardLabel(card: CardSummary | null): string | null {
  if (!card) return null;
  return [card.cardType, card.number].filter(Boolean).join(" ") || null;
}

/** 토스가 승인한 결제에서 결제 행에 옮겨 적는 값 — 갱신·대사·경합 취소가 함께 쓴다 */
export function paidFields(deps: BillingDeps, charged: TossPayment): Pick<PaymentRow, "external_payment_id" | "approved_at" | "receipt_url" | "card_summary"> {
  return {
    external_payment_id: charged.paymentKey,
    approved_at: charged.approvedAt ?? iso(deps.now()),
    receipt_url: charged.receiptUrl,
    card_summary: charged.card,
  };
}

/** 보낸 금액·주문번호와 응답이 다르면 기록한다 — 결제 행(실제로 요청한 값)을 기준으로 진행하고 운영자가 확인한다 */
export async function warnIfResponseDiffers(deps: BillingDeps, payment: PaymentRow, charged: TossPayment): Promise<void> {
  if (charged.totalAmount === payment.amount && charged.orderId === payment.order_id) return;
  await deps.log(
    `billing payment ${payment.id} response differs from the payment row (amount ${charged.totalAmount} vs ${payment.amount}, orderId ${charged.orderId === payment.order_id ? "same" : "different"})`,
  );
}

/**
 * 결제 메일 — 관리·요금제 주소는 메일러가 붙인다. 메일러는 원래 던지지 않지만, 던지더라도
 * 결제 상태는 이미 바뀐 뒤라 결과를 바꾸지 않고 기록만 한다(ref = 기록에 남길 결제·구독 id).
 */
export async function sendBillingMail<K extends BillingEmailKind>(
  deps: BillingDeps,
  userId: string | null,
  kind: K,
  data: Omit<BillingEmailData[K], "manageUrl" | "pricingUrl">,
  ref: string,
): Promise<void> {
  try {
    await deps.mailer.send(userId, kind, data as Record<string, unknown>);
  } catch (e) {
    await deps.log(`billing ${kind} mail failed for ${ref}: ${errorText(e)}`);
  }
}

/** 결제 완료 영수증 — 금액·통화·기간은 실제로 청구한 결제 행의 값이다 */
export async function sendReceipt(deps: BillingDeps, userId: string | null, planCode: string, payment: PaymentRow, charged: TossPayment): Promise<void> {
  await sendBillingMail(
    deps,
    userId,
    "receipt",
    {
      planName: planNameFor(planCode),
      amount: payment.amount,
      currency: payment.currency,
      periodEnd: payment.period_end ?? "",
      receiptUrl: charged.receiptUrl,
      card: cardLabel(charged.card),
    },
    `payment ${payment.id}`,
  );
}

/** 실행 중 어디까지 왔는지 — 예외가 났을 때 시도를 닫을지, 결제를 대사에 맡길지 정한다 */
interface RunState {
  checkout: CheckoutRow | null;
  /** 이 실행이 고객 행에 쓴 암호문 — 지울 때는 이 값일 때만 지운다 */
  storedKey: { customerId: string; enc: string } | null;
  /** 결제 요청을 보냈고 거절이 확정되지 않았다 — 이후 예외는 돈이 움직였을 수 있어 pending으로 남긴다 */
  moneyInFlight: boolean;
}

export async function completeCheckout(
  deps: BillingDeps,
  input: { checkoutId: string; userId: string; authKey: string; customerKey: string; customerEmail: string | null },
): Promise<CheckoutOutcome> {
  const state: RunState = { checkout: null, storedKey: null, moneyInFlight: false };
  try {
    return await runCheckout(deps, input, state);
  } catch (e) {
    await deps.log(`billing completeCheckout ${input.checkoutId} failed: ${errorText(e)}`);
    // 결제 행은 pending으로 남아 있다 — 대사가 토스 주문 조회로 확정한다
    if (state.moneyInFlight) return { kind: "pending" };
    if (state.checkout) {
      // 돈이 움직이지 않았다(결제 전이거나 거절 확정 뒤) — 이 실행이 쓴 빌링키를 거두고 시도를 닫는다.
      // processing으로 두면 다시 들어올 때 "확인 중"으로 오해된다
      const key = state.storedKey;
      if (key) await deps.store.clearCustomerKeyIf(key.customerId, key.enc).catch(() => false);
      await deps.store.finishCheckout(state.checkout.id, { status: "failed", failure_code: "error" }).catch(() => undefined);
      return { kind: "error", code: "failed", priceId: state.checkout.price_id };
    }
    return { kind: "error", code: "failed" };
  }
}

async function runCheckout(
  deps: BillingDeps,
  input: { checkoutId: string; userId: string; authKey: string; customerKey: string; customerEmail: string | null },
  state: RunState,
): Promise<CheckoutOutcome> {
  const { store } = deps;
  const nowMs = deps.now();
  const nowIso = iso(nowMs);

  // 1. 원자적 선점 — 동시에 두 번 들어와도 한쪽만 결제까지 간다
  const checkout = await store.claimCheckout(input.checkoutId, input.userId, nowIso);
  if (!checkout) return revisit(deps, input);
  state.checkout = checkout;

  const fail = async (code: ErrorCode, failureCode: string): Promise<CheckoutOutcome> => {
    await store.finishCheckout(checkout.id, { status: "failed", failure_code: failureCode });
    return { kind: "error", code, priceId: checkout.price_id };
  };

  // 카드 변경 경로는 아직 없다 — 빌링키를 발급하지 않고 닫는다
  if (checkout.purpose === "card_change") return fail("failed", "notImplemented");

  // 2. 진행 중 구독 — 빌링키 발급 전에 멈춘다(발급하면 고객 행의 카드가 덮인다)
  if (await store.getLiveSubscription(input.userId, checkout.livemode)) return fail("hasActive", "hasActive");

  // 3. 결제창에 넘긴 고객 키와 같아야 한다
  const customer = await store.getCustomer(input.userId, checkout.livemode);
  if (!customer || customer.toss_customer_key !== input.customerKey) return fail("customerMismatch", "customerMismatch");

  // 4. 가격 — 금액은 항상 DB 가격 행에서 읽는다
  const price = await store.getPrice(checkout.price_id);
  if (!price || !price.active || price.provider !== "toss" || price.livemode !== checkout.livemode) {
    return fail("priceInactive", "priceInactive");
  }

  // 5. 빌링키 발급 — 돈은 아직 움직이지 않는다
  let auth: TossBillingAuth;
  try {
    auth = await deps.toss.issueBillingKey(input.authKey, input.customerKey);
  } catch (e) {
    const code = e instanceof TossError ? e.code : "ISSUE_FAILED";
    const cardProblem = e instanceof TossError && classifyTossError(e.code) === "card_action_required";
    if (!cardProblem) await deps.log(`billing issueBillingKey failed for checkout ${checkout.id}: ${errorText(e)}`);
    return fail(cardProblem ? "cardRejected" : "failed", code);
  }

  // 6. 암호화해 저장 — 평문 빌링키는 이 함수의 지역 변수로만 남는다
  const enc = encryptBillingKey(auth.billingKey, { userId: input.userId, livemode: checkout.livemode }, deps.encKey);
  await store.updateCustomer(customer.id, { toss_billing_key_enc: enc, toss_card_summary: auth.card });
  state.storedKey = { customerId: customer.id, enc };
  // 지울 때는 이 실행이 쓴 암호문일 때만 — 그 사이 다른 시도가 쓴 빌링키는 그 시도의 것이다
  const forgetCard = () => store.clearCustomerKeyIf(customer.id, enc);

  // 7. 기간 — 오늘부터, 앵커일은 오늘의 KST 일자
  const anchor = kstDayOfMonth(nowMs);
  const periodEnd = addInterval(nowIso, price.interval, anchor);

  // 8. 결제 행을 먼저 만든다 — 그 id가 토스 멱등 키다
  const payment = await store.insertPayment({
    user_id: input.userId,
    subscription_id: null,
    checkout_id: checkout.id,
    provider: "toss",
    livemode: checkout.livemode,
    kind: "initial",
    order_id: newOrderId(),
    amount: price.amount,
    currency: price.currency,
    period_start: nowIso,
    period_end: periodEnd,
    attempt: 1,
    status: "pending",
  });
  if (payment === "duplicate") {
    // 주문번호 충돌(UUID라 사실상 없음) — 결제를 보내지 않았으니 실패로 닫는다
    await forgetCard();
    return fail("failed", "duplicate");
  }

  // 9. 결제
  state.moneyInFlight = true;
  let charged: TossPayment;
  try {
    charged = await deps.toss.chargeBillingKey(
      auth.billingKey,
      {
        customerKey: input.customerKey,
        amount: payment.amount,
        orderId: payment.order_id,
        orderName: orderNameFor(price.plan_code, price.interval),
        ...(input.customerEmail ? { customerEmail: input.customerEmail } : {}),
      },
      payment.id,
    );
  } catch (e) {
    if (!(e instanceof TossError) || isOutcomeUnknown(e)) {
      // 결과 불명 — 결제 pending·시도 processing 그대로, 대사가 확정한다
      await deps.log(`billing initial charge outcome unknown, payment ${payment.id}: ${errorText(e)}`);
      return { kind: "pending" };
    }
    // 토스가 거절했다고 답했다 — 돈은 움직이지 않았다. 이후 정리가 실패하면 시도를 failed로 닫는다
    state.moneyInFlight = false;
    await store.updatePayment(payment.id, { status: "failed", failure_code: e.code, failure_message: e.message });
    await forgetCard();
    const kind = classifyTossError(e.code);
    if (kind === "fatal") await deps.log(`billing initial charge fatal error, payment ${payment.id}: ${errorText(e)}`);
    return fail(kind === "card_action_required" ? "cardRejected" : "failed", e.code);
  }
  if (charged.status !== "DONE") {
    await deps.log(`billing initial charge payment ${payment.id} returned status ${charged.status.slice(0, 40)}, left pending`);
    return { kind: "pending" };
  }

  // 10. 구독 생성
  const activated = await activateInitialPayment(deps, payment, charged);
  if (activated === "hasActive") return { kind: "error", code: "hasActive", priceId: checkout.price_id };
  if (activated === null) {
    await deps.log(`billing initial payment ${payment.id} charged but could not be activated`);
    return { kind: "pending" };
  }
  return { kind: "subscribed", subscriptionId: activated };
}

/** 선점하지 못한 시도 — 새로고침·뒤로 가기·동시 요청 */
async function revisit(deps: BillingDeps, input: { checkoutId: string; userId: string }): Promise<CheckoutOutcome> {
  const existing = await deps.store.getCheckout(input.checkoutId);
  // 다른 사용자의 시도는 있다는 사실도 알리지 않는다
  if (!existing || existing.user_id !== input.userId) return { kind: "error", code: "notFound" };
  if (existing.status === "completed" && existing.purpose === "subscribe" && existing.subscription_id) {
    return { kind: "subscribed", subscriptionId: existing.subscription_id };
  }
  // 결제를 확인하는 중(결과 불명·동시 요청) — "만료"로 안내하면 다시 결제해 이중 청구가 날 수 있다
  if (existing.status === "processing") return { kind: "pending" };
  return { kind: "error", code: "expired", priceId: existing.price_id };
}

/** 앞선 실행이 이 결제로 만든 구독인지 — 같은 가격으로 이 결제의 기간 시작 시각에 시작했다 */
function createdBy(sub: SubscriptionRow, payment: PaymentRow, price: PriceRow): boolean {
  return (
    sub.provider === "toss" &&
    sub.price_id === price.id &&
    payment.period_start !== null &&
    Date.parse(sub.current_period_start) === Date.parse(payment.period_start)
  );
}

/**
 * 첫 결제 성공 → 구독 생성(대사도 쓴다). 구독 id, 경합으로 취소했으면 "hasActive", 시도·가격을 못 찾으면 null.
 * 다시 불러도 안전하다: 앞선 실행이 구독까지 만들고 멈췄다면 그 구독으로 마무리하고 취소하지 않는다.
 */
export async function activateInitialPayment(
  deps: BillingDeps,
  payment: PaymentRow,
  charged: TossPayment,
): Promise<string | "hasActive" | null> {
  const { store } = deps;
  if (!payment.checkout_id || !payment.user_id || !payment.period_start || !payment.period_end) return null;
  const checkout = await store.getCheckout(payment.checkout_id);
  if (!checkout) return null;
  const price = await store.getPrice(checkout.price_id);
  if (!price) return null;
  const userId = payment.user_id;
  await warnIfResponseDiffers(deps, payment, charged);

  // 금액 스냅샷은 실제로 청구한 결제 행의 값이다
  const inserted = await store.insertSubscription({
    user_id: userId,
    provider: "toss",
    livemode: payment.livemode,
    plan_code: price.plan_code,
    price_id: price.id,
    amount: payment.amount,
    currency: payment.currency,
    interval: price.interval,
    current_period_start: payment.period_start,
    current_period_end: payment.period_end,
    billing_anchor_day: kstDayOfMonth(Date.parse(payment.period_start)),
  });

  let subscriptionId: string;
  if (inserted === "hasActive") {
    const live = await store.getLiveSubscription(userId, payment.livemode);
    if (!live || !createdBy(live, payment, price)) return cancelDuplicate(deps, payment, checkout, charged);
    subscriptionId = live.id;
  } else {
    subscriptionId = inserted.id;
  }

  await store.updatePayment(payment.id, { status: "paid", ...paidFields(deps, charged), subscription_id: subscriptionId });
  await store.linkConsents(checkout.id, subscriptionId);
  await store.finishCheckout(checkout.id, { status: "completed", subscription_id: subscriptionId });

  // 구독이 만들어진 뒤라 메일 실패는 결과를 바꾸지 않는다
  await sendReceipt(deps, userId, price.plan_code, payment, charged);
  return subscriptionId;
}

/** 결제는 됐는데 다른 시도가 먼저 구독을 만들었다 — 이번 결제를 돌려준다 */
async function cancelDuplicate(deps: BillingDeps, payment: PaymentRow, checkout: CheckoutRow, charged: TossPayment): Promise<"hasActive"> {
  const settled = paidFields(deps, charged);
  let refunded = false;
  try {
    await deps.toss.cancelPayment(charged.paymentKey, { cancelReason: DUPLICATE_CANCEL_REASON }, `cancel_${payment.id}`);
    refunded = true;
  } catch (e) {
    // 환불됐다고 적지 않는다 — 운영자가 결제 id로 찾아 수동 환불한다
    await deps.log(`billing duplicate subscription cancel failed, payment ${payment.id} needs manual refund: ${errorText(e)}`);
  }
  await deps.store.updatePayment(
    payment.id,
    refunded
      ? { ...settled, status: "refunded", refunded_amount: payment.amount }
      : { ...settled, status: "paid", failure_code: "CANCEL_FAILED" },
  );
  await deps.store.finishCheckout(checkout.id, { status: "failed", failure_code: "hasActive" });
  return "hasActive";
}

/** 결제창 실패 코드는 URL에서 온다 — 토스 코드 모양이 아니면 저장하지 않는다 */
const FAIL_CODE_RE = /^[A-Z0-9_]{1,64}$/;

/** 결제창에서 실패·취소하고 돌아왔을 때. priceId를 돌려줘 결제 화면으로 되돌린다 */
export async function failCheckout(
  deps: BillingDeps,
  input: { checkoutId: string; userId: string; code: string },
): Promise<{ priceId: string | null; reason: "canceled" | "failed" }> {
  const reason = CANCEL_CODES.has(input.code) ? "canceled" : "failed";
  const code = FAIL_CODE_RE.test(input.code) ? input.code : "UNKNOWN";
  try {
    // 선점으로 open → processing을 원자적으로 잡은 뒤 닫는다 — 같은 시도의 결제 처리와 엇갈려도 덮지 않는다
    const claimed = await deps.store.claimCheckout(input.checkoutId, input.userId, iso(deps.now()));
    if (claimed) {
      await deps.store.finishCheckout(claimed.id, { status: "failed", failure_code: code });
      return { priceId: claimed.price_id, reason };
    }
    const existing = await deps.store.getCheckout(input.checkoutId);
    return { priceId: existing && existing.user_id === input.userId ? existing.price_id : null, reason };
  } catch (e) {
    await deps.log(`billing failCheckout ${input.checkoutId} failed: ${errorText(e)}`);
    return { priceId: null, reason };
  }
}
