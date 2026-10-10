import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { PolarError, type PolarCheckout, type PolarOrder, type PolarSubscription } from "../src/lib/billing/polar";
import { createSupabaseBillingStore } from "../src/lib/billing/store";
import type { CheckoutRow, PaymentRow, RefundRow } from "../src/lib/billing/types";
import { morAutoRefundId } from "../src/lib/billing/flows/mor";
import { handleMorWebhook, parsePolarWebhookBody, type MorWebhookEvent } from "../src/lib/billing/flows/morWebhook";
import {
  NOW,
  checkoutRow,
  createFakePolar,
  createMemoryStore,
  makeMorDeps,
  paymentRow,
  pgTime,
  polarCheckout,
  polarOrder,
  polarRefund,
  polarSubscription,
  priceRow,
  subscriptionRow,
  type FakeMorDeps,
  type MemoryRows,
  type MemorySubscription,
  type PolarScript,
} from "./billingFakes";

// 가짜 값만 쓴다 — 실제 금액·상품·사용자·이벤트가 아니다
const USER = "11111111-1111-4111-8111-111111111111";
const OTHER_USER = "22222222-2222-4222-8222-222222222222";
const POLAR_CHECKOUT = "33333333-3333-4333-8333-333333333333";
const PRODUCT = "44444444-4444-4444-8444-444444444444";
const CUSTOMER = "55555555-5555-4555-8555-555555555555";
const SUB_ID = "66666666-6666-4666-8666-666666666666";
const ORDER_ID = "77777777-7777-4777-8777-777777777777";
const REFUND_ID = "88888888-8888-4888-8888-888888888888";
const ATTEMPT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const EVENT_ID = "msg_fake_event_0001";

const T0 = "2026-01-20T16:00:05.123456Z";
const PERIOD_START = "2026-01-20T16:00:00.000000Z";
const PERIOD_END = "2026-02-20T16:00:00.000000Z";

const PRICE = priceRow({ id: "99999999-9999-4999-8999-999999999999", provider: "mor", currency: "USD", external_price_id: PRODUCT, livemode: false });

function world(seed: Partial<MemoryRows> = {}, script: Partial<PolarScript> = {}) {
  const store = createMemoryStore({ prices: [PRICE], profiles: [USER, OTHER_USER], ...seed }, { now: () => NOW });
  const deps = makeMorDeps({ store, polar: createFakePolar(script) });
  return { deps, store, rows: store.rows };
}

function event(type: string, dataId: string | null = SUB_ID, over: Partial<MorWebhookEvent> = {}): MorWebhookEvent {
  return { id: EVENT_ID, type, dataId, livemode: false, ...over };
}

function sub(over: Partial<PolarSubscription> = {}): PolarSubscription {
  return polarSubscription({
    id: SUB_ID,
    modified_at: T0,
    current_period_start: PERIOD_START,
    current_period_end: PERIOD_END,
    product_id: PRODUCT,
    customer: { id: CUSTOMER, external_id: USER },
    metadata: { user_id: USER },
    ...over,
  });
}

function order(over: Partial<PolarOrder> = {}): PolarOrder {
  return polarOrder({ id: ORDER_ID, subscription_id: SUB_ID, customer: { external_id: USER }, product_id: PRODUCT, metadata: { user_id: USER }, ...over });
}

/** 구독 없는 주문(환불 테스트용) — 환불 기록 갱신만 보이게 구독 동기화를 뺀다 */
const looseOrder = (over: Partial<PolarOrder> = {}) => order({ subscription_id: null, billing_reason: "purchase", ...over });

function morRow(over: Partial<MemorySubscription> = {}): MemorySubscription {
  return {
    ...subscriptionRow({
      user_id: USER,
      provider: "mor",
      currency: "USD",
      billing_anchor_day: null,
      price_id: PRICE.id,
      current_period_start: PERIOD_START,
      current_period_end: PERIOD_END,
    }),
    mor_provider: "polar",
    external_id: SUB_ID,
    external_customer_id: CUSTOMER,
    external_updated_at: T0,
    ...over,
  };
}

/** 이 주문의 결제 행(이미 적힘) */
function orderPayment(over: Partial<PaymentRow> = {}): PaymentRow {
  return paymentRow({
    user_id: USER,
    provider: "mor",
    currency: "USD",
    external_payment_id: ORDER_ID,
    order_id: `mor_${ORDER_ID}`,
    status: "paid",
    amount: 1334,
    period_start: null,
    period_end: null,
    approved_at: pgTime(NOW),
    ...over,
  });
}

function refundRow(payment: PaymentRow, over: Partial<RefundRow> = {}): RefundRow {
  return {
    id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    payment_id: payment.id,
    amount: 1234,
    reason: "admin",
    external_refund_id: REFUND_ID,
    status: "pending",
    requested_by: null,
    ...over,
  };
}

const attempt = (over: Partial<CheckoutRow> = {}) => checkoutRow({ id: ATTEMPT, user_id: USER, price_id: PRICE.id, provider: "mor", ...over });

/** Polar 결제창(정본) — 우리 결제 시작(Task 4)이 넣는 metadata·external_customer_id를 갖췄다 */
function checkout(over: Partial<PolarCheckout> = {}): PolarCheckout {
  return polarCheckout({ id: POLAR_CHECKOUT, external_customer_id: USER, product_id: PRODUCT, metadata: { checkout_id: ATTEMPT, user_id: USER }, ...over });
}

const logs = (deps: FakeMorDeps) => deps.log.mock.calls.map((c) => c[0]);
const reviews = (deps: FakeMorDeps) => logs(deps).filter((m) => m.startsWith("billing needs review:"));
const morSub = (rows: MemoryRows) => rows.subscriptions.find((s) => s.external_id === SUB_ID);
const eventRow = (rows: MemoryRows, id = EVENT_ID) => rows.webhookEvents.find((e) => e.event_id === id);

function expectIdsOnly(deps: FakeMorDeps) {
  for (const m of logs(deps)) {
    expect(m).not.toMatch(/@/);
    expect(m).not.toMatch(/polar_oat|whsec_/);
  }
}

// ── 이벤트 기록 ──

describe("handleMorWebhook — billing_webhook_events 기록", () => {
  it("처음 받은 이벤트: provider polar, event_id = webhook-id, payload는 {type, data_id}만, 처리 뒤 processed_at", async () => {
    const { deps, rows } = world({}, { getSubscription: [sub()] });

    expect(await handleMorWebhook(deps, event("subscription.created"))).toBe("processed");

    expect(rows.webhookEvents).toHaveLength(1);
    const row = eventRow(rows)!;
    expect(row).toMatchObject({ provider: "polar", event_id: EVENT_ID, event_type: "subscription.created", attempts: 1, last_error: null });
    expect(row.payload).toEqual({ type: "subscription.created", data_id: SUB_ID });
    expect(Object.keys(row.payload as object).sort()).toEqual(["data_id", "type"]);
    expect(row.processed_at).not.toBeNull();
  });

  it("이미 처리한 이벤트의 재전송은 duplicate — Polar를 다시 읽지 않고 시도 횟수도 그대로", async () => {
    const { deps, rows } = world({}, { getSubscription: [sub()] });
    await handleMorWebhook(deps, event("subscription.created"));

    expect(await handleMorWebhook(deps, event("subscription.created"))).toBe("duplicate");
    expect(deps.polar.calls.getSubscription).toHaveLength(1);
    expect(eventRow(rows)!.attempts).toBe(1);
    expect(rows.subscriptions).toHaveLength(1);
  });

  it("처리 실패 → last_error를 먼저 적고 던진다(500, 재시도) → 같은 webhook-id 재전송은 attempts 2로 처리를 마친다", async () => {
    const { deps, rows } = world({}, { getSubscription: [new PolarError("NETWORK", "polar getSubscription failed (network)", 0)] });

    await expect(handleMorWebhook(deps, event("subscription.active"))).rejects.toThrow("network");
    let row = eventRow(rows)!;
    expect(row.processed_at).toBeNull();
    expect(row.attempts).toBe(1);
    expect(row.last_error).toBe("polar getSubscription failed (network)");
    expect(logs(deps)).toEqual([`billing polar webhook ${EVENT_ID} (subscription.active) failed: polar getSubscription failed (network)`]);
    expect(morSub(rows)).toBeUndefined();

    deps.polar.script.getSubscription.push(sub());
    expect(await handleMorWebhook(deps, event("subscription.active"))).toBe("processed");
    row = eventRow(rows)!;
    expect(row.attempts).toBe(2);
    expect(row.processed_at).not.toBeNull();
    expect(morSub(rows)).toMatchObject({ status: "active", user_id: USER });
  });

  it("Polar 5xx도 결과 불명이라 던진다", async () => {
    const { deps, rows } = world({}, { getSubscription: [new PolarError("HTTP_502", "polar getSubscription failed: HTTP_502 (502)", 502)] });
    await expect(handleMorWebhook(deps, event("subscription.updated"))).rejects.toThrow("HTTP_502");
    expect(eventRow(rows)!.last_error).toBe("polar getSubscription failed: HTTP_502 (502)");
  });

  it("흐름의 저장소 오류도 던진다 — last_error에는 짧은 문구만(300자 이내)", async () => {
    const { deps, store, rows } = world({}, { getSubscription: [sub()] });
    store.getSubscriptionByExternal = async () => {
      throw new Error(`billing store getSubscriptionByExternal: ${"x".repeat(1000)}`);
    };
    await expect(handleMorWebhook(deps, event("subscription.updated"))).rejects.toThrow("billing store");
    const row = eventRow(rows)!;
    expect(row.last_error!.startsWith("billing store getSubscriptionByExternal: ")).toBe(true);
    expect(row.last_error!.length).toBeLessThanOrEqual(300);
  });

  it("이벤트를 적지 못하면(저장소 오류) Polar를 부르지 않고 기록 한 줄 뒤 던진다", async () => {
    const { deps, store } = world();
    store.recordWebhookEvent = async () => {
      throw new Error("billing store recordWebhookEvent: timeout");
    };
    await expect(handleMorWebhook(deps, event("subscription.created"))).rejects.toThrow("timeout");
    expect(deps.polar.calls.getSubscription).toEqual([]);
    expect(logs(deps)).toEqual([`billing polar webhook ${EVENT_ID} (subscription.created) could not be recorded: billing store recordWebhookEvent: timeout`]);
  });

  it("last_error를 적다 실패해도 원래 오류를 던진다", async () => {
    const { deps, store } = world({}, { getSubscription: [new PolarError("NETWORK", "polar getSubscription failed (network)", 0)] });
    store.finishWebhookEvent = async () => {
      throw new Error("billing store finishWebhookEvent: down");
    };
    await expect(handleMorWebhook(deps, event("subscription.created"))).rejects.toThrow("polar getSubscription failed (network)");
  });

  it("처리 완료를 적지 못하면 던진다(재시도 — 흐름은 멱등이다)", async () => {
    const { deps, store } = world({}, { getSubscription: [sub()] });
    store.finishWebhookEvent = async (_p, _id, outcome) => {
      if (outcome.error === undefined) throw new Error("billing store finishWebhookEvent: down");
    };
    await expect(handleMorWebhook(deps, event("subscription.created"))).rejects.toThrow("down");
  });
});

// ── 구독 ──

describe("구독 이벤트 — 정본을 다시 읽어 syncMorSubscription", () => {
  it.each([
    "subscription.created",
    "subscription.active",
    "subscription.updated",
    "subscription.uncanceled",
    "subscription.cycled",
    "subscription.resumed",
    "subscription.some_future_event",
  ])("%s → getSubscription(data.id) → 동기화", async (type) => {
    const { deps, rows } = world({}, { getSubscription: [sub()] });
    expect(await handleMorWebhook(deps, event(type))).toBe("processed");
    expect(deps.polar.calls.getSubscription).toEqual([[SUB_ID]]);
    expect(morSub(rows)).toMatchObject({ status: "active", provider: "mor", livemode: false });
  });

  it("해지(canceled) 이벤트도 정본 상태로 — 진행 중 행을 끝낸다", async () => {
    const { deps, rows } = world(
      { subscriptions: [morRow()] },
      { getSubscription: [sub({ status: "canceled", modified_at: "2026-01-25T16:00:00.000000Z", ended_at: "2026-01-25T16:00:00.000000Z" })] },
    );
    await handleMorWebhook(deps, event("subscription.revoked"));
    expect(morSub(rows)).toMatchObject({ status: "ended", ended_reason: "user_canceled" });
  });

  it("livemode는 이벤트 값(배포 모드)을 쓴다 — live면 실결제 행", async () => {
    const livePrice = { ...PRICE, id: "98989898-9898-4898-8898-989898989898", livemode: true };
    const { deps, rows } = world({ prices: [livePrice] }, { getSubscription: [sub()] });
    await handleMorWebhook(deps, event("subscription.created", SUB_ID, { livemode: true }));
    expect(morSub(rows)).toMatchObject({ livemode: true, price_id: livePrice.id });
  });

  it("review로 끝난 동기화도 처리됨(processed) — 가격 매핑이 없으면 needs review 한 줄, 행 없음", async () => {
    const { deps, rows } = world({ prices: [] }, { getSubscription: [sub()] });
    expect(await handleMorWebhook(deps, event("subscription.created"))).toBe("processed");
    expect(reviews(deps)).toHaveLength(1);
    expect(rows.subscriptions).toEqual([]);
    expect(eventRow(rows)!.processed_at).not.toBeNull();
  });

  it("오래된 상태(stale)도 처리됨 — 행은 그대로", async () => {
    const { deps, rows } = world(
      { subscriptions: [morRow({ external_updated_at: "2026-01-26T00:00:00.000000Z" })] },
      { getSubscription: [sub({ status: "canceled" })] },
    );
    expect(await handleMorWebhook(deps, event("subscription.canceled"))).toBe("processed");
    expect(morSub(rows)).toMatchObject({ status: "active" });
  });

  it("Polar 404(지워짐)는 처리됨 + 기록 한 줄", async () => {
    const { deps, rows } = world({}, { getSubscription: [new PolarError("ResourceNotFound", "polar getSubscription failed: ResourceNotFound (404)", 404)] });
    expect(await handleMorWebhook(deps, event("subscription.updated"))).toBe("processed");
    expect(logs(deps)).toEqual([`billing polar subscription ${SUB_ID} was not found at Polar; webhook event ${EVENT_ID} skipped`]);
    expect(rows.subscriptions).toEqual([]);
    expect(eventRow(rows)!.processed_at).not.toBeNull();
  });

  it("그 밖의 Polar 4xx(권한·한도)는 던진다 — 설정을 고치면 재시도가 처리한다", async () => {
    const { deps } = world({}, { getSubscription: [new PolarError("HTTP_401", "polar getSubscription failed: HTTP_401 (401)", 401)] });
    await expect(handleMorWebhook(deps, event("subscription.updated"))).rejects.toThrow("401");
  });

  it("data.id가 없으면 Polar를 부르지 않고 처리됨 + 기록 한 줄", async () => {
    const { deps, rows } = world();
    expect(await handleMorWebhook(deps, event("subscription.updated", null))).toBe("processed");
    expect(deps.polar.calls.getSubscription).toEqual([]);
    expect(logs(deps)).toEqual([`billing polar webhook ${EVENT_ID} (subscription.updated) has no usable data id; skipped`]);
    expect(eventRow(rows)!.payload).toEqual({ type: "subscription.updated", data_id: null });
  });
});

// ── 주문 ──

describe("주문 이벤트 — 주문·구독을 다시 읽어 구독을 먼저 동기화하고 주문을 적는다", () => {
  it("order.paid: getOrder → getSubscription → 구독 행을 먼저 만들고, 결제 행은 그 구독·기간에 이어진다", async () => {
    const { deps, store, rows } = world({}, { getOrder: [order()], getSubscription: [sub()] });
    const seq: string[] = [];
    const insertSub = store.insertMorSubscription;
    store.insertMorSubscription = async (r) => {
      seq.push("subscription");
      return insertSub(r);
    };
    const insertPay = store.insertExternalPayment;
    store.insertExternalPayment = async (r) => {
      seq.push("payment");
      return insertPay(r);
    };

    expect(await handleMorWebhook(deps, event("order.paid", ORDER_ID))).toBe("processed");

    expect(deps.polar.calls.getOrder).toEqual([[ORDER_ID]]);
    expect(deps.polar.calls.getSubscription).toEqual([[SUB_ID]]);
    expect(seq).toEqual(["subscription", "payment"]);
    const subRow = morSub(rows)!;
    expect(rows.payments).toHaveLength(1);
    expect(rows.payments[0]).toMatchObject({
      external_payment_id: ORDER_ID,
      subscription_id: subRow.id,
      status: "paid",
      kind: "initial",
      period_start: pgTime(PERIOD_START),
      period_end: pgTime(PERIOD_END),
    });
  });

  it("갱신 주문(subscription_cycle)도 구독을 먼저 맞춰 갱신 행으로 적힌다", async () => {
    const NEXT_START = "2026-02-20T16:00:00.000000Z";
    const NEXT_END = "2026-03-20T16:00:00.000000Z";
    const { deps, rows } = world(
      { subscriptions: [morRow()] },
      {
        getOrder: [order({ billing_reason: "subscription_cycle", created_at: "2026-02-20T16:00:01.000000Z" })],
        getSubscription: [sub({ modified_at: "2026-02-20T16:00:02.000000Z", current_period_start: NEXT_START, current_period_end: NEXT_END })],
      },
    );
    await handleMorWebhook(deps, event("order.created", ORDER_ID));
    expect(morSub(rows)).toMatchObject({ current_period_start: pgTime(NEXT_START) });
    expect(rows.payments[0]).toMatchObject({ kind: "renewal", period_start: pgTime(NEXT_START), subscription_id: morSub(rows)!.id });
  });

  it("구독이 없는 주문은 recordMorOrder만 — 구독을 읽지 않는다", async () => {
    const { deps, rows } = world({}, { getOrder: [order({ subscription_id: null, billing_reason: "purchase" })] });
    await handleMorWebhook(deps, event("order.updated", ORDER_ID));
    expect(deps.polar.calls.getSubscription).toEqual([]);
    expect(rows.payments).toHaveLength(1);
    expect(rows.payments[0]).toMatchObject({ external_payment_id: ORDER_ID, subscription_id: null });
  });

  it("주문의 구독이 Polar에 없으면(404) 기록 한 줄 뒤 주문은 그대로 적는다", async () => {
    const { deps, rows } = world({}, { getOrder: [order()], getSubscription: [new PolarError("ResourceNotFound", "x", 404)] });
    expect(await handleMorWebhook(deps, event("order.paid", ORDER_ID))).toBe("processed");
    expect(logs(deps)).toContain(`billing polar subscription ${SUB_ID} was not found at Polar; webhook event ${EVENT_ID} skipped`);
    expect(rows.payments).toHaveLength(1);
    expect(rows.subscriptions).toEqual([]);
  });

  it("주문이 Polar에 없으면(404) 처리됨 + 기록 한 줄", async () => {
    const { deps, rows } = world({}, { getOrder: [new PolarError("ResourceNotFound", "x", 404)] });
    expect(await handleMorWebhook(deps, event("order.refunded", ORDER_ID))).toBe("processed");
    expect(logs(deps)).toEqual([`billing polar order ${ORDER_ID} was not found at Polar; webhook event ${EVENT_ID} skipped`]);
    expect(rows.payments).toEqual([]);
  });

  it("구독 읽기가 결과 불명이면 주문도 적지 않고 던진다(다음 재시도가 순서대로 다시 한다)", async () => {
    const { deps, rows } = world({}, { getOrder: [order()], getSubscription: [new PolarError("NETWORK", "polar getSubscription failed (network)", 0)] });
    await expect(handleMorWebhook(deps, event("order.paid", ORDER_ID))).rejects.toThrow("network");
    expect(rows.payments).toEqual([]);
  });

  it("주문 단서(orderId)를 넘긴다 — 기간을 받은 적 없이 해지된 구독의 주문은 자동 환불된다", async () => {
    const canceled = sub({ status: "canceled", ended_at: "2026-01-20T16:10:00.000000Z", canceled_at: "2026-01-20T16:10:00.000000Z" });
    const { deps, rows } = world(
      {},
      {
        getOrder: [order(), order()],
        getSubscription: [canceled],
        createRefund: [polarRefund({ id: REFUND_ID, status: "succeeded", amount: 1234, order_id: ORDER_ID })],
      },
    );
    expect(await handleMorWebhook(deps, event("order.paid", ORDER_ID))).toBe("processed");
    expect(deps.polar.calls.createRefund).toHaveLength(1);
    expect(deps.polar.calls.createRefund[0]![0]).toMatchObject({ order_id: ORDER_ID });
    expect(rows.refunds).toHaveLength(1);
    expect(rows.refunds[0]).toMatchObject({ status: "succeeded", external_refund_id: REFUND_ID });
    expect(rows.payments).toHaveLength(1);
    expectIdsOnly(deps);
  });
});

// ── 환불 ──

describe("환불 이벤트 — 환불을 다시 읽어 우리 환불 기록을 맞추고, 그 주문을 주문 이벤트처럼 처리한다", () => {
  it("refund.updated succeeded: external_refund_id가 같은 pending 기록 → succeeded, 주문을 다시 읽어 환불액을 적는다", async () => {
    const payment = orderPayment();
    const { deps, rows } = world(
      { payments: [payment], refunds: [refundRow(payment)] },
      {
        getRefund: [polarRefund({ id: REFUND_ID, status: "succeeded", order_id: ORDER_ID })],
        getOrder: [looseOrder({ status: "refunded", refunded_amount: 1234, refunded_tax_amount: 100, refundable_amount: 0 })],
      },
    );
    expect(await handleMorWebhook(deps, event("refund.updated", REFUND_ID))).toBe("processed");
    expect(deps.polar.calls.getRefund).toEqual([[REFUND_ID]]);
    expect(deps.polar.calls.getOrder).toEqual([[ORDER_ID]]);
    expect(rows.refunds[0]).toMatchObject({ status: "succeeded", external_refund_id: REFUND_ID });
    expect(rows.payments[0]).toMatchObject({ status: "refunded", refunded_amount: 1334 });
    expect(reviews(deps)).toEqual([]);
  });

  it("환불의 주문에 구독이 있으면 주문 이벤트와 같이 구독도 다시 읽어 맞춘다", async () => {
    const payment = orderPayment();
    const { deps, rows } = world(
      { subscriptions: [morRow()], payments: [payment], refunds: [refundRow(payment)] },
      {
        getRefund: [polarRefund({ id: REFUND_ID, status: "succeeded", order_id: ORDER_ID })],
        getOrder: [order({ status: "refunded", refunded_amount: 1234, refunded_tax_amount: 100, refundable_amount: 0 })],
        getSubscription: [sub()],
      },
    );
    await handleMorWebhook(deps, event("refund.created", REFUND_ID));
    expect(deps.polar.calls.getSubscription).toEqual([[SUB_ID]]);
    expect(rows.payments[0]).toMatchObject({ status: "refunded", subscription_id: morSub(rows)!.id });
  });

  it("자동 환불(결정적 id)이 Polar에서 failed → 기록 failed + needs review 한 줄(id만)", async () => {
    const payment = orderPayment();
    const autoId = morAutoRefundId(payment.id);
    const { deps, rows } = world(
      { payments: [payment], refunds: [refundRow(payment, { id: autoId, reason: "auto_duplicate" })] },
      { getRefund: [polarRefund({ id: REFUND_ID, status: "failed", order_id: ORDER_ID })], getOrder: [looseOrder()] },
    );
    await handleMorWebhook(deps, event("refund.updated", REFUND_ID));
    expect(rows.refunds[0]).toMatchObject({ id: autoId, status: "failed" });
    expect(reviews(deps)).toEqual([
      `billing needs review: automatic refund ${REFUND_ID} of order ${ORDER_ID} (payment ${payment.id}) was failed at Polar; the customer has not been refunded`,
    ]);
    expectIdsOnly(deps);
  });

  it("자동 환불이 canceled여도 failed로 적고 needs review", async () => {
    const payment = orderPayment();
    const autoId = morAutoRefundId(payment.id);
    const { deps, rows } = world(
      { payments: [payment], refunds: [refundRow(payment, { id: autoId, reason: "auto_ungranted", status: "succeeded" })] },
      { getRefund: [polarRefund({ id: REFUND_ID, status: "canceled", order_id: ORDER_ID })], getOrder: [looseOrder()] },
    );
    await handleMorWebhook(deps, event("refund.updated", REFUND_ID));
    expect(rows.refunds[0]!.status).toBe("failed");
    expect(reviews(deps)).toHaveLength(1);
    expect(reviews(deps)[0]).toContain("was canceled at Polar");
  });

  it("이미 failed로 적힌 자동 환불의 다음 이벤트는 needs review를 다시 남기지 않는다", async () => {
    const payment = orderPayment();
    const autoId = morAutoRefundId(payment.id);
    const { deps, rows } = world(
      { payments: [payment], refunds: [refundRow(payment, { id: autoId, status: "failed" })] },
      { getRefund: [polarRefund({ id: REFUND_ID, status: "failed", order_id: ORDER_ID })], getOrder: [looseOrder()] },
    );
    await handleMorWebhook(deps, event("refund.updated", REFUND_ID));
    expect(rows.refunds[0]!.status).toBe("failed");
    expect(reviews(deps)).toEqual([]);
  });

  it("failed로 적힌 자동 환불이 Polar에서 succeeded면 succeeded로 고치고 기록 한 줄(수동 환불 전에 보이게)", async () => {
    const payment = orderPayment();
    const autoId = morAutoRefundId(payment.id);
    const { deps, rows } = world(
      { payments: [payment], refunds: [refundRow(payment, { id: autoId, status: "failed" })] },
      { getRefund: [polarRefund({ id: REFUND_ID, status: "succeeded", order_id: ORDER_ID })], getOrder: [looseOrder()] },
    );
    await handleMorWebhook(deps, event("refund.updated", REFUND_ID));
    expect(rows.refunds[0]!.status).toBe("succeeded");
    expect(reviews(deps)).toEqual([]);
    expect(logs(deps)).toEqual([`billing automatic refund ${REFUND_ID} of order ${ORDER_ID} (payment ${payment.id}) succeeded at Polar after it was recorded as failed`]);
  });

  it("관리자 환불(무작위 id)의 실패는 failed로 적되 needs review는 남기지 않는다", async () => {
    const payment = orderPayment();
    const { deps, rows } = world(
      { payments: [payment], refunds: [refundRow(payment)] },
      { getRefund: [polarRefund({ id: REFUND_ID, status: "failed", order_id: ORDER_ID })], getOrder: [looseOrder()] },
    );
    await handleMorWebhook(deps, event("refund.updated", REFUND_ID));
    expect(rows.refunds[0]!.status).toBe("failed");
    expect(reviews(deps)).toEqual([]);
  });

  it("Polar가 아직 pending이면 기록은 그대로(pending으로 되돌리지도 않는다)", async () => {
    const payment = orderPayment();
    const { deps, rows } = world(
      { payments: [payment], refunds: [refundRow(payment, { status: "succeeded" })] },
      { getRefund: [polarRefund({ id: REFUND_ID, status: "pending", order_id: ORDER_ID })], getOrder: [looseOrder()] },
    );
    await handleMorWebhook(deps, event("refund.created", REFUND_ID));
    expect(rows.refunds[0]!.status).toBe("succeeded");
  });

  it("결과 불명으로 Polar id 없이 남은 자동 환불 — metadata.payment_id가 그 결제면 Polar id를 잇고 상태를 맞춘다", async () => {
    const payment = orderPayment();
    const autoId = morAutoRefundId(payment.id);
    const { deps, rows } = world(
      { payments: [payment], refunds: [refundRow(payment, { id: autoId, external_refund_id: null })] },
      {
        getRefund: [polarRefund({ id: REFUND_ID, status: "succeeded", order_id: ORDER_ID, metadata: { payment_id: payment.id.toUpperCase() } })],
        getOrder: [looseOrder({ status: "refunded", refunded_amount: 1234, refunded_tax_amount: 100, refundable_amount: 0 })],
      },
    );
    await handleMorWebhook(deps, event("refund.created", REFUND_ID));
    expect(rows.refunds[0]).toMatchObject({ id: autoId, external_refund_id: REFUND_ID, status: "succeeded" });
  });

  it("metadata가 없거나 다른 결제를 가리키면(대시보드 환불) 자동 환불 기록에 잇지 않는다", async () => {
    for (const metadata of [{}, { payment_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc" }, { payment_id: 42 }]) {
      const payment = orderPayment();
      const autoId = morAutoRefundId(payment.id);
      const { deps, rows } = world(
        { payments: [payment], refunds: [refundRow(payment, { id: autoId, external_refund_id: null })] },
        { getRefund: [polarRefund({ id: REFUND_ID, status: "succeeded", order_id: ORDER_ID, metadata })], getOrder: [looseOrder()] },
      );
      await handleMorWebhook(deps, event("refund.created", REFUND_ID));
      expect(rows.refunds[0]).toMatchObject({ external_refund_id: null, status: "pending" });
    }
  });

  it("이미 다른 Polar id가 적힌 자동 환불 기록은 덮지 않는다", async () => {
    const payment = orderPayment();
    const autoId = morAutoRefundId(payment.id);
    const OTHER_REFUND = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
    const { deps, rows } = world(
      { payments: [payment], refunds: [refundRow(payment, { id: autoId, external_refund_id: OTHER_REFUND })] },
      { getRefund: [polarRefund({ id: REFUND_ID, status: "failed", order_id: ORDER_ID, metadata: { payment_id: payment.id } })], getOrder: [looseOrder()] },
    );
    await handleMorWebhook(deps, event("refund.updated", REFUND_ID));
    expect(rows.refunds[0]).toMatchObject({ external_refund_id: OTHER_REFUND, status: "pending" });
    expect(reviews(deps)).toEqual([]);
  });

  it("Polar id가 같은데 다른 결제의 기록이면 바꾸지 않고 needs review", async () => {
    const payment = orderPayment();
    const elsewhere = paymentRow({ user_id: USER, provider: "mor", currency: "USD", status: "paid", period_start: null, period_end: null });
    const { deps, rows } = world(
      { payments: [payment, elsewhere], refunds: [refundRow(elsewhere)] },
      { getRefund: [polarRefund({ id: REFUND_ID, status: "succeeded", order_id: ORDER_ID })], getOrder: [looseOrder()] },
    );
    await handleMorWebhook(deps, event("refund.updated", REFUND_ID));
    expect(rows.refunds[0]!.status).toBe("pending");
    expect(reviews(deps)).toHaveLength(1);
    expect(reviews(deps)[0]).toContain(`Polar refund ${REFUND_ID}`);
  });

  it("우리 결제 기록이 없는 주문의 환불은 기록을 건드리지 않고 주문만 적는다", async () => {
    const { deps, rows } = world({}, { getRefund: [polarRefund({ id: REFUND_ID, status: "succeeded", order_id: ORDER_ID })], getOrder: [looseOrder()] });
    await handleMorWebhook(deps, event("refund.created", REFUND_ID));
    expect(rows.refunds).toEqual([]);
    expect(rows.payments).toHaveLength(1);
  });

  it("기록을 맞추는 사이 다른 요청이 바꿨으면 한 번 다시 읽어 맞춘다", async () => {
    const payment = orderPayment();
    const { deps, store, rows } = world(
      { payments: [payment], refunds: [refundRow(payment)] },
      { getRefund: [polarRefund({ id: REFUND_ID, status: "succeeded", order_id: ORDER_ID })], getOrder: [looseOrder()] },
    );
    const real = store.updateRefundIf;
    let first = true;
    store.updateRefundIf = async (...args) => {
      if (first) {
        first = false;
        return false;
      }
      return real(...args);
    };
    await handleMorWebhook(deps, event("refund.updated", REFUND_ID));
    expect(rows.refunds[0]!.status).toBe("succeeded");
  });

  it("환불이 Polar에 없으면(404) 처리됨 + 기록 한 줄, 주문은 읽지 않는다", async () => {
    const { deps } = world({}, { getRefund: [new PolarError("ResourceNotFound", "x", 404)] });
    expect(await handleMorWebhook(deps, event("refund.updated", REFUND_ID))).toBe("processed");
    expect(deps.polar.calls.getOrder).toEqual([]);
    expect(logs(deps)).toEqual([`billing polar refund ${REFUND_ID} was not found at Polar; webhook event ${EVENT_ID} skipped`]);
  });

  it("환불 읽기가 결과 불명이면 던진다", async () => {
    const { deps } = world({}, { getRefund: [new PolarError("NETWORK", "polar getRefund failed (network)", 0)] });
    await expect(handleMorWebhook(deps, event("refund.created", REFUND_ID))).rejects.toThrow("network");
  });
});

// ── 결제창 ──

describe("결제창 이벤트 — checkout.updated·expired", () => {
  it("succeeded + subscription_id → 구독을 다시 읽어 동기화(우리 시도는 completed)", async () => {
    const { deps, rows } = world(
      { checkouts: [attempt()] },
      {
        getCheckout: [checkout({ id: POLAR_CHECKOUT, status: "succeeded", subscription_id: SUB_ID, metadata: { checkout_id: ATTEMPT, user_id: USER } })],
        getSubscription: [sub({ metadata: { user_id: USER, checkout_id: ATTEMPT } })],
      },
    );
    expect(await handleMorWebhook(deps, event("checkout.updated", POLAR_CHECKOUT))).toBe("processed");
    expect(deps.polar.calls.getCheckout).toEqual([[POLAR_CHECKOUT]]);
    expect(deps.polar.calls.getSubscription).toEqual([[SUB_ID]]);
    expect(morSub(rows)).toMatchObject({ status: "active" });
    expect(rows.checkouts[0]).toMatchObject({ status: "completed", subscription_id: morSub(rows)!.id });
  });

  it("succeeded인데 구독이 아직 없으면 할 일 없음(subscription.* 이벤트가 맡는다)", async () => {
    const { deps, rows } = world({ checkouts: [attempt()] }, { getCheckout: [checkout({ status: "succeeded", subscription_id: null })] });
    expect(await handleMorWebhook(deps, event("checkout.updated", POLAR_CHECKOUT))).toBe("processed");
    expect(deps.polar.calls.getSubscription).toEqual([]);
    expect(rows.checkouts[0]!.status).toBe("open");
  });

  it("expired → 우리 시도를 expired로(metadata.checkout_id, 주인 확인)", async () => {
    const { deps, rows } = world({ checkouts: [attempt()] }, { getCheckout: [checkout({ status: "expired", metadata: { checkout_id: ATTEMPT } })] });
    await handleMorWebhook(deps, event("checkout.expired", POLAR_CHECKOUT));
    expect(rows.checkouts[0]!.status).toBe("expired");
  });

  it("failed → 우리 시도를 failed로(실패 코드 polarCheckoutFailed)", async () => {
    const { deps, rows } = world({ checkouts: [attempt({ status: "processing" })] }, { getCheckout: [checkout({ status: "failed" })] });
    await handleMorWebhook(deps, event("checkout.updated", POLAR_CHECKOUT));
    expect(rows.checkouts[0]).toMatchObject({ status: "failed", failure_code: "polarCheckoutFailed" });
  });

  it("주인이 다르면(다른 사용자의 시도) 그대로 둔다", async () => {
    const { deps, rows } = world({ checkouts: [attempt()] }, { getCheckout: [checkout({ status: "expired", external_customer_id: OTHER_USER, metadata: { checkout_id: ATTEMPT } })] });
    await handleMorWebhook(deps, event("checkout.expired", POLAR_CHECKOUT));
    expect(rows.checkouts[0]!.status).toBe("open");
  });

  it("external_customer_id와 metadata.user_id가 엇갈리면 그대로 두고 기록 한 줄", async () => {
    const { deps, rows } = world(
      { checkouts: [attempt()] },
      { getCheckout: [checkout({ status: "expired", external_customer_id: USER, metadata: { checkout_id: ATTEMPT, user_id: OTHER_USER } })] },
    );
    await handleMorWebhook(deps, event("checkout.expired", POLAR_CHECKOUT));
    expect(rows.checkouts[0]!.status).toBe("open");
    expect(logs(deps)).toEqual([`billing polar checkout ${POLAR_CHECKOUT} has no usable user id; attempt ${ATTEMPT} left as is`]);
  });

  it("사용자 id가 UUID 모양이 아니면 믿지 않는다", async () => {
    const { deps, rows } = world({ checkouts: [attempt()] }, { getCheckout: [checkout({ status: "expired", metadata: { checkout_id: ATTEMPT, user_id: "someone" } })] });
    await handleMorWebhook(deps, event("checkout.expired", POLAR_CHECKOUT));
    expect(rows.checkouts[0]!.status).toBe("open");
  });

  it("사용자 id가 metadata에만 있어도 주인 확인에 쓴다", async () => {
    const { deps, rows } = world(
      { checkouts: [attempt()] },
      { getCheckout: [checkout({ status: "expired", external_customer_id: null, metadata: { checkout_id: ATTEMPT, user_id: USER } })] },
    );
    await handleMorWebhook(deps, event("checkout.expired", POLAR_CHECKOUT));
    expect(rows.checkouts[0]!.status).toBe("expired");
  });

  it("우리 시도 id가 없는 결제창은 할 일 없음", async () => {
    const { deps, rows } = world({ checkouts: [attempt()] }, { getCheckout: [checkout({ status: "expired", metadata: {} })] });
    await handleMorWebhook(deps, event("checkout.expired", POLAR_CHECKOUT));
    expect(rows.checkouts[0]!.status).toBe("open");
    expect(logs(deps)).toEqual([]);
  });

  it.each(["open", "confirmed", "something_new"])("%s → 처리됨, 할 일 없음", async (status) => {
    const { deps, rows } = world({ checkouts: [attempt()] }, { getCheckout: [checkout({ status })] });
    expect(await handleMorWebhook(deps, event("checkout.updated", POLAR_CHECKOUT))).toBe("processed");
    expect(rows.checkouts[0]!.status).toBe("open");
    expect(eventRow(rows)!.processed_at).not.toBeNull();
  });

  it("checkout.created는 무시(결제창을 읽지 않는다)", async () => {
    const { deps } = world();
    expect(await handleMorWebhook(deps, event("checkout.created", POLAR_CHECKOUT))).toBe("processed");
    expect(deps.polar.calls.getCheckout).toEqual([]);
  });

  it("결제창이 Polar에 없으면(404) 처리됨 + 기록 한 줄", async () => {
    const { deps } = world({}, { getCheckout: [new PolarError("ResourceNotFound", "x", 404)] });
    expect(await handleMorWebhook(deps, event("checkout.expired", POLAR_CHECKOUT))).toBe("processed");
    expect(logs(deps)).toEqual([`billing polar checkout ${POLAR_CHECKOUT} was not found at Polar; webhook event ${EVENT_ID} skipped`]);
  });
});

// ── 무시하는 이벤트 ──

describe("그 밖의 이벤트 — 처리됨으로 적고 아무것도 하지 않는다", () => {
  it.each([
    "customer.created",
    "customer.updated",
    "customer.state_changed",
    "benefit.created",
    "benefit_grant.created",
    "product.updated",
    "organization.updated",
    "refund.something_new",
    "brand_new.event",
  ])("%s", async (type) => {
    const { deps, rows } = world();
    expect(await handleMorWebhook(deps, event(type, CUSTOMER))).toBe("processed");
    for (const calls of Object.values(deps.polar.calls)) expect(calls).toEqual([]);
    expect(eventRow(rows)).toMatchObject({ event_type: type, payload: { type, data_id: CUSTOMER } });
    expect(eventRow(rows)!.processed_at).not.toBeNull();
    expect(logs(deps)).toEqual([]);
  });
});

// ── 본문 읽기 ──

describe("parsePolarWebhookBody — type과 data.id만 꺼낸다", () => {
  it("type과 data.id(소문자 UUID)만 — 본문의 상태·이메일은 돌려주지 않는다", () => {
    const body = JSON.stringify({
      type: "subscription.updated",
      timestamp: "2026-01-20T16:00:00Z",
      data: { id: SUB_ID.toUpperCase(), status: "canceled", customer: { email: "fake@example.test" }, metadata: { livemode: "true" } },
    });
    expect(parsePolarWebhookBody(body)).toEqual({ type: "subscription.updated", dataId: SUB_ID });
  });

  it("data.id가 없거나 UUID가 아니면 dataId null", () => {
    expect(parsePolarWebhookBody(JSON.stringify({ type: "customer.updated", data: {} }))).toEqual({ type: "customer.updated", dataId: null });
    expect(parsePolarWebhookBody(JSON.stringify({ type: "customer.updated", data: { id: "nope" } }))).toEqual({ type: "customer.updated", dataId: null });
    expect(parsePolarWebhookBody(JSON.stringify({ type: "customer.updated", data: { id: 42 } }))).toEqual({ type: "customer.updated", dataId: null });
    expect(parsePolarWebhookBody(JSON.stringify({ type: "customer.updated" }))).toEqual({ type: "customer.updated", dataId: null });
  });

  it.each([
    ["JSON이 아님", "not json"],
    ["빈 본문", ""],
    ["배열", "[]"],
    ["null", "null"],
    ["type 없음", JSON.stringify({ data: { id: SUB_ID } })],
    ["type이 문자열이 아님", JSON.stringify({ type: 1, data: { id: SUB_ID } })],
    ["type이 빈 문자열", JSON.stringify({ type: "", data: { id: SUB_ID } })],
    ["type이 너무 김", JSON.stringify({ type: "x".repeat(101), data: { id: SUB_ID } })],
  ])("%s → null", (_, body) => {
    expect(parsePolarWebhookBody(body)).toBeNull();
  });
});

// ── Supabase 저장소 ──

type PgResult = { data: unknown; error: { code?: string; message: string } | null };

/** 체인 호출을 기록하고, await할 때마다 정해 둔 결과를 차례로 준다(마지막 결과는 반복) */
function fakeAdmin(results: PgResult[]) {
  const calls: Array<[string, unknown[]]> = [];
  let n = 0;
  const next = () => results[Math.min(n++, results.length - 1)];
  const builder: object = new Proxy(
    {},
    {
      get(_t, prop) {
        if (prop === "then") return (ok: (v: PgResult) => unknown, bad: (e: unknown) => unknown) => Promise.resolve(next()).then(ok, bad);
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

describe("Supabase 저장소 — 웹훅 이벤트·환불 기록 메서드", () => {
  const payload = { type: "order.paid", data_id: ORDER_ID };

  it("recordWebhookEvent: 새 행이면 new — provider·event_id·event_type·payload만 넣는다", async () => {
    const s = fakeAdmin([{ data: null, error: null }]);
    expect(await createSupabaseBillingStore(s.admin).recordWebhookEvent("polar", EVENT_ID, "order.paid", payload)).toBe("new");
    expect(s.calls).toContainEqual(["from", ["billing_webhook_events"]]);
    expect(s.calls).toContainEqual(["insert", [{ provider: "polar", event_id: EVENT_ID, event_type: "order.paid", payload }]]);
  });

  it("recordWebhookEvent: 23505 + 처리된 행이면 done(갱신하지 않는다)", async () => {
    const s = fakeAdmin([
      { data: null, error: { code: "23505", message: "duplicate key" } },
      { data: { attempts: 1, processed_at: "2026-01-30T16:00:00+00:00" }, error: null },
    ]);
    expect(await createSupabaseBillingStore(s.admin).recordWebhookEvent("polar", EVENT_ID, "order.paid", payload)).toBe("done");
    expect(s.calls.some(([m]) => m === "update")).toBe(false);
  });

  it("recordWebhookEvent: 23505 + 처리 전 행이면 attempts+1(처리 전일 때만) → retry", async () => {
    const s = fakeAdmin([
      { data: null, error: { code: "23505", message: "duplicate key" } },
      { data: { attempts: 3, processed_at: null }, error: null },
      { data: [{ event_id: EVENT_ID }], error: null },
    ]);
    expect(await createSupabaseBillingStore(s.admin).recordWebhookEvent("polar", EVENT_ID, "order.paid", payload)).toBe("retry");
    expect(s.calls).toContainEqual(["update", [{ attempts: 4 }]]);
    expect(s.calls).toContainEqual(["is", ["processed_at", null]]);
    expect(s.calls.filter(([m, a]) => m === "eq" && a[0] === "provider" && a[1] === "polar").length).toBeGreaterThanOrEqual(2);
  });

  it("recordWebhookEvent: 올리는 사이 처리됐으면(바뀐 행 없음) done, attempts는 smallint 끝에서 멈춘다", async () => {
    const s = fakeAdmin([
      { data: null, error: { code: "23505", message: "duplicate key" } },
      { data: { attempts: 32767, processed_at: null }, error: null },
      { data: [], error: null },
    ]);
    expect(await createSupabaseBillingStore(s.admin).recordWebhookEvent("polar", EVENT_ID, "order.paid", payload)).toBe("done");
    expect(s.calls).toContainEqual(["update", [{ attempts: 32767 }]]);
  });

  it("recordWebhookEvent: 그 밖 오류는 코드를 달아 던진다", async () => {
    const s = fakeAdmin([{ data: null, error: { code: "42P01", message: "relation does not exist" } }]);
    await expect(createSupabaseBillingStore(s.admin).recordWebhookEvent("polar", EVENT_ID, "order.paid", payload)).rejects.toMatchObject({ code: "42P01" });
  });

  it("finishWebhookEvent: 성공이면 processed_at, 실패면 last_error(잘라서) — 처리 전 행만", async () => {
    const ok = fakeAdmin([{ data: null, error: null }]);
    await createSupabaseBillingStore(ok.admin).finishWebhookEvent("polar", EVENT_ID, {});
    const update = ok.calls.find(([m]) => m === "update")![1][0] as Record<string, unknown>;
    expect(Object.keys(update)).toEqual(["processed_at"]);
    expect(Number.isFinite(Date.parse(update.processed_at as string))).toBe(true);
    expect(ok.calls).toContainEqual(["is", ["processed_at", null]]);

    const bad = fakeAdmin([{ data: null, error: null }]);
    await createSupabaseBillingStore(bad.admin).finishWebhookEvent("polar", EVENT_ID, { error: "y".repeat(900) });
    const patch = bad.calls.find(([m]) => m === "update")![1][0] as Record<string, unknown>;
    expect(Object.keys(patch)).toEqual(["last_error"]);
    expect((patch.last_error as string).length).toBe(500);
    expect(bad.calls).toContainEqual(["eq", ["event_id", EVENT_ID]]);
  });

  it("findRefundByExternal·getRefund는 external_refund_id·id로, updateRefundIf는 상태·Polar id 조건(null은 is)", async () => {
    const s = fakeAdmin([{ data: null, error: null }]);
    const store = createSupabaseBillingStore(s.admin);
    expect(await store.findRefundByExternal(REFUND_ID)).toBeNull();
    expect(s.calls).toContainEqual(["eq", ["external_refund_id", REFUND_ID]]);
    expect(await store.getRefund("r1")).toBeNull();
    expect(s.calls).toContainEqual(["eq", ["id", "r1"]]);

    const hit = fakeAdmin([{ data: [{ id: "r1" }], error: null }]);
    expect(await createSupabaseBillingStore(hit.admin).updateRefundIf("r1", { status: "pending", externalRefundId: null }, { status: "succeeded", external_refund_id: REFUND_ID })).toBe(true);
    expect(hit.calls).toContainEqual(["eq", ["status", "pending"]]);
    expect(hit.calls).toContainEqual(["is", ["external_refund_id", null]]);

    const miss = fakeAdmin([{ data: [], error: null }]);
    expect(await createSupabaseBillingStore(miss.admin).updateRefundIf("r1", { status: "pending", externalRefundId: REFUND_ID }, { status: "failed" })).toBe(false);
    expect(miss.calls).toContainEqual(["eq", ["external_refund_id", REFUND_ID]]);
  });
});
