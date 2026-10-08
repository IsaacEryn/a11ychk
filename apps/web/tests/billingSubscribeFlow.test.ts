import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { decryptBillingKey } from "../src/lib/billing/crypto";
import { addInterval } from "../src/lib/billing/period";
import { TossError } from "../src/lib/billing/toss";
import type { CheckoutRow, SubscriptionRow } from "../src/lib/billing/types";
import {
  activateInitialPayment,
  completeCheckout,
  failCheckout,
  newOrderId,
  orderNameFor,
} from "../src/lib/billing/flows/subscribe";
import { createSupabaseBillingStore } from "../src/lib/billing/store";
import { createBillingMailer } from "../src/lib/billing/server";
import {
  DAY,
  MIN,
  NOW,
  billingAuth,
  checkoutRow,
  createFakeToss,
  createMemoryStore,
  customerRow,
  iso,
  makeDeps,
  paymentRow,
  pgTime,
  priceRow,
  subscriptionRow,
  tossPayment,
  type ConsentRow,
  type MemoryRows,
  type TossScript,
} from "./billingFakes";

const USER = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const CUSTOMER_KEY = "5b0c7a7e-0f4e-4a40-9c55-8a3f4e1d2c10";
const BILLING_KEY = "bk_plain_secret_0001";
const AUTH_KEY = "auth_plain_secret_0002";

/** 시도·가격·고객·동의가 있는 결제 직전 상태. rows로 표를 통째로 바꾸고 checkout으로 시도 열을 바꾼다 */
function setup(opts: { rows?: Partial<MemoryRows>; toss?: Partial<TossScript>; checkout?: Partial<CheckoutRow> } = {}) {
  const price = priceRow();
  const customer = customerRow({ user_id: USER, toss_customer_key: CUSTOMER_KEY });
  const checkout = checkoutRow({ user_id: USER, price_id: price.id, ...opts.checkout });
  const consent: ConsentRow = { id: randomUUID(), user_id: USER, checkout_id: checkout.id, subscription_id: null, kind: "recurring_payment" };
  const store = createMemoryStore(
    { prices: [price], customers: [customer], checkouts: [checkout], consents: [consent], ...opts.rows },
    { now: () => NOW },
  );
  const deps = makeDeps({ store, toss: createFakeToss(opts.toss) });
  const input = { checkoutId: checkout.id, userId: USER, livemode: false, authKey: AUTH_KEY, customerKey: CUSTOMER_KEY, customerEmail: "user@example.com" };
  return { deps, store, price, customer, checkout, input };
}

/** 결제 요청 인자에 맞춘 DONE 응답 */
const doneFor = (_bk: string, req: { orderId: string; amount: number }) => tossPayment({ orderId: req.orderId, totalAmount: req.amount });

const toss = (over: Partial<TossScript> = {}): Partial<TossScript> => ({ issueBillingKey: [billingAuth()], chargeBillingKey: [doneFor], ...over });

const tossCallCount = (t: ReturnType<typeof createFakeToss>) =>
  t.calls.issueBillingKey.length + t.calls.chargeBillingKey.length + t.calls.getPaymentByOrderId.length + t.calls.cancelPayment.length;

describe("completeCheckout — 첫 정기결제", () => {
  it("1. 정상: 구독·결제·시도·동의·고객 행이 맞고 영수증 메일 1통, 평문 빌링키는 어디에도 없다", async () => {
    const { deps, store, price, checkout, customer, input } = setup({ toss: toss() });

    const out = await completeCheckout(deps, input);

    expect(store.rows.subscriptions).toHaveLength(1);
    const sub = store.rows.subscriptions[0];
    expect(out).toEqual({ kind: "subscribed", subscriptionId: sub.id });
    // 금액 스냅샷·기간(앵커 31일 → 2월 말일)·앵커일
    const start = iso(NOW);
    expect(sub).toMatchObject({
      user_id: USER,
      provider: "toss",
      livemode: false,
      plan_code: "pro",
      status: "active",
      price_id: price.id,
      amount: 1234,
      currency: "KRW",
      interval: "month",
      current_period_start: pgTime(start),
      current_period_end: pgTime(addInterval(start, "month", 31)),
      billing_anchor_day: 31,
      cancel_at_period_end: false,
    });
    // 저장소는 PostgREST 모양(+00:00)으로 돌려준다
    expect(sub.current_period_end).toBe("2026-02-27T16:00:00+00:00");

    // 결제 행
    expect(store.rows.payments).toHaveLength(1);
    const pay = store.rows.payments[0];
    expect(pay).toMatchObject({
      user_id: USER,
      subscription_id: sub.id,
      checkout_id: checkout.id,
      provider: "toss",
      livemode: false,
      kind: "initial",
      attempt: 1,
      status: "paid",
      amount: 1234,
      currency: "KRW",
      period_start: pgTime(start),
      period_end: sub.current_period_end,
      external_payment_id: "pk_0001",
      receipt_url: "https://dashboard.tosspayments.com/receipt/0001",
      card_summary: { issuerCode: "61", number: "1234****", cardType: "신용" },
      refunded_amount: 0,
      approved_at: "2026-01-30T16:00:05+00:00",
      failure_code: null,
    });
    expect(pay.order_id).toMatch(/^pay_[0-9a-f-]{36}$/);

    // 시도 completed + subscription_id, 동의 연결
    expect(store.rows.checkouts[0]).toMatchObject({ status: "completed", subscription_id: sub.id, failure_code: null });
    expect(store.rows.consents[0].subscription_id).toBe(sub.id);

    // 고객 행: v1 암호문(복호화하면 빌링키)·카드 요약
    const cust = store.rows.customers[0];
    expect(cust.id).toBe(customer.id);
    expect(cust.toss_billing_key_enc).toMatch(/^v1:/);
    expect(decryptBillingKey(cust.toss_billing_key_enc!, { userId: USER, livemode: false }, deps.encKey)).toBe(BILLING_KEY);
    expect(cust.toss_card_summary).toEqual({ issuerCode: "61", number: "1234****", cardType: "신용" });
    const everything = JSON.stringify(store.rows);
    expect(everything).not.toContain(BILLING_KEY);
    expect(everything).not.toContain(AUTH_KEY);

    // 토스 호출: 발급 1회, 결제 1회(멱등 키 = 결제 행 id, 금액 = 가격 행)
    expect(deps.toss.calls.issueBillingKey).toEqual([[AUTH_KEY, CUSTOMER_KEY]]);
    expect(deps.toss.calls.chargeBillingKey).toEqual([
      [
        BILLING_KEY,
        { customerKey: CUSTOMER_KEY, amount: price.amount, orderId: pay.order_id, orderName: "A11y Check Pro 월간 구독", customerEmail: "user@example.com" },
        pay.id,
      ],
    ]);
    expect(deps.toss.calls.cancelPayment).toHaveLength(0);

    // 영수증 메일 1통 — 카드는 표시 문자열, 비밀 값 없음
    expect(deps.mailer.sent).toEqual([
      {
        userId: USER,
        kind: "receipt",
        data: {
          planName: "Pro",
          amount: 1234,
          currency: "KRW",
          periodEnd: sub.current_period_end,
          receiptUrl: "https://dashboard.tosspayments.com/receipt/0001",
          card: "신용 1234****",
        },
      },
    ]);
    expect(deps.log).not.toHaveBeenCalled();
  });

  it("2. 같은 시도를 다시 완료(새로고침)하면 토스 호출 없이 같은 구독으로 subscribed", async () => {
    const { deps, store, input } = setup({ toss: toss() });
    const first = await completeCheckout(deps, input);
    const callsBefore = tossCallCount(deps.toss);

    const again = await completeCheckout(deps, input);

    expect(again).toEqual(first);
    expect(tossCallCount(deps.toss)).toBe(callsBefore);
    expect(store.rows.subscriptions).toHaveLength(1);
    expect(store.rows.payments).toHaveLength(1);
    expect(deps.mailer.sent).toHaveLength(1);
  });

  it("3. 이미 진행 중 구독이 있으면 빌링키를 발급하지 않고 hasActive, 기존 암호문은 그대로", async () => {
    const existing = subscriptionRow({ user_id: USER });
    const price = priceRow();
    const customer = customerRow({ user_id: USER, toss_customer_key: CUSTOMER_KEY, toss_billing_key_enc: "v1:aaa:bbb:ccc", toss_card_summary: { issuerCode: "11", number: "9999****", cardType: "체크" } });
    const checkout = checkoutRow({ user_id: USER, price_id: price.id });
    const store = createMemoryStore({ prices: [price], customers: [customer], checkouts: [checkout], subscriptions: [existing] });
    const deps = makeDeps({ store, toss: createFakeToss(toss()) });

    const out = await completeCheckout(deps, { checkoutId: checkout.id, userId: USER, livemode: false, authKey: AUTH_KEY, customerKey: CUSTOMER_KEY, customerEmail: null });

    expect(out).toEqual({ kind: "error", code: "hasActive", priceId: price.id });
    expect(deps.toss.calls.issueBillingKey).toHaveLength(0);
    expect(tossCallCount(deps.toss)).toBe(0);
    expect(store.rows.customers[0]).toEqual(customer);
    expect(store.rows.checkouts[0]).toMatchObject({ status: "failed", failure_code: "hasActive" });
    expect(store.rows.subscriptions.map((s) => [s.id, s.status])).toEqual([[existing.id, "active"]]);
    expect(store.rows.payments).toHaveLength(0);
  });

  it("3'. 미납(past_due) 구독도 진행 중 — hasActive, 빌링키 발급 없음", async () => {
    const pastDue = subscriptionRow({ user_id: USER, status: "past_due", dunning_attempts: 1, grace_until: iso(NOW + 5 * DAY) });
    const { deps, store, price, input } = setup({ toss: toss(), rows: { subscriptions: [pastDue] } });

    expect(await completeCheckout(deps, input)).toEqual({ kind: "error", code: "hasActive", priceId: price.id });
    expect(tossCallCount(deps.toss)).toBe(0);
    expect(store.rows.customers[0].toss_billing_key_enc).toBeNull();
    expect(store.rows.checkouts[0]).toMatchObject({ status: "failed", failure_code: "hasActive" });
  });

  it("4. customerKey가 다르거나 고객 행이 없으면 customerMismatch, 토스 호출 0회", async () => {
    const a = setup({ toss: toss() });
    const out = await completeCheckout(a.deps, { ...a.input, customerKey: "someone-elses-key" });
    expect(out).toEqual({ kind: "error", code: "customerMismatch", priceId: a.price.id });
    expect(tossCallCount(a.deps.toss)).toBe(0);
    expect(a.store.rows.checkouts[0]).toMatchObject({ status: "failed", failure_code: "customerMismatch" });

    const b = setup({ toss: toss(), rows: { customers: [] } });
    expect(await completeCheckout(b.deps, b.input)).toMatchObject({ kind: "error", code: "customerMismatch" });
    expect(tossCallCount(b.deps.toss)).toBe(0);
  });

  it.each([
    ["비활성", { active: false }],
    ["토스가 아닌 결제사", { provider: "manual" as const }],
    ["시도와 다른 모드", { livemode: true }],
  ])("5. 가격이 %s이면 priceInactive, 토스 호출 0회", async (_label, priceOver) => {
    const price = priceRow(priceOver);
    const customer = customerRow({ user_id: USER, toss_customer_key: CUSTOMER_KEY });
    const checkout = checkoutRow({ user_id: USER, price_id: price.id });
    const store = createMemoryStore({ prices: [price], customers: [customer], checkouts: [checkout] });
    const deps = makeDeps({ store, toss: createFakeToss(toss()) });

    const out = await completeCheckout(deps, { checkoutId: checkout.id, userId: USER, livemode: false, authKey: AUTH_KEY, customerKey: CUSTOMER_KEY, customerEmail: null });

    expect(out).toEqual({ kind: "error", code: "priceInactive", priceId: price.id });
    expect(tossCallCount(deps.toss)).toBe(0);
    expect(store.rows.checkouts[0]).toMatchObject({ status: "failed", failure_code: "priceInactive" });
  });

  it("5'. 가격 행이 없어도 priceInactive", async () => {
    const { deps, input } = setup({ toss: toss(), rows: { prices: [] } });
    expect(await completeCheckout(deps, input)).toMatchObject({ kind: "error", code: "priceInactive" });
    expect(tossCallCount(deps.toss)).toBe(0);
  });

  it.each([
    ["INVALID_CARD_EXPIRATION", 400, "cardRejected"],
    ["UNAUTHORIZED_KEY", 401, "failed"],
    ["NETWORK", 0, "failed"],
  ])("6. 빌링키 발급 거절(%s) → %s, 시도 failed, 결제 시도 없음", async (code, status, expected) => {
    const { deps, store, price, input } = setup({ toss: toss({ issueBillingKey: [new TossError(code, "발급 실패", status)] }) });

    const out = await completeCheckout(deps, input);

    expect(out).toEqual({ kind: "error", code: expected, priceId: price.id });
    expect(store.rows.checkouts[0]).toMatchObject({ status: "failed", failure_code: code });
    expect(deps.toss.calls.chargeBillingKey).toHaveLength(0);
    expect(store.rows.payments).toHaveLength(0);
    expect(store.rows.customers[0].toss_billing_key_enc).toBeNull();
    expect(JSON.stringify(deps.log.mock.calls)).not.toContain(AUTH_KEY);
  });

  it("7. 결제 거절(REJECT_CARD_PAYMENT) → failed, 결제 failed·사유, 빌링키 암호문 지움, 구독 없음", async () => {
    const { deps, store, price, input } = setup({
      toss: toss({ chargeBillingKey: [new TossError("REJECT_CARD_PAYMENT", "한도가 초과되었습니다", 400)] }),
    });

    const out = await completeCheckout(deps, input);

    expect(out).toEqual({ kind: "error", code: "failed", priceId: price.id });
    expect(store.rows.payments).toHaveLength(1);
    expect(store.rows.payments[0]).toMatchObject({
      status: "failed",
      failure_code: "REJECT_CARD_PAYMENT",
      failure_message: "한도가 초과되었습니다",
      subscription_id: null,
    });
    expect(store.rows.customers[0]).toMatchObject({ toss_billing_key_enc: null, toss_card_summary: null });
    expect(store.rows.subscriptions).toHaveLength(0);
    expect(store.rows.checkouts[0]).toMatchObject({ status: "failed", failure_code: "REJECT_CARD_PAYMENT" });
    expect(deps.toss.calls.cancelPayment).toHaveLength(0);
    expect(deps.mailer.sent).toHaveLength(0);
  });

  it("7''. 거절된 시도를 다시 열면(새로고침) 새 결제 없이 expired", async () => {
    const { deps, store, price, input } = setup({ toss: toss({ chargeBillingKey: [new TossError("REJECT_CARD_PAYMENT", "한도 초과", 400)] }) });
    expect(await completeCheckout(deps, input)).toMatchObject({ kind: "error", code: "failed" });

    expect(await completeCheckout(deps, input)).toEqual({ kind: "error", code: "expired", priceId: price.id });
    expect(deps.toss.calls.issueBillingKey).toHaveLength(1);
    expect(deps.toss.calls.chargeBillingKey).toHaveLength(1);
    expect(store.rows.payments).toHaveLength(1);
  });

  it("거절 뒤 정리는 이 실행이 쓴 빌링키만 지운다 — 그 사이 다른 시도가 쓴 빌링키는 남긴다", async () => {
    const rivalEnc = "v1:rival-iv:rival-tag:rival-ct";
    const rivalCard = { issuerCode: "11", number: "5555****", cardType: "체크" };
    const late: { store?: ReturnType<typeof createMemoryStore> } = {};
    const ctx = setup({
      toss: toss({
        chargeBillingKey: [
          () => {
            // 결제가 진행되는 사이 같은 사용자의 다른 시도가 새 빌링키를 저장했다
            Object.assign(late.store!.rows.customers[0], { toss_billing_key_enc: rivalEnc, toss_card_summary: rivalCard });
            throw new TossError("REJECT_CARD_PAYMENT", "한도 초과", 400);
          },
        ],
      }),
    });
    late.store = ctx.store;

    expect(await completeCheckout(ctx.deps, ctx.input)).toMatchObject({ kind: "error", code: "failed" });
    expect(ctx.store.rows.customers[0]).toMatchObject({ toss_billing_key_enc: rivalEnc, toss_card_summary: rivalCard });
    expect(ctx.store.rows.payments[0].status).toBe("failed");
    expect(ctx.store.rows.checkouts[0]).toMatchObject({ status: "failed", failure_code: "REJECT_CARD_PAYMENT" });
  });

  it("거절이 확정된 뒤 정리 중 저장소 오류가 나도 시도는 failed로 닫고 빌링키를 거둔다(processing·pending으로 남기지 않음)", async () => {
    const { deps, store, price, input } = setup({ toss: toss({ chargeBillingKey: [new TossError("REJECT_CARD_PAYMENT", "한도 초과", 400)] }) });
    store.updatePayment = async () => {
      throw new Error("billing store updatePayment: connection reset");
    };

    expect(await completeCheckout(deps, input)).toEqual({ kind: "error", code: "failed", priceId: price.id });
    expect(store.rows.checkouts[0]).toMatchObject({ status: "failed", failure_code: "error" });
    expect(store.rows.customers[0]).toMatchObject({ toss_billing_key_enc: null, toss_card_summary: null });
    expect(store.rows.subscriptions).toHaveLength(0);
    expect(deps.log).toHaveBeenCalledTimes(1);
  });

  it("7'. 결제가 카드 문제로 거절(INVALID_STOPPED_CARD)되면 cardRejected", async () => {
    const { deps, store, input } = setup({ toss: toss({ chargeBillingKey: [new TossError("INVALID_STOPPED_CARD", "정지된 카드", 400)] }) });
    expect(await completeCheckout(deps, input)).toMatchObject({ kind: "error", code: "cardRejected" });
    expect(store.rows.payments[0]).toMatchObject({ status: "failed", failure_code: "INVALID_STOPPED_CARD" });
    expect(store.rows.customers[0].toss_billing_key_enc).toBeNull();
  });

  it.each([
    ["NETWORK", 0],
    ["HTTP_502", 502],
    ["FAILED_INTERNAL_SYSTEM_PROCESSING", 500],
    ["HTTP_408", 408],
  ])("8. 결제 결과 불명(%s, %d) → pending, 결제 pending·시도 processing 유지, 구독 없음", async (code, status) => {
    const { deps, store, input } = setup({ toss: toss({ chargeBillingKey: [new TossError(code, "결과 불명", status)] }) });

    const out = await completeCheckout(deps, input);

    expect(out).toEqual({ kind: "pending" });
    expect(store.rows.payments).toHaveLength(1);
    expect(store.rows.payments[0]).toMatchObject({ status: "pending", failure_code: null, external_payment_id: null });
    expect(store.rows.checkouts[0].status).toBe("processing");
    expect(store.rows.subscriptions).toHaveLength(0);
    // 대사가 같은 빌링키로 확정할 수 있게 암호문은 남긴다
    expect(store.rows.customers[0].toss_billing_key_enc).toMatch(/^v1:/);
    expect(deps.mailer.sent).toHaveLength(0);
    expect(JSON.stringify(store.rows)).not.toContain(BILLING_KEY);
  });

  it("8'. 결제 응답이 DONE이 아니면 pending과 같게 남기고, 다시 들어와도 결제하지 않는다", async () => {
    const { deps, store, input } = setup({
      toss: toss({ chargeBillingKey: [(_bk, req) => tossPayment({ orderId: req.orderId, status: "IN_PROGRESS" })] }),
    });

    expect(await completeCheckout(deps, input)).toEqual({ kind: "pending" });
    expect(store.rows.payments[0].status).toBe("pending");
    expect(store.rows.checkouts[0].status).toBe("processing");
    expect(deps.log).toHaveBeenCalledTimes(1);
    expect(String(deps.log.mock.calls[0][0])).toContain("IN_PROGRESS");

    // 뒤로 가기 등으로 콜백을 다시 열면 "만료"가 아니라 확인 중 — 새 결제를 유도하지 않는다
    expect(await completeCheckout(deps, input)).toEqual({ kind: "pending" });
    expect(deps.toss.calls.chargeBillingKey).toHaveLength(1);
  });

  it("9. 결제 성공 뒤 구독 insert가 경합으로 hasActive → 토스 취소 1회(cancel_<결제 id>), 결제 refunded", async () => {
    const rival = subscriptionRow({ user_id: USER });
    // 결제 단계에서 저장소에 접근하려고 — setup이 저장소를 만들기 전에 스크립트를 정해야 한다
    const late: { store?: ReturnType<typeof createMemoryStore> } = {};
    const ctx = setup({
      toss: toss({
        // 결제가 진행되는 사이 다른 시도가 먼저 구독을 만든다
        chargeBillingKey: [
          (bk, req) => {
            late.store!.rows.subscriptions.push(structuredClone(rival));
            return doneFor(bk, req);
          },
        ],
        cancelPayment: [tossPayment({ status: "CANCELED" })],
      }),
    });
    late.store = ctx.store;
    const store = ctx.store;

    const out = await completeCheckout(ctx.deps, ctx.input);

    expect(out).toEqual({ kind: "error", code: "hasActive", priceId: ctx.price.id });
    const pay = store.rows.payments[0];
    expect(ctx.deps.toss.calls.cancelPayment).toEqual([["pk_0001", { cancelReason: "중복 구독 자동 취소" }, `cancel_${pay.id}`]]);
    expect(pay).toMatchObject({ status: "refunded", refunded_amount: 1234, external_payment_id: "pk_0001", subscription_id: null });
    expect(store.rows.subscriptions).toEqual([rival]);
    expect(store.rows.checkouts[0]).toMatchObject({ status: "failed", failure_code: "hasActive" });
    expect(store.rows.consents[0].subscription_id).toBeNull();
    expect(ctx.deps.mailer.sent).toHaveLength(0);
  });

  it("9'. 경합 취소 자체가 실패하면 결제는 paid·CANCEL_FAILED로 남기고(수동 환불), 시도는 hasActive로 끝낸다", async () => {
    const rival = subscriptionRow({ user_id: USER });
    // 결제 단계에서 저장소에 접근하려고 — setup이 저장소를 만들기 전에 스크립트를 정해야 한다
    const late: { store?: ReturnType<typeof createMemoryStore> } = {};
    const ctx = setup({
      toss: toss({
        chargeBillingKey: [
          (bk, req) => {
            late.store!.rows.subscriptions.push(structuredClone(rival));
            return doneFor(bk, req);
          },
        ],
        cancelPayment: [new TossError("NETWORK", "toss request failed (network)", 0)],
      }),
    });
    late.store = ctx.store;
    const store = ctx.store;

    const out = await completeCheckout(ctx.deps, ctx.input);

    expect(out).toEqual({ kind: "error", code: "hasActive", priceId: ctx.price.id });
    expect(ctx.deps.toss.calls.cancelPayment).toHaveLength(1);
    expect(store.rows.payments[0]).toMatchObject({
      status: "paid",
      failure_code: "CANCEL_FAILED",
      refunded_amount: 0,
      external_payment_id: "pk_0001",
      subscription_id: null,
    });
    expect(store.rows.checkouts[0]).toMatchObject({ status: "failed", failure_code: "hasActive" });
    expect(store.rows.subscriptions).toEqual([rival]);
    expect(ctx.deps.log).toHaveBeenCalledTimes(1);
    const logged = String(ctx.deps.log.mock.calls[0][0]);
    expect(logged).toContain(store.rows.payments[0].id);
    expect(logged).not.toContain(BILLING_KEY);
    expect(logged).not.toContain(AUTH_KEY);
  });

  it("10. 만료된 시도는 expired, 시도·토스는 건드리지 않는다", async () => {
    const { deps, store, price, input } = setup({ toss: toss(), checkout: { expires_at: iso(NOW - MIN) } });

    expect(await completeCheckout(deps, input)).toEqual({ kind: "error", code: "expired", priceId: price.id });
    expect(tossCallCount(deps.toss)).toBe(0);
    expect(store.rows.checkouts[0].status).toBe("open");
  });

  it("없는 시도는 notFound, 다른 사용자의 시도도 notFound(존재를 알리지 않음)이고 건드리지 않는다", async () => {
    const { deps, store, input } = setup({ toss: toss() });
    expect(await completeCheckout(deps, { ...input, checkoutId: randomUUID() })).toEqual({ kind: "error", code: "notFound" });
    expect(await completeCheckout(deps, { ...input, userId: OTHER })).toEqual({ kind: "error", code: "notFound" });
    expect(store.rows.checkouts[0].status).toBe("open");
    expect(tossCallCount(deps.toss)).toBe(0);
  });

  it("다른 모드(테스트 시도를 실결제 서버로 등)의 시도는 notFound — 선점·토스 호출 없이", async () => {
    const { deps, store, input } = setup({ toss: toss() });
    expect(await completeCheckout(deps, { ...input, livemode: true })).toEqual({ kind: "error", code: "notFound" });
    expect(store.rows.checkouts[0].status).toBe("open");
    expect(tossCallCount(deps.toss)).toBe(0);
  });

  it("돈이 움직이기 전 저장소 오류는 failed + 기록, 시도는 failed로 닫는다", async () => {
    const { deps, store, input } = setup({ toss: toss() });
    store.getLiveSubscription = async () => {
      throw new Error("billing store getLiveSubscription: connection reset");
    };

    expect(await completeCheckout(deps, input)).toMatchObject({ kind: "error", code: "failed" });
    expect(tossCallCount(deps.toss)).toBe(0);
    expect(store.rows.checkouts[0]).toMatchObject({ status: "failed", failure_code: "error" });
    expect(deps.log).toHaveBeenCalledTimes(1);
  });

  it("결제가 끝난 뒤 저장소 오류는 failed가 아니라 pending — 결제 행은 pending으로 남아 대사가 확정한다", async () => {
    const { deps, store, input } = setup({ toss: toss() });
    store.insertSubscription = async () => {
      throw new Error("billing store insertSubscription: connection reset");
    };

    expect(await completeCheckout(deps, input)).toEqual({ kind: "pending" });
    expect(store.rows.payments[0].status).toBe("pending");
    expect(store.rows.checkouts[0].status).toBe("processing");
    expect(deps.log).toHaveBeenCalledTimes(1);
  });

  it("빌링키 저장 뒤·결제 전 저장소 오류(결제 행 insert 실패)면 이 실행의 빌링키를 거두고 failed로 닫는다", async () => {
    const { deps, store, price, input } = setup({ toss: toss() });
    store.insertPayment = async () => {
      throw new Error("billing store insertPayment: connection reset");
    };

    expect(await completeCheckout(deps, input)).toEqual({ kind: "error", code: "failed", priceId: price.id });
    expect(deps.toss.calls.chargeBillingKey).toHaveLength(0);
    expect(store.rows.customers[0]).toMatchObject({ toss_billing_key_enc: null, toss_card_summary: null });
    expect(store.rows.checkouts[0]).toMatchObject({ status: "failed", failure_code: "error" });
    expect(deps.log).toHaveBeenCalledTimes(1);
  });

  it("결제 행 insert가 duplicate면 결제를 보내지 않고 빌링키를 거둔 뒤 failed(duplicate)", async () => {
    const { deps, store, price, input } = setup({ toss: toss() });
    store.insertPayment = async () => "duplicate";

    expect(await completeCheckout(deps, input)).toEqual({ kind: "error", code: "failed", priceId: price.id });
    expect(deps.toss.calls.chargeBillingKey).toHaveLength(0);
    expect(store.rows.customers[0]).toMatchObject({ toss_billing_key_enc: null, toss_card_summary: null });
    expect(store.rows.checkouts[0]).toMatchObject({ status: "failed", failure_code: "duplicate" });
  });

  it("같은 시도를 동시에 두 번 완료해도 결제 1회·구독 1건", async () => {
    const { deps, store, input } = setup({ toss: toss() });

    const outs = await Promise.all([completeCheckout(deps, input), completeCheckout(deps, input)]);

    expect(deps.toss.calls.issueBillingKey).toHaveLength(1);
    expect(deps.toss.calls.chargeBillingKey).toHaveLength(1);
    expect(store.rows.subscriptions).toHaveLength(1);
    expect(store.rows.payments).toHaveLength(1);
    const sub = store.rows.subscriptions[0];
    // 먼저 선점한 쪽이 구독을 만들고, 다른 쪽은 처리 중으로 안내받는다
    expect(outs).toEqual(expect.arrayContaining([{ kind: "subscribed", subscriptionId: sub.id }, { kind: "pending" }]));
    expect(deps.mailer.sent).toHaveLength(1);
  });
});

const NEW_BILLING_KEY = "bk_plain_secret_new_0003";
const OLD_ENC = "v1:old-iv:old-tag:old-ct";
const OLD_CARD = { issuerCode: "11", number: "9999****", cardType: "체크" };
const NEW_CARD = { issuerCode: "61", number: "4321****", cardType: "신용" };

/** 카드 변경 직전 상태 — 진행 중 구독·그 구독의 카드(암호문)·카드 변경 시도 */
function setupCardChange(opts: { sub?: Partial<SubscriptionRow>; toss?: Partial<TossScript>; checkout?: Partial<CheckoutRow> } = {}) {
  const price = priceRow();
  const sub = subscriptionRow({ user_id: USER, price_id: price.id, ...opts.sub });
  const customer = customerRow({ user_id: USER, toss_customer_key: CUSTOMER_KEY, toss_billing_key_enc: OLD_ENC, toss_card_summary: OLD_CARD });
  const checkout = checkoutRow({ user_id: USER, price_id: price.id, purpose: "card_change", subscription_id: sub.id, ...opts.checkout });
  const store = createMemoryStore({ prices: [price], customers: [customer], checkouts: [checkout], subscriptions: [sub] }, { now: () => NOW });
  const deps = makeDeps({ store, toss: createFakeToss(opts.toss) });
  const input = { checkoutId: checkout.id, userId: USER, livemode: false, authKey: AUTH_KEY, customerKey: CUSTOMER_KEY, customerEmail: "user@example.com" };
  return { deps, store, price, sub, customer, checkout, input };
}

const newCard = () => billingAuth({ billingKey: NEW_BILLING_KEY, card: NEW_CARD });

describe("completeCheckout — 카드 변경", () => {
  it("진행 중(active) 구독: 새 빌링키로 바꾸고 결제는 하지 않는다 — cardChanged·retry none, 시도 completed", async () => {
    const { deps, store, sub, input } = setupCardChange({ toss: { issueBillingKey: [newCard()] } });
    const before = structuredClone(store.rows.subscriptions[0]);

    const out = await completeCheckout(deps, input);

    expect(out).toEqual({ kind: "cardChanged", subscriptionId: sub.id, retry: "none" });
    expect(deps.toss.calls.issueBillingKey).toEqual([[AUTH_KEY, CUSTOMER_KEY]]);
    expect(deps.toss.calls.chargeBillingKey).toHaveLength(0);
    const cust = store.rows.customers[0];
    expect(cust.toss_billing_key_enc).toMatch(/^v1:/);
    expect(cust.toss_billing_key_enc).not.toBe(OLD_ENC);
    expect(decryptBillingKey(cust.toss_billing_key_enc!, { userId: USER, livemode: false }, deps.encKey)).toBe(NEW_BILLING_KEY);
    expect(cust.toss_card_summary).toEqual(NEW_CARD);
    expect(store.rows.checkouts[0]).toMatchObject({ status: "completed", subscription_id: sub.id, failure_code: null });
    // 구독·결제는 그대로, 메일 없음, 비밀 값 없음
    expect(store.rows.subscriptions[0]).toEqual(before);
    expect(store.rows.payments).toHaveLength(0);
    expect(deps.mailer.sent).toHaveLength(0);
    expect(JSON.stringify(store.rows)).not.toContain(NEW_BILLING_KEY);
    expect(deps.log).not.toHaveBeenCalled();
  });

  it("미납(past_due) 구독: 새 카드로 바로 재결제 — paid면 active로 돌아오고 한 주기 전진, 영수증 1통", async () => {
    const due = iso(NOW - 2 * DAY);
    const { deps, store, sub, input } = setupCardChange({
      sub: {
        status: "past_due",
        current_period_start: iso(NOW - 30 * DAY),
        current_period_end: due,
        billing_anchor_day: 29,
        dunning_attempts: 1,
        next_retry_at: iso(NOW + DAY),
        grace_until: iso(NOW + 5 * DAY),
      },
      toss: { issueBillingKey: [newCard()], chargeBillingKey: [doneFor] },
    });

    const out = await completeCheckout(deps, input);

    expect(out).toEqual({ kind: "cardChanged", subscriptionId: sub.id, retry: "paid" });
    // 재결제는 새 빌링키로, 금액은 구독 스냅샷, 시도 번호는 실패 횟수 + 1
    expect(deps.toss.calls.chargeBillingKey).toHaveLength(1);
    expect(deps.toss.calls.chargeBillingKey[0][0]).toBe(NEW_BILLING_KEY);
    expect(deps.toss.calls.chargeBillingKey[0][1]).toMatchObject({ customerKey: CUSTOMER_KEY, amount: sub.amount });
    expect(store.rows.payments).toHaveLength(1);
    expect(store.rows.payments[0]).toMatchObject({ kind: "retry", attempt: 2, status: "paid", subscription_id: sub.id, period_start: pgTime(due) });
    expect(store.rows.subscriptions[0]).toMatchObject({
      status: "active",
      current_period_start: pgTime(due),
      current_period_end: pgTime(addInterval(due, "month", 29)),
      dunning_attempts: 0,
      next_retry_at: null,
      grace_until: null,
    });
    expect(store.rows.checkouts[0]).toMatchObject({ status: "completed", subscription_id: sub.id });
    expect(deps.mailer.sent.map((m) => m.kind)).toEqual(["receipt"]);
  });

  it("미납 구독 재결제가 거절되면 카드는 바뀐 채 retry failed — 미납 그대로(시도 번호만 오름)", async () => {
    const due = iso(NOW - 2 * DAY);
    const { deps, store, sub, input } = setupCardChange({
      sub: { status: "past_due", current_period_start: iso(NOW - 30 * DAY), current_period_end: due, dunning_attempts: 1, grace_until: iso(NOW + 5 * DAY) },
      toss: { issueBillingKey: [newCard()], chargeBillingKey: [new TossError("REJECT_CARD_PAYMENT", "한도 초과", 400)] },
    });

    expect(await completeCheckout(deps, input)).toEqual({ kind: "cardChanged", subscriptionId: sub.id, retry: "failed" });
    expect(store.rows.customers[0].toss_card_summary).toEqual(NEW_CARD);
    expect(store.rows.subscriptions[0]).toMatchObject({ status: "past_due", dunning_attempts: 2 });
    expect(store.rows.checkouts[0]).toMatchObject({ status: "completed" });
  });

  it("미납 구독 재결제 결과를 모르면 retry pending — 결제 행은 pending으로 남아 대사가 확정한다", async () => {
    const due = iso(NOW - 2 * DAY);
    const { deps, store, sub, input } = setupCardChange({
      sub: { status: "past_due", current_period_start: iso(NOW - 30 * DAY), current_period_end: due, dunning_attempts: 1, grace_until: iso(NOW + 5 * DAY) },
      toss: { issueBillingKey: [newCard()], chargeBillingKey: [new TossError("NETWORK", "결과 불명", 0)] },
    });

    expect(await completeCheckout(deps, input)).toEqual({ kind: "cardChanged", subscriptionId: sub.id, retry: "pending" });
    expect(store.rows.payments[0]).toMatchObject({ kind: "retry", status: "pending" });
    expect(store.rows.checkouts[0]).toMatchObject({ status: "completed" });
  });

  it("해지를 예약한 미납 구독은 카드만 바꾸고 재결제하지 않는다(retry none)", async () => {
    const { deps, store, sub, input } = setupCardChange({
      sub: { status: "past_due", current_period_end: iso(NOW - 2 * DAY), current_period_start: iso(NOW - 30 * DAY), dunning_attempts: 1, cancel_at_period_end: true },
      toss: { issueBillingKey: [newCard()], chargeBillingKey: [doneFor] },
    });
    expect(await completeCheckout(deps, input)).toEqual({ kind: "cardChanged", subscriptionId: sub.id, retry: "none" });
    expect(deps.toss.calls.chargeBillingKey).toHaveLength(0);
    expect(store.rows.customers[0].toss_card_summary).toEqual(NEW_CARD);
  });

  it.each<[string, Partial<SubscriptionRow>]>([
    ["다른 사용자의 구독", { user_id: OTHER }],
    ["다른 모드의 구독", { livemode: true }],
    ["토스가 아닌 구독(기관 계약)", { provider: "manual", interval: "contract" }],
    ["이미 끝난 구독", { status: "ended", ended_reason: "user_canceled", ended_at: iso(NOW - DAY) }],
  ])("%s이면 failed — 빌링키를 발급하지 않고 기존 카드는 그대로", async (_label, subOver) => {
    const { deps, store, customer, input } = setupCardChange({ sub: subOver, toss: { issueBillingKey: [newCard()] } });

    const out = await completeCheckout(deps, input);

    expect(out).toEqual({ kind: "error", code: "failed" });
    expect(tossCallCount(deps.toss)).toBe(0);
    expect(store.rows.customers[0]).toEqual(customer);
    expect(store.rows.checkouts[0]).toMatchObject({ status: "failed", failure_code: "subscriptionMismatch" });
  });

  it("시도에 구독이 없거나 구독 행이 사라졌으면 failed", async () => {
    const a = setupCardChange({ checkout: { subscription_id: null }, toss: { issueBillingKey: [newCard()] } });
    expect(await completeCheckout(a.deps, a.input)).toEqual({ kind: "error", code: "failed" });
    expect(tossCallCount(a.deps.toss)).toBe(0);

    const b = setupCardChange({ toss: { issueBillingKey: [newCard()] } });
    b.store.rows.subscriptions.length = 0;
    expect(await completeCheckout(b.deps, b.input)).toEqual({ kind: "error", code: "failed" });
    expect(tossCallCount(b.deps.toss)).toBe(0);
  });

  it("시작과 콜백 사이에 구독이 끝났으면(발급 중 종료) 결제하지 않고 failed — 이 실행이 쓴 빌링키를 거둔다", async () => {
    const late: { store?: ReturnType<typeof createMemoryStore> } = {};
    const ctx = setupCardChange({
      toss: {
        issueBillingKey: [
          () => {
            // 발급이 진행되는 사이 크론이 구독을 끝내고(유예 만료) 읽은 빌링키를 지웠다
            Object.assign(late.store!.rows.subscriptions[0], { status: "ended", ended_reason: "payment_failed", ended_at: iso(NOW) });
            Object.assign(late.store!.rows.customers[0], { toss_billing_key_enc: null, toss_card_summary: null });
            return newCard();
          },
        ],
        chargeBillingKey: [doneFor],
      },
      sub: { status: "past_due", current_period_end: iso(NOW - 2 * DAY), current_period_start: iso(NOW - 30 * DAY), dunning_attempts: 3, grace_until: iso(NOW + DAY) },
    });
    late.store = ctx.store;

    const out = await completeCheckout(ctx.deps, ctx.input);

    expect(out).toEqual({ kind: "error", code: "failed" });
    expect(ctx.deps.toss.calls.chargeBillingKey).toHaveLength(0);
    expect(ctx.store.rows.payments).toHaveLength(0);
    expect(ctx.store.rows.customers[0]).toMatchObject({ toss_billing_key_enc: null, toss_card_summary: null });
    expect(ctx.store.rows.subscriptions[0].status).toBe("ended");
    expect(ctx.store.rows.checkouts[0]).toMatchObject({ status: "failed", failure_code: "subscriptionEnded" });
  });

  it("customerKey가 다르면 customerMismatch — 토스 호출 없음, 결제 관리로 보내게 가격 id를 싣지 않는다", async () => {
    const { deps, store, input } = setupCardChange({ toss: { issueBillingKey: [newCard()] } });
    expect(await completeCheckout(deps, { ...input, customerKey: "someone-elses-key" })).toEqual({ kind: "error", code: "customerMismatch" });
    expect(tossCallCount(deps.toss)).toBe(0);
    expect(store.rows.customers[0].toss_billing_key_enc).toBe(OLD_ENC);
  });

  it.each([
    ["INVALID_CARD_EXPIRATION", 400, "cardRejected"],
    ["NETWORK", 0, "failed"],
  ])("빌링키 발급 거절(%s) → %s, 기존 카드는 그대로", async (code, status, expected) => {
    const { deps, store, input } = setupCardChange({ toss: { issueBillingKey: [new TossError(code, "발급 실패", status)] } });
    expect(await completeCheckout(deps, input)).toEqual({ kind: "error", code: expected });
    expect(store.rows.customers[0]).toMatchObject({ toss_billing_key_enc: OLD_ENC, toss_card_summary: OLD_CARD });
    expect(store.rows.checkouts[0]).toMatchObject({ status: "failed", failure_code: code });
    expect(deps.toss.calls.chargeBillingKey).toHaveLength(0);
  });

  it("끝난 카드 변경을 다시 열면(새로고침) 토스 호출 없이 cardChanged·retry none, 만료된 시도는 가격 없이 expired", async () => {
    const { deps, sub, input } = setupCardChange({ toss: { issueBillingKey: [newCard()] } });
    await completeCheckout(deps, input);
    const calls = tossCallCount(deps.toss);

    expect(await completeCheckout(deps, input)).toEqual({ kind: "cardChanged", subscriptionId: sub.id, retry: "none" });
    expect(tossCallCount(deps.toss)).toBe(calls);

    const stale = setupCardChange({ checkout: { expires_at: iso(NOW - MIN) } });
    expect(await completeCheckout(stale.deps, stale.input)).toEqual({ kind: "error", code: "expired" });
  });

  it("빌링키 저장 뒤 저장소 오류가 나도 새 카드를 지우지 않는다(지우면 구독이 갱신할 카드를 잃는다)", async () => {
    const { deps, store, input } = setupCardChange({ toss: { issueBillingKey: [newCard()] } });
    const realGet = store.getSubscription.bind(store);
    let reads = 0;
    store.getSubscription = async (id) => {
      reads++;
      if (reads === 2) throw new Error("billing store getSubscription: connection reset");
      return realGet(id);
    };

    expect(await completeCheckout(deps, input)).toEqual({ kind: "error", code: "failed" });
    expect(store.rows.customers[0].toss_card_summary).toEqual(NEW_CARD);
    expect(store.rows.checkouts[0]).toMatchObject({ status: "failed", failure_code: "error" });
    expect(deps.log).toHaveBeenCalledTimes(1);
  });
});

describe("activateInitialPayment — 대사도 쓰는 구독 생성", () => {
  it("앞선 실행이 구독까지 만들고 멈췄다면 다시 불러도 취소·중복 생성 없이 그 구독으로 마무리한다", async () => {
    const { deps, store, input } = setup({ toss: toss() });
    // 첫 실행: 구독 insert 직후 결제 갱신이 실패한 상황
    const realUpdate = store.updatePayment.bind(store);
    store.updatePayment = async () => {
      throw new Error("billing store updatePayment: connection reset");
    };
    expect(await completeCheckout(deps, input)).toEqual({ kind: "pending" });
    expect(store.rows.subscriptions).toHaveLength(1);
    expect(store.rows.payments[0].status).toBe("pending");
    store.updatePayment = realUpdate;

    // 대사: 같은 결제를 DONE으로 확인하고 다시 활성화
    const pending = structuredClone(store.rows.payments[0]);
    const result = await activateInitialPayment(deps, pending, tossPayment({ orderId: pending.order_id }));

    const sub = store.rows.subscriptions[0];
    expect(result).toBe(sub.id);
    expect(store.rows.subscriptions).toHaveLength(1);
    expect(deps.toss.calls.cancelPayment).toHaveLength(0);
    expect(store.rows.payments[0]).toMatchObject({ status: "paid", subscription_id: sub.id });
    expect(store.rows.checkouts[0]).toMatchObject({ status: "completed", subscription_id: sub.id });
    expect(deps.mailer.sent).toHaveLength(1);
  });

  it("구독 금액·영수증은 실제로 청구한 결제 행 값을 쓰고, 응답 금액·주문번호가 다르면 기록한다", async () => {
    const { deps, store, checkout } = setup();
    const payment = await store.insertPayment({
      user_id: USER,
      subscription_id: null,
      checkout_id: checkout.id,
      provider: "toss",
      livemode: false,
      kind: "initial",
      order_id: newOrderId(),
      amount: 1000,
      currency: "KRW",
      period_start: iso(NOW),
      period_end: iso(NOW + 28 * DAY),
      attempt: 1,
      status: "pending",
    });
    if (payment === "duplicate") throw new Error("unexpected");

    const subId = await activateInitialPayment(deps, payment, tossPayment({ orderId: "pay_someone_else", totalAmount: 9999 }));

    expect(store.rows.subscriptions[0]).toMatchObject({ id: subId, amount: 1000, currency: "KRW" });
    expect(deps.mailer.sent[0].data).toMatchObject({ amount: 1000, currency: "KRW" });
    expect(store.rows.payments[0]).toMatchObject({ status: "paid", amount: 1000, subscription_id: subId });
    expect(deps.log).toHaveBeenCalledTimes(1);
    const logged = String(deps.log.mock.calls[0][0]);
    expect(logged).toContain(payment.id);
    expect(logged).toContain("9999");
    expect(logged).not.toContain(BILLING_KEY);
  });

  it("시도를 찾지 못하면 null", async () => {
    const { deps, store } = setup();
    const payment = await store.insertPayment({
      user_id: USER,
      subscription_id: null,
      checkout_id: randomUUID(),
      provider: "toss",
      livemode: false,
      kind: "initial",
      order_id: newOrderId(),
      amount: 1234,
      currency: "KRW",
      period_start: iso(NOW),
      period_end: iso(NOW + 28 * DAY),
      attempt: 1,
      status: "pending",
    });
    if (payment === "duplicate") throw new Error("unexpected");
    expect(await activateInitialPayment(deps, payment, tossPayment())).toBeNull();
    expect(store.rows.subscriptions).toHaveLength(0);
  });
});

describe("failCheckout — 결제창 실패·취소", () => {
  it("11. 사용자 취소 코드면 reason canceled·시도 failed, 다른 사용자의 시도는 건드리지 않는다", async () => {
    const { deps, store, price, checkout } = setup();

    expect(await failCheckout(deps, { checkoutId: checkout.id, userId: OTHER, livemode: false, code: "PAY_PROCESS_CANCELED" })).toEqual({
      priceId: null,
      reason: "canceled",
      purpose: null,
    });
    expect(store.rows.checkouts[0]).toMatchObject({ status: "open", failure_code: null });

    expect(await failCheckout(deps, { checkoutId: checkout.id, userId: USER, livemode: false, code: "PAY_PROCESS_CANCELED" })).toEqual({
      priceId: price.id,
      reason: "canceled",
      purpose: "subscribe",
    });
    expect(store.rows.checkouts[0]).toMatchObject({ status: "failed", failure_code: "PAY_PROCESS_CANCELED" });
  });

  it.each([
    ["PAY_PROCESS_ABORTED", "canceled"],
    ["REJECT_CARD_COMPANY", "failed"],
  ])("%s → reason %s", async (code, reason) => {
    const { deps, store, price, checkout } = setup();
    expect(await failCheckout(deps, { checkoutId: checkout.id, userId: USER, livemode: false, code })).toEqual({ priceId: price.id, reason, purpose: "subscribe" });
    expect(store.rows.checkouts[0]).toMatchObject({ status: "failed", failure_code: code });
  });

  it("카드 변경 시도는 purpose card_change로 돌려준다(결제 관리로 돌아가게), 다른 모드의 시도는 건드리지 않는다", async () => {
    const { deps, store, price, checkout } = setup({ checkout: { purpose: "card_change", subscription_id: randomUUID() } });
    expect(await failCheckout(deps, { checkoutId: checkout.id, userId: USER, livemode: true, code: "PAY_PROCESS_CANCELED" })).toEqual({
      priceId: null,
      reason: "canceled",
      purpose: null,
    });
    expect(store.rows.checkouts[0].status).toBe("open");
    expect(await failCheckout(deps, { checkoutId: checkout.id, userId: USER, livemode: false, code: "PAY_PROCESS_CANCELED" })).toEqual({
      priceId: price.id,
      reason: "canceled",
      purpose: "card_change",
    });
    expect(store.rows.checkouts[0]).toMatchObject({ status: "failed", failure_code: "PAY_PROCESS_CANCELED" });
  });

  it("이미 끝난 시도(completed)는 덮지 않고, 이상한 코드 문자열은 저장하지 않는다", async () => {
    const { deps, store, price, checkout } = setup({ checkout: { status: "completed", subscription_id: randomUUID() } });
    expect(await failCheckout(deps, { checkoutId: checkout.id, userId: USER, livemode: false, code: "PAY_PROCESS_CANCELED" })).toEqual({
      priceId: price.id,
      reason: "canceled",
      purpose: "subscribe",
    });
    expect(store.rows.checkouts[0].status).toBe("completed");

    const open = setup();
    await failCheckout(open.deps, { checkoutId: open.checkout.id, userId: USER, livemode: false, code: "<script>alert(1)</script>" });
    expect(open.store.rows.checkouts[0]).toMatchObject({ status: "failed", failure_code: "UNKNOWN" });
  });
});

describe("이름·주문번호", () => {
  it("주문명은 플랜과 주기로", () => {
    expect(orderNameFor("pro", "month")).toBe("A11y Check Pro 월간 구독");
    expect(orderNameFor("pro", "year")).toBe("A11y Check Pro 연간 구독");
  });

  it("주문번호는 pay_ + UUID(토스 규칙 6~64자, 영문·숫자·-_)이고 매번 다르다", () => {
    const a = newOrderId();
    expect(a).toMatch(/^pay_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(a).not.toBe(newOrderId());
  });
});

// ── 실제 구현의 얇은 부분: PostgREST 오류 변환·메일러 ──

type PgResult = { data: unknown; error: { code?: string; message: string } | null };

/** 체인 호출을 기록하고 await하면 정해 둔 결과를 주는 PostgREST 흉내 */
function fakeAdmin(result: PgResult) {
  const calls: Array<[string, unknown[]]> = [];
  const builder: object = new Proxy(
    {},
    {
      get(_t, prop) {
        if (prop === "then") return (ok: (v: PgResult) => unknown, bad: (e: unknown) => unknown) => Promise.resolve(result).then(ok, bad);
        return (...args: unknown[]) => {
          calls.push([String(prop), args]);
          return builder;
        };
      },
    },
  );
  const admin = {
    from(table: string) {
      calls.push(["from", [table]]);
      return builder;
    },
  } as unknown as SupabaseClient;
  return { admin, calls };
}

describe("Supabase 저장소 — 유니크 위반은 표지값, 그 밖의 오류는 행 없는 메시지로", () => {
  const newPayment = {
    user_id: USER,
    subscription_id: null,
    checkout_id: null,
    provider: "toss" as const,
    livemode: false,
    kind: "initial" as const,
    order_id: "pay_x",
    amount: 1234,
    currency: "KRW" as const,
    period_start: null,
    period_end: null,
    attempt: 1,
    status: "pending" as const,
  };
  const newSub = {
    user_id: USER,
    provider: "toss" as const,
    livemode: false,
    plan_code: "pro",
    price_id: null,
    amount: 1234,
    currency: "KRW" as const,
    interval: "month" as const,
    current_period_start: iso(NOW),
    current_period_end: iso(NOW + 28 * DAY),
    billing_anchor_day: 31,
  };

  it("23505: 결제 → duplicate, 구독 → hasActive", async () => {
    const dup = { data: null, error: { code: "23505", message: "duplicate key value violates unique constraint" } };
    expect(await createSupabaseBillingStore(fakeAdmin(dup).admin).insertPayment(newPayment)).toBe("duplicate");
    const sub = fakeAdmin(dup);
    expect(await createSupabaseBillingStore(sub.admin).insertSubscription(newSub)).toBe("hasActive");
    // 새 구독은 active로 넣는다(DB 기본값이 없다)
    const insert = sub.calls.find(([m]) => m === "insert");
    expect(insert?.[1][0]).toMatchObject({ status: "active", plan_code: "pro" });
  });

  it("다른 오류는 billing store <메서드>: <메시지>로 던지고 행 내용은 넣지 않는다", async () => {
    const boom = fakeAdmin({ data: null, error: { code: "23514", message: "new row violates check constraint" } });
    const err = await createSupabaseBillingStore(boom.admin)
      .updateCustomer("c1", { toss_billing_key_enc: "v1:secret-cipher", toss_card_summary: null })
      .catch((e: Error) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toBe("billing store updateCustomer: new row violates check constraint");
    expect((err as Error).message).not.toContain("secret-cipher");
  });

  it("빌링키 조건부 삭제는 암호문이 같을 때만 — 바뀐 행이 있으면 true", async () => {
    const hit = fakeAdmin({ data: [{ id: "c1" }], error: null });
    expect(await createSupabaseBillingStore(hit.admin).clearCustomerKeyIf("c1", "v1:mine")).toBe(true);
    expect(hit.calls).toEqual(
      expect.arrayContaining([
        ["from", ["billing_customers"]],
        ["eq", ["id", "c1"]],
        ["eq", ["toss_billing_key_enc", "v1:mine"]],
      ]),
    );
    const update = hit.calls.find(([m]) => m === "update");
    expect(update?.[1][0]).toMatchObject({ toss_billing_key_enc: null, toss_card_summary: null });

    const miss = fakeAdmin({ data: [], error: null });
    expect(await createSupabaseBillingStore(miss.admin).clearCustomerKeyIf("c1", "v1:mine")).toBe(false);
  });

  it("구독 조건부 갱신은 상태·기간 끝·안내 기록 조건을 한 번의 update로 건다 — 바뀐 행이 있으면 true", async () => {
    const end = "2026-02-27T16:00:00+00:00";
    const hit = fakeAdmin({ data: [{ id: "s1" }], error: null });
    expect(
      await createSupabaseBillingStore(hit.admin).updateSubscriptionIf(
        "s1",
        { statuses: ["active"], currentPeriodEnd: end, reminderNotSentFor: end },
        { reminder_sent_for: end },
      ),
    ).toBe(true);
    expect(hit.calls).toEqual(
      expect.arrayContaining([
        ["from", ["subscriptions"]],
        ["eq", ["id", "s1"]],
        ["in", ["status", ["active"]]],
        ["eq", ["current_period_end", end]],
        // 시각에는 PostgREST 예약 문자(:, .)가 있어 큰따옴표로 감싼다. NULL은 neq로 걸리지 않아 따로 둔다
        ["or", [`reminder_sent_for.is.null,reminder_sent_for.neq."${end}"`]],
        ["select", ["id"]],
      ]),
    );
    const update = hit.calls.find(([m]) => m === "update");
    expect(update?.[1][0]).toMatchObject({ reminder_sent_for: end });

    const canceled = fakeAdmin({ data: [{ id: "s1" }], error: null });
    await createSupabaseBillingStore(canceled.admin).updateSubscriptionIf("s1", { statuses: ["active"], cancelAtPeriodEnd: true }, { status: "ended" });
    expect(canceled.calls).toEqual(expect.arrayContaining([["eq", ["cancel_at_period_end", true]]]));

    const plain = fakeAdmin({ data: [], error: null });
    expect(await createSupabaseBillingStore(plain.admin).updateSubscriptionIf("s1", { statuses: ["active", "past_due"] }, { status: "ended" })).toBe(false);
    expect(plain.calls.some(([m, a]) => m === "eq" && a[0] === "current_period_end")).toBe(false);
    expect(plain.calls.some(([m]) => m === "or")).toBe(false);
    expect(plain.calls.some(([m, a]) => m === "eq" && a[0] === "cancel_at_period_end")).toBe(false);

    const boom = fakeAdmin({ data: null, error: { message: "permission denied" } });
    await expect(createSupabaseBillingStore(boom.admin).updateSubscriptionIf("s1", { statuses: ["active"] }, {})).rejects.toThrow(
      "billing store updateSubscriptionIf: permission denied",
    );
  });

  it("구독의 pending 결제 확인은 나이·개수 제한 없이 한 건만 본다", async () => {
    const yes = fakeAdmin({ data: [{ id: "p1" }], error: null });
    expect(await createSupabaseBillingStore(yes.admin).hasPendingPayment("s1")).toBe(true);
    expect(yes.calls).toEqual(
      expect.arrayContaining([
        ["from", ["billing_payments"]],
        ["eq", ["subscription_id", "s1"]],
        ["eq", ["status", "pending"]],
        ["limit", [1]],
      ]),
    );
    expect(await createSupabaseBillingStore(fakeAdmin({ data: [], error: null }).admin).hasPendingPayment("s1")).toBe(false);
  });

  it("사용자에게 알린 실패가 있는지 — 같은 구독·같은 기간 시작의 failed 중 제외 코드·접두가 아닌 것", async () => {
    const start = "2026-02-27T16:00:00+00:00";
    const yes = fakeAdmin({ data: [{ id: "p1" }], error: null });
    expect(await createSupabaseBillingStore(yes.admin).hasUserFacingFailure("s1", start, { codes: ["DECRYPT_FAILED", "UNAUTHORIZED_KEY"], prefixes: ["RECONCILED_"] })).toBe(true);
    expect(yes.calls).toEqual(
      expect.arrayContaining([
        ["from", ["billing_payments"]],
        ["eq", ["subscription_id", "s1"]],
        ["eq", ["period_start", start]],
        ["eq", ["status", "failed"]],
        // 갱신·재시도 결제만 — 같은 기간 시작의 첫 결제 실패는 미납 안내와 무관하다
        ["in", ["kind", ["renewal", "retry"]]],
        ["filter", ["failure_code", "not.is", null]],
        ["filter", ["failure_code", "not.in", "(DECRYPT_FAILED,UNAUTHORIZED_KEY)"]],
        // LIKE의 _는 한 글자 와일드카드라 이스케이프한다(가짜의 startsWith와 같은 뜻)
        ["filter", ["failure_code", "not.like", "RECONCILED\\_%"]],
        ["limit", [1]],
      ]),
    );
    expect(await createSupabaseBillingStore(fakeAdmin({ data: [], error: null }).admin).hasUserFacingFailure("s1", start, { codes: [], prefixes: [] })).toBe(false);

    // 메모리 가짜도 같은 규칙
    const sub = subscriptionRow({ user_id: USER });
    const base = { user_id: USER, subscription_id: sub.id, kind: "retry" as const, status: "failed" as const, period_start: iso(NOW) };
    const store = createMemoryStore({
      subscriptions: [sub],
      payments: [
        paymentRow({ ...base, attempt: 1, failure_code: "DECRYPT_FAILED" }),
        paymentRow({ ...base, attempt: 2, failure_code: "RECONCILED_NOT_FOUND" }),
        paymentRow({ ...base, attempt: 3, period_start: iso(NOW - 28 * DAY), failure_code: "REJECT_CARD_PAYMENT" }),
        paymentRow({ ...base, attempt: 4, status: "pending", failure_code: null }),
      ],
    });
    const exclude = { codes: ["DECRYPT_FAILED"], prefixes: ["RECONCILED_"] };
    expect(await store.hasUserFacingFailure(sub.id, pgTime(NOW), exclude)).toBe(false);
    // 첫 결제(initial)의 실패는 세지 않는다 — 갱신·재시도 결제만 본다
    store.rows.payments.push({ ...paymentRow({ ...base, kind: "initial", attempt: 9, failure_code: "REJECT_CARD_PAYMENT" }), period_start: pgTime(NOW) });
    expect(await store.hasUserFacingFailure(sub.id, pgTime(NOW), exclude)).toBe(false);
    store.rows.payments.push({ ...paymentRow({ ...base, attempt: 5, failure_code: "REJECT_CARD_PAYMENT" }), period_start: pgTime(NOW) });
    // 표기가 달라도(Z) 같은 기간 시작
    expect(await store.hasUserFacingFailure(sub.id, iso(NOW), exclude)).toBe(true);
    expect(await store.hasUserFacingFailure("other-sub", iso(NOW), exclude)).toBe(false);
  });

  it("메모리 저장소의 조건부 갱신도 같은 시각이면 표기(+00:00·Z)가 달라도 같다고 본다", async () => {
    const sub = subscriptionRow({ user_id: USER, current_period_end: iso(NOW + 28 * DAY), reminder_sent_for: null });
    const store = createMemoryStore({ subscriptions: [sub] });
    const end = iso(NOW + 28 * DAY);
    // 상태가 다르면 바꾸지 않는다
    expect(await store.updateSubscriptionIf(sub.id, { statuses: ["past_due"] }, { reminder_sent_for: end })).toBe(false);
    // 기간 끝이 다르면 바꾸지 않는다
    expect(await store.updateSubscriptionIf(sub.id, { statuses: ["active"], currentPeriodEnd: iso(NOW) }, { reminder_sent_for: end })).toBe(false);
    expect(store.rows.subscriptions[0].reminder_sent_for).toBeNull();
    // 같은 시각(표기만 다름)이면 바꾼다 — 안내 선점은 한 번만
    const claim = { statuses: ["active" as const], currentPeriodEnd: pgTime(end), reminderNotSentFor: pgTime(end) };
    expect(await store.updateSubscriptionIf(sub.id, claim, { reminder_sent_for: end })).toBe(true);
    expect(await store.updateSubscriptionIf(sub.id, { ...claim, reminderNotSentFor: end }, { reminder_sent_for: end })).toBe(false);
    expect(store.rows.subscriptions[0].reminder_sent_for).toBe(pgTime(end));
    expect(await store.hasPendingPayment(sub.id)).toBe(false);
    // 해지 예약 조건 — 예약이 없으면 끝내지 않는다
    expect(await store.updateSubscriptionIf(sub.id, { statuses: ["active"], cancelAtPeriodEnd: true }, { status: "ended", ended_reason: "user_canceled" })).toBe(false);
    expect(store.rows.subscriptions[0].status).toBe("active");
  });

  it("선점은 open·만료 전·본인·같은 모드 조건을 한 번의 update로 건다", async () => {
    const { admin, calls } = fakeAdmin({ data: null, error: null });
    expect(await createSupabaseBillingStore(admin).claimCheckout("ck1", USER, false, iso(NOW))).toBeNull();
    expect(calls).toEqual(
      expect.arrayContaining([
        ["from", ["billing_checkouts"]],
        ["update", [{ status: "processing" }]],
        ["eq", ["id", "ck1"]],
        ["eq", ["user_id", USER]],
        ["eq", ["livemode", false]],
        ["eq", ["status", "open"]],
        ["gt", ["expires_at", iso(NOW)]],
        ["maybeSingle", []],
      ]),
    );
  });
});

describe("메일러 — 수신자 조회·주소 조립·실패 삼킴", () => {
  function mailerAdmin(opts: { email: string | null; locale: string | null; authError?: boolean; profileError?: boolean }) {
    const profileQuery = fakeAdmin(
      opts.profileError
        ? { data: null, error: { code: "57014", message: "canceling statement due to statement timeout" } }
        : { data: opts.locale === null ? null : { locale: opts.locale }, error: null },
    );
    const admin = {
      auth: {
        admin: {
          // supabase-js는 던지지 않고 error 객체를 돌려준다
          getUserById: async () =>
            opts.authError
              ? { data: { user: null }, error: { name: "AuthApiError", message: "Database error loading user", status: 500, code: "unexpected_failure" } }
              : { data: { user: opts.email ? { email: opts.email } : null }, error: null },
        },
      },
      from: (t: string) => (profileQuery.admin as unknown as { from: (t: string) => unknown }).from(t),
    } as unknown as SupabaseClient;
    return admin;
  }

  it("수신자 locale로 절대 주소를 붙여 보낸다", async () => {
    const sent: unknown[][] = [];
    const log = async () => undefined;
    const mailer = createBillingMailer(mailerAdmin({ email: "user@example.com", locale: "en" }), log, async (...args) => {
      sent.push(args);
      return true;
    });

    await mailer.send(USER, "receipt", { planName: "Pro", amount: 1234, currency: "KRW", periodEnd: iso(NOW), receiptUrl: null, card: null });

    expect(sent).toHaveLength(1);
    const [to, kind, data, opts] = sent[0] as [string, string, Record<string, unknown>, Record<string, unknown>];
    expect(to).toBe("user@example.com");
    expect(kind).toBe("receipt");
    expect(data.manageUrl).toMatch(/^https?:\/\/[^/]+\/en\/mypage\/billing$/);
    expect(data.pricingUrl).toMatch(/^https?:\/\/[^/]+\/en\/pricing$/);
    expect(opts).toMatchObject({ locale: "en" });
  });

  it("이메일이 없으면 조용히 건너뛰고, 조회가 돌려준 오류·발송 실패는 기록만 하고 삼킨다", async () => {
    const logs: string[] = [];
    const log = async (m: string) => {
      logs.push(m);
    };
    let sends = 0;
    const send = async () => {
      sends++;
      return true;
    };

    await createBillingMailer(mailerAdmin({ email: null, locale: "ko" }), log, send).send(USER, "receipt", {});
    expect(logs).toHaveLength(0);

    await expect(createBillingMailer(mailerAdmin({ email: "a@b.c", locale: "ko", authError: true }), log, send).send(USER, "receipt", {})).resolves.toBeUndefined();
    await expect(createBillingMailer(mailerAdmin({ email: "a@b.c", locale: "ko", profileError: true }), log, send).send(USER, "receipt", {})).resolves.toBeUndefined();
    expect(sends).toBe(0);
    expect(logs).toHaveLength(2);
    expect(logs[0]).toContain("unexpected_failure");
    expect(logs[1]).toContain("57014");

    await createBillingMailer(mailerAdmin({ email: "a@b.c", locale: "ko" }), log, async () => false).send(USER, "receipt", {});
    expect(logs).toHaveLength(3);
    expect(logs.every((l) => l.includes(USER) && !l.includes("a@b.c"))).toBe(true);

    await createBillingMailer(mailerAdmin({ email: "a@b.c", locale: "ko" }), log, send).send(null, "receipt", {});
    expect(logs).toHaveLength(3);
    expect(sends).toBe(0);
  });
});

describe("메모리 저장소 — DB 모양 흉내", () => {
  it("timestamptz는 PostgREST 모양(+00:00, 소수 초 뒤 0 생략)으로 돌려준다", async () => {
    expect(pgTime("2026-01-30T16:00:00.000Z")).toBe("2026-01-30T16:00:00+00:00");
    expect(pgTime("2026-01-30T16:00:05.120Z")).toBe("2026-01-30T16:00:05.12+00:00");
    expect(pgTime("2026-01-31T01:00:00+09:00")).toBe("2026-01-30T16:00:00+00:00");

    const { store, checkout } = setup();
    expect((await store.getCheckout(checkout.id))?.expires_at).toBe(pgTime(NOW + 30 * MIN));
    const sub = await store.insertSubscription({
      user_id: USER,
      provider: "toss",
      livemode: false,
      plan_code: "pro",
      price_id: null,
      amount: 1234,
      currency: "KRW",
      interval: "month",
      current_period_start: iso(NOW),
      current_period_end: iso(NOW + 28 * DAY),
      billing_anchor_day: 31,
    });
    if (sub === "hasActive") throw new Error("unexpected");
    expect(sub.current_period_start).toBe("2026-01-30T16:00:00+00:00");
    expect(sub.current_period_start).not.toBe(iso(NOW));
  });
});
