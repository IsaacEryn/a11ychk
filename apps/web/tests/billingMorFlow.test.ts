import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { PolarError, type PolarOrder, type PolarSubscription } from "../src/lib/billing/polar";
import { createSupabaseBillingStore } from "../src/lib/billing/store";
import type { PaymentRow, RefundRow } from "../src/lib/billing/types";
import { markMorCheckout, morAttemptId, morAutoRefundId, recordMorOrder, syncMorSubscription } from "../src/lib/billing/flows/mor";
import {
  DAY,
  NOW,
  checkoutRow,
  createFakePolar,
  createMemoryStore,
  iso,
  makeMorDeps,
  paymentRow,
  pgTime,
  polarOrder,
  polarSubscription,
  priceRow,
  subscriptionRow,
  type FakeMorDeps,
  type MemoryRows,
  type MemorySubscription,
  type PolarScript,
} from "./billingFakes";

// 가짜 값만 쓴다 — 실제 금액·상품·사용자가 아니다
const USER = "11111111-1111-4111-8111-111111111111";
const OTHER_USER = "22222222-2222-4222-8222-222222222222";
const PRODUCT = "44444444-4444-4444-8444-444444444444";
const OTHER_PRODUCT = "45454545-4545-4545-8545-454545454545";
const CUSTOMER = "55555555-5555-4555-8555-555555555555";
const SUB_ID = "66666666-6666-4666-8666-666666666666";
const ORDER_ID = "77777777-7777-4777-8777-777777777777";
const ORDER_2 = "78787878-7878-4878-8878-787878787878";
const REFUND_ID = "88888888-8888-4888-8888-888888888888";
/** morAutoRefundId("00000000-0000-4000-8000-000000000000") — 유도 방식이 바뀌지 않았음을 고정한다 */
const PINNED_REFUND_ID = "e8b68f92-f280-5d6d-b1f9-9207ddfce1cc";

/** Polar 시각(마이크로초) — 같은 밀리초 안에서 앞뒤가 갈리는 경우도 시험한다 */
const T0 = "2026-01-20T16:00:05.123456Z";
const T_EARLIER_SAME_MS = "2026-01-20T16:00:05.123400Z";
const T1 = "2026-01-25T16:00:00.000001Z";
const PERIOD_START = "2026-01-20T16:00:00.000000Z";
const PERIOD_END = "2026-02-20T16:00:00.000000Z";

const PRICE = priceRow({ id: "99999999-9999-4999-8999-999999999999", provider: "mor", currency: "USD", external_price_id: PRODUCT, livemode: false });

function world(seed: Partial<MemoryRows> = {}, script: Partial<PolarScript> = {}) {
  const store = createMemoryStore({ prices: [PRICE], profiles: [USER], ...seed }, { now: () => NOW });
  const deps = makeMorDeps({ store, polar: createFakePolar(script) });
  return { deps, store, rows: store.rows };
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

/** 이미 있는 MoR 구독 행 */
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

const logs = (deps: FakeMorDeps) => deps.log.mock.calls.map((c) => c[0]);
const reviews = (deps: FakeMorDeps) => logs(deps).filter((m) => m.startsWith("billing needs review:"));
const morSub = (rows: MemoryRows) => rows.subscriptions.find((s) => s.external_id === SUB_ID);

/** 기록에 이메일·토큰 모양이 없다 — id만 */
function expectIdsOnly(deps: FakeMorDeps) {
  for (const m of logs(deps)) {
    expect(m).not.toMatch(/@/);
    expect(m).not.toMatch(/polar_oat|whsec_/);
  }
}

describe("syncMorSubscription — 상태 매핑", () => {
  it("active 새 구독 — 가격 행의 플랜으로 MoR 행을 만든다(금액·주기·기간·외부 열은 Polar 값)", async () => {
    const { deps, rows } = world();
    const result = await syncMorSubscription(deps, sub(), false);
    const row = morSub(rows)!;
    expect(result).toEqual({ kind: "applied", subscriptionId: row.id, status: "active" });
    expect(row).toMatchObject({
      user_id: USER,
      provider: "mor",
      mor_provider: "polar",
      livemode: false,
      status: "active",
      plan_code: "pro",
      price_id: PRICE.id,
      amount: 1234,
      currency: "USD",
      interval: "month",
      current_period_start: pgTime(PERIOD_START),
      current_period_end: pgTime(PERIOD_END),
      billing_anchor_day: null,
      cancel_at_period_end: false,
      canceled_at: null,
      grace_until: null,
      ended_reason: null,
      ended_at: null,
      external_id: SUB_ID,
      external_customer_id: CUSTOMER,
      // 마이크로초까지 지킨다
      external_updated_at: "2026-01-20T16:00:05.123456+00:00",
    });
    expect(reviews(deps)).toEqual([]);
    expect(deps.polar.calls.updateSubscription).toEqual([]);
  });

  it("trialing도 active로", async () => {
    const { deps, rows } = world();
    expect(await syncMorSubscription(deps, sub({ status: "trialing" }), false)).toMatchObject({ kind: "applied", status: "active" });
    expect(morSub(rows)?.status).toBe("active");
  });

  it("해지 예약(cancel_at_period_end)과 해지 시각은 그대로 옮긴다", async () => {
    const { deps, rows } = world({ subscriptions: [morRow()] });
    await syncMorSubscription(deps, sub({ modified_at: T1, cancel_at_period_end: true, canceled_at: "2026-01-25T15:00:00Z" }), false);
    expect(morSub(rows)).toMatchObject({ status: "active", cancel_at_period_end: true, canceled_at: pgTime("2026-01-25T15:00:00Z") });
    // 해지 취소(uncanceled)
    await syncMorSubscription(deps, sub({ modified_at: "2026-01-26T00:00:00Z", cancel_at_period_end: false, canceled_at: null }), false);
    expect(morSub(rows)).toMatchObject({ status: "active", cancel_at_period_end: false, canceled_at: null });
  });

  it("연간 구독은 interval year, 금액은 sub.amount(cent)", async () => {
    const { deps, rows } = world();
    await syncMorSubscription(deps, sub({ recurring_interval: "year", amount: 4321, current_period_end: "2027-01-20T16:00:00.000000Z" }), false);
    expect(morSub(rows)).toMatchObject({ interval: "year", amount: 4321 });
  });

  it("past_due 새 구독 — 미납으로 만들고 유예는 지금 + 7일(기간 끝 기준이 아니다)", async () => {
    const { deps, rows } = world();
    expect(await syncMorSubscription(deps, sub({ status: "past_due" }), false)).toMatchObject({ kind: "applied", status: "past_due" });
    expect(morSub(rows)).toMatchObject({ status: "past_due", grace_until: pgTime(NOW + 7 * DAY) });
  });

  it("unpaid도 past_due — 처음 미납이 되면 지금 + 7일, 다시 active가 되면 유예를 지운다", async () => {
    const { deps, rows } = world({ subscriptions: [morRow()] });
    await syncMorSubscription(deps, sub({ status: "unpaid", modified_at: T1 }), false);
    expect(morSub(rows)).toMatchObject({ status: "past_due", grace_until: pgTime(NOW + 7 * DAY) });
    await syncMorSubscription(deps, sub({ status: "active", modified_at: "2026-01-26T00:00:00Z" }), false);
    expect(morSub(rows)).toMatchObject({ status: "active", grace_until: null });
  });

  it("미납이 이어지면 기간이 넘어가도 처음 정한 유예를 지킨다 — Polar는 결제 전에 기간을 넘긴다", async () => {
    const firstGrace = iso(NOW + 3 * DAY);
    const { deps, rows } = world({ subscriptions: [morRow({ status: "past_due", grace_until: firstGrace })] });
    const next = { current_period_start: PERIOD_END, current_period_end: "2026-03-20T16:00:00.000000Z" };
    expect(await syncMorSubscription(deps, sub({ status: "past_due", modified_at: T1, ...next }), false)).toMatchObject({ kind: "applied", status: "past_due" });
    expect(morSub(rows)).toMatchObject({ status: "past_due", grace_until: pgTime(firstGrace), current_period_start: pgTime(PERIOD_END) });
  });

  it("미납 행에 유예가 비어 있으면 지금 + 7일로 채운다", async () => {
    const { deps, rows } = world({ subscriptions: [morRow({ status: "past_due", grace_until: null })] });
    await syncMorSubscription(deps, sub({ status: "past_due", modified_at: T1 }), false);
    expect(morSub(rows)?.grace_until).toBe(pgTime(NOW + 7 * DAY));
  });

  it("일시정지(ended·admin)에서 미납으로 돌아오면 새 유예", async () => {
    const paused = morRow({ status: "ended", ended_reason: "admin", ended_at: iso(NOW - DAY), grace_until: iso(NOW - 20 * DAY) });
    const { deps, rows } = world({ subscriptions: [paused] });
    expect(await syncMorSubscription(deps, sub({ status: "past_due", modified_at: T1 }), false)).toMatchObject({ kind: "applied", status: "past_due" });
    expect(morSub(rows)).toMatchObject({ status: "past_due", grace_until: pgTime(NOW + 7 * DAY), ended_reason: null });
  });

  it("canceled — active였으면 ended(user_canceled), ended_at은 Polar 값", async () => {
    const { deps, rows } = world({ subscriptions: [morRow()] });
    const r = await syncMorSubscription(deps, sub({ status: "canceled", modified_at: T1, ended_at: "2026-01-25T16:00:00Z", canceled_at: "2026-01-25T15:00:00Z" }), false);
    expect(r).toMatchObject({ kind: "applied", status: "ended" });
    expect(morSub(rows)).toMatchObject({
      status: "ended",
      ended_reason: "user_canceled",
      ended_at: pgTime("2026-01-25T16:00:00Z"),
      canceled_at: pgTime("2026-01-25T15:00:00Z"),
    });
  });

  it("canceled — Polar ended_at이 없으면 지금", async () => {
    const { deps, rows } = world({ subscriptions: [morRow()] });
    await syncMorSubscription(deps, sub({ status: "canceled", modified_at: T1, ended_at: null }), false);
    expect(morSub(rows)).toMatchObject({ status: "ended", ended_at: pgTime(NOW) });
  });

  it("canceled — 직전이 미납이었으면 payment_failed", async () => {
    const { deps, rows } = world({ subscriptions: [morRow({ status: "past_due", grace_until: iso(NOW + 7 * DAY) })] });
    await syncMorSubscription(deps, sub({ status: "canceled", modified_at: T1 }), false);
    expect(morSub(rows)).toMatchObject({ status: "ended", ended_reason: "payment_failed" });
  });

  it("canceled — 이미 끝난 행(우리가 환불 해지)은 사유를 바꾸지 않는다", async () => {
    const ended = morRow({ status: "ended", ended_reason: "refunded", ended_at: iso(NOW - DAY) });
    const { deps, rows } = world({ subscriptions: [ended] });
    expect(await syncMorSubscription(deps, sub({ status: "canceled", modified_at: T1 }), false)).toMatchObject({ kind: "applied", status: "ended" });
    expect(morSub(rows)).toMatchObject({ status: "ended", ended_reason: "refunded", ended_at: pgTime(NOW - DAY), external_updated_at: pgTime(T1) });
  });

  it.each(["incomplete", "incomplete_expired"])("%s — 행을 만들지 않는다", async (status) => {
    const { deps, rows } = world();
    expect(await syncMorSubscription(deps, sub({ status }), false)).toEqual({ kind: "skipped" });
    expect(rows.subscriptions).toEqual([]);
    expect(logs(deps)).toEqual([]);
  });

  it("incomplete — 이미 행이 있으면 그대로 두고 로그 한 줄(needs review 아님)", async () => {
    const before = morRow();
    const { deps, rows } = world({ subscriptions: [before] });
    expect(await syncMorSubscription(deps, sub({ status: "incomplete", modified_at: T1 }), false)).toEqual({ kind: "skipped" });
    expect(morSub(rows)).toMatchObject({ status: "active", external_updated_at: pgTime(T0) });
    expect(logs(deps)).toHaveLength(1);
    expect(logs(deps)[0]).toContain(SUB_ID);
    expect(reviews(deps)).toEqual([]);
  });

  it("paused — 진행 중 행을 ended(admin)로 끝내고 needs review 한 줄, 재전송은 조용히", async () => {
    const { deps, rows } = world({ subscriptions: [morRow()] });
    const paused = sub({ status: "paused", modified_at: T1 });
    expect(await syncMorSubscription(deps, paused, false)).toMatchObject({ kind: "applied", status: "ended" });
    expect(morSub(rows)).toMatchObject({ status: "ended", ended_reason: "admin" });
    expect(reviews(deps)).toHaveLength(1);
    expect(reviews(deps)[0]).toContain(SUB_ID);
    await syncMorSubscription(deps, paused, false);
    expect(reviews(deps)).toHaveLength(1);
  });

  it("paused — 행이 없으면 만들지 않고 needs review", async () => {
    const { deps, rows } = world();
    expect(await syncMorSubscription(deps, sub({ status: "paused" }), false)).toEqual({ kind: "review" });
    expect(rows.subscriptions).toEqual([]);
    expect(reviews(deps)).toHaveLength(1);
  });

  it("paused 뒤 다시 active — 다른 진행 중 구독이 없으면 같은 행을 되살린다", async () => {
    const paused = morRow({ status: "ended", ended_reason: "admin", ended_at: iso(NOW - DAY) });
    const { deps, rows } = world({ subscriptions: [paused] });
    const r = await syncMorSubscription(deps, sub({ status: "active", modified_at: T1 }), false);
    expect(r).toEqual({ kind: "applied", subscriptionId: paused.id, status: "active" });
    expect(rows.subscriptions).toHaveLength(1);
    expect(morSub(rows)).toMatchObject({ status: "active", ended_reason: null, ended_at: null });
    expect(deps.polar.calls.updateSubscription).toEqual([]);
  });

  it("paused 뒤 다시 active인데 다른 진행 중 구독이 있으면 — revoke + 그 주문 환불, 행은 refunded로", async () => {
    const paused = morRow({ status: "ended", ended_reason: "admin", ended_at: iso(NOW - DAY) });
    const toss = subscriptionRow({ user_id: USER });
    const resumed = sub({ status: "active", modified_at: T1 });
    // 일시정지가 끝난(ended_at) 뒤에 만든 주문이어야 환불 대상이다
    const resumeOrder = order({ billing_reason: "subscription_cycle", created_at: "2026-01-30T15:00:00.000000Z" });
    const { deps, rows } = world(
      { subscriptions: [paused, toss] },
      {
        updateSubscription: [{ ...resumed, status: "canceled", modified_at: "2026-01-25T16:00:01Z" }],
        getOrder: [resumeOrder],
        createRefund: [{ id: REFUND_ID, status: "succeeded", amount: 1234, order_id: ORDER_ID }],
      },
    );
    const r = await syncMorSubscription(deps, resumed, false, { orderId: ORDER_ID });
    expect(r).toEqual({ kind: "ungranted", refund: "refunded" });
    expect(deps.polar.calls.updateSubscription).toEqual([[SUB_ID, { revoke: true }]]);
    expect(morSub(rows)).toMatchObject({ status: "ended", ended_reason: "refunded" });
    expect(rows.subscriptions.find((s) => s.id === toss.id)?.status).toBe("active");
    expect(rows.refunds).toHaveLength(1);
    expect(reviews(deps)).toEqual([]);
  });

  it("다른 이유로 끝난 행인데 Polar가 active라고 하면 되살리지 않고 needs review", async () => {
    const { deps, rows } = world({ subscriptions: [morRow({ status: "ended", ended_reason: "user_canceled", ended_at: iso(NOW - DAY) })] });
    expect(await syncMorSubscription(deps, sub({ status: "active", modified_at: T1 }), false)).toEqual({ kind: "review" });
    expect(morSub(rows)).toMatchObject({ status: "ended", ended_reason: "user_canceled" });
    expect(reviews(deps)).toHaveLength(1);
  });
});

describe("syncMorSubscription — 모르는 값은 needs review(행을 만들거나 바꾸지 않는다)", () => {
  it("처음 보는 상태", async () => {
    const { deps, rows } = world();
    expect(await syncMorSubscription(deps, sub({ status: "frozen" }), false)).toEqual({ kind: "review" });
    expect(rows.subscriptions).toEqual([]);
    expect(reviews(deps)).toEqual([expect.stringContaining(SUB_ID)]);
    expect(deps.polar.calls.updateSubscription).toEqual([]);
  });

  it("처음 보는 상태 — 기존 행은 그대로", async () => {
    const before = morRow();
    const { deps, rows } = world({ subscriptions: [before] });
    expect(await syncMorSubscription(deps, sub({ status: "frozen", modified_at: T1 }), false)).toEqual({ kind: "review" });
    expect(morSub(rows)).toMatchObject({ status: "active", external_updated_at: pgTime(T0) });
  });

  it.each<[string, Partial<PolarSubscription>]>([
    ["주기 day", { recurring_interval: "day" }],
    ["주기 week", { recurring_interval: "week" }],
    ["처음 보는 주기", { recurring_interval: "fortnight" }],
    ["주기 횟수 2", { recurring_interval_count: 2 }],
    ["통화 eur", { currency: "eur" }],
  ])("%s", async (_, over) => {
    const before = morRow();
    const { deps, rows } = world({ subscriptions: [before] });
    expect(await syncMorSubscription(deps, sub({ ...over, modified_at: T1 }), false)).toEqual({ kind: "review" });
    expect(morSub(rows)).toMatchObject({ status: "active", interval: "month", external_updated_at: pgTime(T0) });
    expect(reviews(deps)).toHaveLength(1);
    // 새 구독이면 만들지 않는다
    const fresh = world();
    expect(await syncMorSubscription(fresh.deps, sub(over), false)).toEqual({ kind: "review" });
    expect(fresh.rows.subscriptions).toEqual([]);
  });

  it("active인데 기간 끝이 없으면 needs review", async () => {
    const { deps, rows } = world();
    expect(await syncMorSubscription(deps, sub({ current_period_end: null }), false)).toEqual({ kind: "review" });
    expect(rows.subscriptions).toEqual([]);
  });
});

describe("syncMorSubscription — 순서·재전송", () => {
  it("저장된 것보다 오래된 modified_at은 무시하고 stale", async () => {
    const row = morRow({ external_updated_at: T1 });
    const { deps, rows } = world({ subscriptions: [row] });
    const r = await syncMorSubscription(deps, sub({ status: "canceled", modified_at: T0 }), false);
    expect(r).toEqual({ kind: "stale", subscriptionId: row.id });
    expect(morSub(rows)).toMatchObject({ status: "active", external_updated_at: pgTime(T1) });
  });

  it("같은 밀리초 안에서도 마이크로초로 앞뒤를 가른다", async () => {
    const { deps, rows } = world({ subscriptions: [morRow({ external_updated_at: T0 })] });
    expect(await syncMorSubscription(deps, sub({ status: "canceled", modified_at: T_EARLIER_SAME_MS }), false)).toMatchObject({ kind: "stale" });
    expect(morSub(rows)?.status).toBe("active");
  });

  it("같은 modified_at(재전송)은 같은 결과 — 다시 적어도 행이 같다", async () => {
    const { deps, rows } = world();
    const first = await syncMorSubscription(deps, sub(), false);
    const snapshot = structuredClone(morSub(rows));
    const again = await syncMorSubscription(deps, sub(), false);
    expect(again).toEqual(first);
    expect(rows.subscriptions).toHaveLength(1);
    expect(morSub(rows)).toEqual(snapshot);
  });

  it("modified_at이 없으면 created_at으로 비교한다", async () => {
    const { deps, rows } = world({ subscriptions: [morRow({ external_updated_at: T1 })] });
    expect(await syncMorSubscription(deps, sub({ modified_at: null, created_at: T0, status: "canceled" }), false)).toMatchObject({ kind: "stale" });
    const fresh = world();
    await syncMorSubscription(fresh.deps, sub({ modified_at: null, created_at: T0 }), false);
    expect(morSub(fresh.rows)?.external_updated_at).toBe(pgTime(T0));
    expect(rows.subscriptions).toHaveLength(1);
  });

  it("뒤바뀐 순서 — canceled(T1)를 먼저, active(T0)를 나중에 받아도 ended로 남는다", async () => {
    const { deps, rows } = world({ subscriptions: [morRow({ external_updated_at: "2026-01-20T16:00:00Z" })] });
    await syncMorSubscription(deps, sub({ status: "canceled", modified_at: T1 }), false);
    expect(await syncMorSubscription(deps, sub({ status: "active", modified_at: T0 }), false)).toMatchObject({ kind: "stale" });
    expect(morSub(rows)).toMatchObject({ status: "ended", ended_reason: "user_canceled" });
  });

  it("읽은 뒤 다른 동기화가 더 새 값을 쓰면 조건부 갱신이 막고 다시 읽어 stale", async () => {
    const row = morRow();
    const { deps, rows, store } = world({ subscriptions: [row] });
    const real = store.updateMorSubscriptionIf.bind(store);
    store.updateMorSubscriptionIf = async (id, expected, patch) => {
      // 그 사이 더 새 이벤트가 먼저 적었다
      Object.assign(rows.subscriptions[0], { status: "ended", ended_reason: "user_canceled", external_updated_at: "2026-01-28T00:00:00+00:00" });
      store.updateMorSubscriptionIf = real;
      return real(id, expected, patch);
    };
    expect(await syncMorSubscription(deps, sub({ status: "past_due", modified_at: T1 }), false)).toEqual({ kind: "stale", subscriptionId: row.id });
    expect(morSub(rows)).toMatchObject({ status: "ended" });
  });

  it("같은 구독을 동시에 처음 만들면(유니크 충돌) 다시 읽어 갱신으로 — 해지·환불하지 않는다", async () => {
    const row = morRow({ external_updated_at: "2026-01-20T16:00:00Z" });
    const { deps, rows, store } = world({ subscriptions: [row] });
    const real = store.getSubscriptionByExternal.bind(store);
    let first = true;
    store.getSubscriptionByExternal = async (...args) => {
      // 첫 조회 때는 아직 다른 요청이 넣기 전이었다
      if (first) {
        first = false;
        return null;
      }
      return real(...args);
    };
    expect(await syncMorSubscription(deps, sub({ modified_at: T0 }), false)).toEqual({ kind: "applied", subscriptionId: row.id, status: "active" });
    expect(rows.subscriptions).toHaveLength(1);
    expect(deps.polar.calls.updateSubscription).toEqual([]);
    expect(reviews(deps)).toEqual([]);
  });
});

describe("syncMorSubscription — 사용자 확인", () => {
  it("customer.external_id가 없으면 metadata.user_id", async () => {
    const { deps, rows } = world();
    await syncMorSubscription(deps, sub({ customer: { id: CUSTOMER, external_id: null } }), false);
    expect(morSub(rows)?.user_id).toBe(USER);
  });

  it("대문자 UUID도 같은 사용자로", async () => {
    const { deps, rows } = world();
    await syncMorSubscription(deps, sub({ customer: { id: CUSTOMER, external_id: USER.toUpperCase() }, metadata: {} }), false);
    expect(morSub(rows)?.user_id).toBe(USER);
  });

  it.each<[string, Partial<PolarSubscription>]>([
    ["둘 다 없음", { customer: { id: CUSTOMER, external_id: null }, metadata: {} }],
    ["UUID가 아님", { customer: { id: CUSTOMER, external_id: "user-1" }, metadata: {} }],
    ["external_id와 metadata.user_id가 다름", { metadata: { user_id: OTHER_USER } }],
    ["metadata만 있는데 UUID가 아님", { customer: { id: CUSTOMER, external_id: null }, metadata: { user_id: 42 } }],
  ])("%s → needs review, 아무것도 만들지 않고 Polar도 부르지 않는다", async (_, over) => {
    const { deps, rows } = world();
    expect(await syncMorSubscription(deps, sub(over), false)).toEqual({ kind: "review" });
    expect(rows.subscriptions).toEqual([]);
    expect(reviews(deps)).toEqual([expect.stringContaining(SUB_ID)]);
    expect(deps.polar.calls.updateSubscription).toEqual([]);
  });

  it("기존 행의 사용자와 다르면 needs review", async () => {
    const { deps, rows } = world({ subscriptions: [morRow({ user_id: OTHER_USER })], profiles: [USER, OTHER_USER] });
    expect(await syncMorSubscription(deps, sub({ modified_at: T1 }), false)).toEqual({ kind: "review" });
    expect(morSub(rows)?.user_id).toBe(OTHER_USER);
  });

  it("사용자가 없으면(탈퇴) — revoke + 첫 주문 환불, 행은 만들지 않는다", async () => {
    const created = sub();
    const first = order({ customer: { external_id: USER } });
    const { deps, rows } = world(
      { profiles: [] },
      {
        updateSubscription: [{ ...created, status: "canceled" }],
        getOrder: [first],
        createRefund: [{ id: REFUND_ID, status: "pending", amount: 1234, order_id: ORDER_ID }],
      },
    );
    const r = await syncMorSubscription(deps, created, false, { orderId: ORDER_ID });
    expect(r).toEqual({ kind: "ungranted", refund: "refunded" });
    expect(rows.subscriptions).toEqual([]);
    expect(deps.polar.calls.updateSubscription).toEqual([[SUB_ID, { revoke: true }]]);
    // 결제 행은 사용자 없이(FK) 남는다
    expect(rows.payments).toHaveLength(1);
    expect(rows.payments[0]).toMatchObject({ user_id: null, external_payment_id: ORDER_ID, status: "paid" });
    expect(rows.refunds).toEqual([
      expect.objectContaining({ payment_id: rows.payments[0].id, amount: 1234, status: "pending", external_refund_id: REFUND_ID, requested_by: null }),
    ]);
    expect(logs(deps)).toEqual([expect.stringMatching(new RegExp(`^billing auto-canceled mor subscription ${SUB_ID}`))]);
    expectIdsOnly(deps);
  });
});

describe("syncMorSubscription — 기존 행의 사용자가 탈퇴했는데 Polar가 계속 청구", () => {
  it("revoke + 행 ended(refunded) + 그 주문 환불", async () => {
    const orphan = morRow({ user_id: null });
    const cycled = sub({ modified_at: T1 });
    const { deps, rows } = world(
      { subscriptions: [orphan], profiles: [] },
      {
        updateSubscription: [{ ...cycled, status: "canceled", modified_at: "2026-01-25T16:00:09Z", ended_at: "2026-01-25T16:00:09Z" }],
        getOrder: [order({ billing_reason: "subscription_cycle" })],
        createRefund: [{ id: REFUND_ID, status: "succeeded", amount: 1234, order_id: ORDER_ID }],
      },
    );
    expect(await syncMorSubscription(deps, cycled, false, { orderId: ORDER_ID })).toEqual({ kind: "ungranted", refund: "refunded" });
    expect(morSub(rows)).toMatchObject({
      status: "ended",
      ended_reason: "refunded",
      ended_at: pgTime("2026-01-25T16:00:09Z"),
      external_updated_at: pgTime("2026-01-25T16:00:09Z"),
    });
    expect(rows.payments[0]).toMatchObject({ user_id: null, subscription_id: orphan.id, kind: "renewal" });
    expect(rows.refunds).toHaveLength(1);
    expect(reviews(deps)).toEqual([]);
  });

  it("주문 단서가 없으면 이미 기간을 받은 첫 결제를 찾지 않고 needs review", async () => {
    const attempt = checkoutRow({ user_id: USER, price_id: PRICE.id, provider: "mor" });
    const first = paymentRow({ user_id: null, provider: "mor", currency: "USD", checkout_id: attempt.id, external_payment_id: ORDER_2, order_id: `mor_${ORDER_2}`, status: "paid" });
    const { deps, rows } = world(
      { subscriptions: [morRow({ user_id: null })], profiles: [], checkouts: [attempt], payments: [first] },
      { updateSubscription: [{ ...sub(), status: "canceled" }] },
    );
    const r = await syncMorSubscription(deps, sub({ modified_at: T1, metadata: { user_id: USER, checkout_id: attempt.id } }), false);
    expect(r).toEqual({ kind: "ungranted", refund: "review" });
    expect(deps.polar.calls.getOrder).toEqual([]);
    expect(rows.refunds).toEqual([]);
    expect(morSub(rows)).toMatchObject({ status: "ended", ended_reason: "refunded" });
    expect(reviews(deps)).toEqual([expect.stringContaining(SUB_ID)]);
  });

  it("Polar도 해지했으면(canceled) 행을 끝내기만 한다 — 환불하지 않는다", async () => {
    const { deps, rows } = world({ subscriptions: [morRow({ user_id: null })], profiles: [] });
    expect(await syncMorSubscription(deps, sub({ status: "canceled", modified_at: T1 }), false, { orderId: ORDER_ID })).toMatchObject({
      kind: "applied",
      status: "ended",
    });
    expect(morSub(rows)).toMatchObject({ status: "ended", ended_reason: "user_canceled" });
    expect(deps.polar.calls.getOrder).toEqual([]);
  });
});

describe("syncMorSubscription — 가격 매핑", () => {
  it("가격 행이 없으면 needs review, 아무것도 만들지 않는다", async () => {
    const { deps, rows } = world();
    expect(await syncMorSubscription(deps, sub({ product_id: OTHER_PRODUCT }), false)).toEqual({ kind: "review" });
    expect(rows.subscriptions).toEqual([]);
    expect(reviews(deps)).toEqual([expect.stringContaining(OTHER_PRODUCT)]);
  });

  it("비활성 가격 행도 매핑한다(기존 구독)", async () => {
    const { deps, rows } = world({ prices: [{ ...PRICE, active: false }] });
    await syncMorSubscription(deps, sub(), false);
    expect(morSub(rows)).toMatchObject({ price_id: PRICE.id, status: "active" });
  });

  it("다른 모드의 가격 행은 쓰지 않는다", async () => {
    const { deps, rows } = world({ prices: [{ ...PRICE, livemode: true }] });
    expect(await syncMorSubscription(deps, sub(), false)).toEqual({ kind: "review" });
    expect(rows.subscriptions).toEqual([]);
  });

  it("다른 결제사(toss) 가격 행은 쓰지 않는다", async () => {
    const { deps } = world({ prices: [{ ...PRICE, provider: "toss", currency: "KRW" }] });
    expect(await syncMorSubscription(deps, sub(), false)).toEqual({ kind: "review" });
  });

  it("플랜이 바뀌면(상품 변경) 플랜·가격 id·금액을 따라간다", async () => {
    const team = priceRow({ provider: "mor", currency: "USD", plan_code: "team", external_price_id: OTHER_PRODUCT, livemode: false });
    const { deps, rows } = world({ prices: [PRICE, team], subscriptions: [morRow()] });
    await syncMorSubscription(deps, sub({ product_id: OTHER_PRODUCT, amount: 2345, modified_at: T1 }), false);
    expect(morSub(rows)).toMatchObject({ plan_code: "team", price_id: team.id, amount: 2345 });
  });
});

describe("syncMorSubscription — 돈 안전 불변식(진행 중 구독이 이미 있음)", () => {
  const live = () => subscriptionRow({ user_id: USER });

  it("insert가 진행 중 1건에 걸리면 — revoke + 주문 전액 환불 + 환불 기록, 정상 로그 한 줄", async () => {
    const created = sub();
    const attempt = checkoutRow({ user_id: USER, price_id: PRICE.id, provider: "mor" });
    const { deps, rows } = world(
      { subscriptions: [live()], checkouts: [attempt] },
      {
        updateSubscription: [{ ...created, status: "canceled" }],
        getOrder: [order()],
        createRefund: [{ id: REFUND_ID, status: "succeeded", amount: 1234, order_id: ORDER_ID }],
      },
    );
    const r = await syncMorSubscription(deps, { ...created, metadata: { user_id: USER, checkout_id: attempt.id } }, false, { orderId: ORDER_ID });
    expect(r).toEqual({ kind: "ungranted", refund: "refunded" });
    expect(deps.polar.calls.updateSubscription).toEqual([[SUB_ID, { revoke: true }]]);
    expect(deps.polar.calls.createRefund).toEqual([[{ order_id: ORDER_ID, reason: "duplicate", amount: 1234, metadata: { payment_id: rows.payments[0].id } }]]);
    expect(morSub(rows)).toBeUndefined();
    expect(rows.refunds).toEqual([expect.objectContaining({ amount: 1234, status: "succeeded", external_refund_id: REFUND_ID })]);
    // 우리 결제 시도는 실패(중복 환불)로 닫는다
    expect(rows.checkouts[0]).toMatchObject({ status: "failed", failure_code: "duplicateRefunded" });
    expect(reviews(deps)).toEqual([]);
    expect(logs(deps)).toEqual([expect.stringMatching(new RegExp(`^billing auto-canceled mor subscription ${SUB_ID}: .*order ${ORDER_ID}`))]);
    expectIdsOnly(deps);
  });

  it("다른 사용자의 결제 시도는 실패로 닫지 않는다", async () => {
    const created = sub();
    const foreign = checkoutRow({ user_id: OTHER_USER, price_id: PRICE.id, provider: "mor" });
    const { deps, rows } = world(
      { subscriptions: [live()], checkouts: [foreign], profiles: [USER, OTHER_USER] },
      {
        updateSubscription: [{ ...created, status: "canceled" }],
        getOrder: [order()],
        createRefund: [{ id: REFUND_ID, status: "succeeded", amount: 1234, order_id: ORDER_ID }],
      },
    );
    await syncMorSubscription(deps, { ...created, metadata: { user_id: USER, checkout_id: foreign.id } }, false, { orderId: ORDER_ID });
    expect(rows.checkouts[0].status).toBe("open");
  });

  it("주문 단서가 없으면 우리 결제 시도에 묶인 첫 결제 행에서 찾는다", async () => {
    const created = sub();
    const attempt = checkoutRow({ user_id: USER, price_id: PRICE.id, provider: "mor" });
    const recorded = paymentRow({
      user_id: USER,
      provider: "mor",
      currency: "USD",
      checkout_id: attempt.id,
      order_id: `mor_${ORDER_ID}`,
      external_payment_id: ORDER_ID,
      status: "paid",
      period_start: null,
      period_end: null,
    });
    const { deps, rows } = world(
      { subscriptions: [live()], checkouts: [attempt], payments: [recorded] },
      {
        updateSubscription: [{ ...created, status: "canceled" }],
        getOrder: [order()],
        createRefund: [{ id: REFUND_ID, status: "succeeded", amount: 1234, order_id: ORDER_ID }],
      },
    );
    const r = await syncMorSubscription(deps, { ...created, metadata: { user_id: USER, checkout_id: attempt.id } }, false);
    expect(r).toEqual({ kind: "ungranted", refund: "refunded" });
    expect(deps.polar.calls.getOrder).toEqual([[ORDER_ID]]);
    expect(rows.refunds).toEqual([expect.objectContaining({ payment_id: recorded.id })]);
  });

  it("주문을 찾지 못하면 revoke만 하고 needs review(구독 id)", async () => {
    const created = sub();
    const { deps } = world({ subscriptions: [live()] }, { updateSubscription: [{ ...created, status: "canceled" }] });
    expect(await syncMorSubscription(deps, created, false)).toEqual({ kind: "ungranted", refund: "review" });
    expect(deps.polar.calls.updateSubscription).toHaveLength(1);
    expect(deps.polar.calls.createRefund).toEqual([]);
    expect(reviews(deps)).toEqual([expect.stringContaining(SUB_ID)]);
    // 새 구독은 주문 이벤트가 오면 자동으로 환불된다 — 수동 환불 전에 billing_refunds를 보라고 안내한다
    expect(reviews(deps)[0]).toContain("automatically when the order event arrives");
    expect(reviews(deps)[0]).toContain("billing_refunds");
  });

  it("나중에 온 주문 이벤트(구독은 이미 해지됨) — 받은 적 없는 구독의 주문이라 환불한다", async () => {
    const revoked = sub({ status: "canceled", modified_at: T1 });
    const { deps, rows } = world(
      { subscriptions: [live()] },
      { getOrder: [order()], createRefund: [{ id: REFUND_ID, status: "succeeded", amount: 1234, order_id: ORDER_ID }] },
    );
    expect(await syncMorSubscription(deps, revoked, false, { orderId: ORDER_ID })).toEqual({ kind: "ungranted", refund: "refunded" });
    expect(deps.polar.calls.updateSubscription).toEqual([]);
    expect(rows.refunds).toHaveLength(1);
    expect(morSub(rows)).toBeUndefined();
  });

  it("해지된 구독인데 주문 단서가 없으면 아무것도 하지 않는다", async () => {
    const { deps, rows } = world();
    expect(await syncMorSubscription(deps, sub({ status: "canceled" }), false)).toEqual({ kind: "skipped" });
    expect(rows.subscriptions).toEqual([]);
    expect(logs(deps)).toEqual([]);
  });

  it("이미 해지된 구독(403 AlreadyCanceledSubscription)은 해지된 것으로 보고 환불로 넘어간다", async () => {
    const { deps, rows } = world(
      { subscriptions: [live()] },
      {
        updateSubscription: [new PolarError("AlreadyCanceledSubscription", "x", 403, true)],
        getOrder: [order()],
        createRefund: [{ id: REFUND_ID, status: "succeeded", amount: 1234, order_id: ORDER_ID }],
      },
    );
    expect(await syncMorSubscription(deps, sub(), false, { orderId: ORDER_ID })).toEqual({ kind: "ungranted", refund: "refunded" });
    expect(rows.refunds).toHaveLength(1);
  });

  it("revoke 결과 불명 → 한 번 다시 읽어 canceled면 환불로 넘어간다", async () => {
    const created = sub();
    const { deps } = world(
      { subscriptions: [live()] },
      {
        updateSubscription: [new PolarError("NETWORK", "x", 0, true)],
        getSubscription: [{ ...created, status: "canceled" }],
        getOrder: [order()],
        createRefund: [{ id: REFUND_ID, status: "succeeded", amount: 1234, order_id: ORDER_ID }],
      },
    );
    expect(await syncMorSubscription(deps, created, false, { orderId: ORDER_ID })).toEqual({ kind: "ungranted", refund: "refunded" });
    expect(deps.polar.calls.getSubscription).toEqual([[SUB_ID]]);
    expect(deps.polar.calls.updateSubscription).toHaveLength(1);
  });

  it.each<[string, PolarScript["getSubscription"]]>([
    ["다시 읽어도 active", [sub()]],
    ["다시 읽기도 실패", [new PolarError("HTTP_503", "x", 503)]],
  ])("revoke 결과 불명 → %s면 needs review 한 줄로 멈춘다(반복하지 않고 환불하지 않는다)", async (_, reread) => {
    const { deps } = world(
      { subscriptions: [live()] },
      { updateSubscription: [new PolarError("HTTP_502", "x", 502, true)], getSubscription: reread },
    );
    expect(await syncMorSubscription(deps, sub(), false, { orderId: ORDER_ID })).toEqual({ kind: "review" });
    expect(deps.polar.calls.updateSubscription).toHaveLength(1);
    expect(deps.polar.calls.getSubscription).toHaveLength(1);
    expect(deps.polar.calls.createRefund).toEqual([]);
    expect(reviews(deps)).toEqual([expect.stringContaining(SUB_ID)]);
  });

  it("revoke가 확정 실패하면 needs review, 환불하지 않는다", async () => {
    const { deps } = world({ subscriptions: [live()] }, { updateSubscription: [new PolarError("HTTP_422", "x", 422, true)] });
    expect(await syncMorSubscription(deps, sub(), false, { orderId: ORDER_ID })).toEqual({ kind: "review" });
    expect(deps.polar.calls.getSubscription).toEqual([]);
    expect(deps.polar.calls.createRefund).toEqual([]);
    expect(reviews(deps)).toHaveLength(1);
  });
});

describe("환불 — 같은 주문을 두 번 환불하지 않는다", () => {
  const live = () => subscriptionRow({ user_id: USER });
  const recorded = (over: Partial<PaymentRow> = {}) =>
    paymentRow({ user_id: USER, provider: "mor", currency: "USD", order_id: `mor_${ORDER_ID}`, external_payment_id: ORDER_ID, status: "paid", period_start: null, period_end: null, ...over });
  const refundRow = (paymentId: string, status: RefundRow["status"], id = morAutoRefundId(paymentId)): RefundRow => ({
    id,
    payment_id: paymentId,
    amount: 1234,
    reason: "auto_ungranted",
    external_refund_id: null,
    status,
    requested_by: null,
  });

  it.each(["pending", "succeeded"] as const)("이미 %s 환불 기록이 있으면 Polar에 다시 요청하지 않는다", async (status) => {
    const pay = recorded();
    const revoked = sub({ status: "canceled", modified_at: T1 });
    const { deps, rows } = world({ subscriptions: [live()], payments: [pay], refunds: [refundRow(pay.id, status)] }, { getOrder: [order()] });
    expect(await syncMorSubscription(deps, revoked, false, { orderId: ORDER_ID })).toEqual({ kind: "ungranted", refund: "refunded" });
    expect(deps.polar.calls.createRefund).toEqual([]);
    expect(rows.refunds).toHaveLength(1);
  });

  it("자동 환불은 결제당 한 번 — 앞선 자동 환불이 failed여도 다시 요청하지 않는다(그때 needs review를 남겼다)", async () => {
    const pay = recorded();
    const { deps, rows } = world({ payments: [pay], refunds: [refundRow(pay.id, "failed")] }, { getOrder: [order()] });
    expect(await syncMorSubscription(deps, sub({ status: "canceled" }), false, { orderId: ORDER_ID })).toEqual({ kind: "ungranted", refund: "refunded" });
    expect(deps.polar.calls.createRefund).toEqual([]);
    expect(rows.refunds).toHaveLength(1);
  });

  it("다른 id의 환불 기록(관리자 부분 환불)은 자동 환불을 막지 않는다", async () => {
    const pay = recorded();
    const manual = refundRow(pay.id, "succeeded", "abababab-abab-4bab-8bab-abababababab");
    const { deps, rows } = world(
      { payments: [pay], refunds: [manual] },
      { getOrder: [order()], createRefund: [{ id: REFUND_ID, status: "succeeded", amount: 1234, order_id: ORDER_ID }] },
    );
    expect(await syncMorSubscription(deps, sub({ status: "canceled" }), false, { orderId: ORDER_ID })).toEqual({ kind: "ungranted", refund: "refunded" });
    expect(deps.polar.calls.createRefund).toHaveLength(1);
    expect(rows.refunds.map((r) => r.id)).toEqual([manual.id, morAutoRefundId(pay.id)]);
  });

  it("동시에 두 번 환불하려 해도(확인과 기록 사이에 끼어듦) Polar 환불은 한 번 — 결정적 id가 선점한다", async () => {
    const { deps, rows, store } = world(
      {},
      {
        getOrder: [order(), order()],
        createRefund: [{ id: REFUND_ID, status: "succeeded", amount: 1234, order_id: ORDER_ID }],
      },
    );
    // 두 요청이 모두 "기록 없음"을 본 뒤에야 기록하게 한다
    const realCheck = store.hasRefundFor.bind(store);
    let arrived = 0;
    let release!: () => void;
    const bothChecked = new Promise<void>((r) => (release = r));
    store.hasRefundFor = async (...args) => {
      const seen = await realCheck(...args);
      arrived += 1;
      if (arrived === 2) release();
      await bothChecked;
      return seen;
    };
    const revoked = sub({ status: "canceled" });
    const results = await Promise.all([
      syncMorSubscription(deps, revoked, false, { orderId: ORDER_ID }),
      syncMorSubscription(deps, revoked, false, { orderId: ORDER_ID }),
    ]);
    expect(results).toEqual([
      { kind: "ungranted", refund: "refunded" },
      { kind: "ungranted", refund: "refunded" },
    ]);
    expect(deps.polar.calls.createRefund).toHaveLength(1);
    expect(rows.refunds).toHaveLength(1);
    expect(rows.refunds[0].id).toBe(morAutoRefundId(rows.payments[0].id));
    expect(reviews(deps)).toEqual([]);
  });

  it("morAutoRefundId — 결제 id에서 정해지는 v5 모양 UUID(바뀌면 이중 환불 방지가 깨지므로 값을 고정한다)", () => {
    const a = morAutoRefundId(ORDER_ID);
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(morAutoRefundId(ORDER_ID)).toBe(a);
    expect(morAutoRefundId(ORDER_2)).not.toBe(a);
    expect(morAutoRefundId(ORDER_ID.toUpperCase())).toBe(a);
    expect(morAutoRefundId("00000000-0000-4000-8000-000000000000")).toBe(PINNED_REFUND_ID);
  });

  it("403 RefundedAlready는 성공으로 본다", async () => {
    const { deps, rows } = world({}, { getOrder: [order()], createRefund: [new PolarError("RefundedAlready", "x", 403, true)] });
    expect(await syncMorSubscription(deps, sub({ status: "canceled" }), false, { orderId: ORDER_ID })).toEqual({ kind: "ungranted", refund: "refunded" });
    expect(rows.refunds).toEqual([expect.objectContaining({ status: "succeeded", external_refund_id: null })]);
    expect(reviews(deps)).toEqual([]);
    expect(logs(deps)).toEqual([expect.stringMatching(/^billing auto-canceled mor subscription/)]);
  });

  it("환불 결과 불명 → 주문을 한 번 다시 읽어 환불됐으면 성공", async () => {
    const { deps, rows } = world(
      {},
      { getOrder: [order(), order({ status: "refunded", refunded_amount: 1234, refundable_amount: 0 })], createRefund: [new PolarError("NETWORK", "x", 0, true)] },
    );
    expect(await syncMorSubscription(deps, sub({ status: "canceled" }), false, { orderId: ORDER_ID })).toEqual({ kind: "ungranted", refund: "refunded" });
    expect(deps.polar.calls.getOrder).toHaveLength(2);
    expect(rows.refunds).toEqual([expect.objectContaining({ status: "succeeded" })]);
  });

  it("환불 결과 불명 → 다시 읽어도 모르면 needs review, 환불 기록은 pending으로 남아 재전송에도 다시 요청하지 않는다", async () => {
    const { deps, rows } = world(
      {},
      { getOrder: [order(), order(), order()], createRefund: [new PolarError("HTTP_500", "x", 500, true)] },
    );
    const revoked = sub({ status: "canceled" });
    expect(await syncMorSubscription(deps, revoked, false, { orderId: ORDER_ID })).toEqual({ kind: "ungranted", refund: "review" });
    expect(rows.refunds).toEqual([expect.objectContaining({ status: "pending" })]);
    expect(reviews(deps)).toEqual([expect.stringContaining(ORDER_ID)]);
    // 같은 이벤트 재전송
    expect(await syncMorSubscription(deps, revoked, false, { orderId: ORDER_ID })).toEqual({ kind: "ungranted", refund: "refunded" });
    expect(deps.polar.calls.createRefund).toHaveLength(1);
    expect(rows.refunds).toHaveLength(1);
  });

  it("환불이 확정 실패하면 failed로 적고 needs review", async () => {
    const { deps, rows } = world({}, { getOrder: [order()], createRefund: [new PolarError("RefundAmountTooHigh", "x", 400, true)] });
    expect(await syncMorSubscription(deps, sub({ status: "canceled" }), false, { orderId: ORDER_ID })).toEqual({ kind: "ungranted", refund: "review" });
    expect(rows.refunds).toEqual([expect.objectContaining({ status: "failed" })]);
    expect(reviews(deps)).toHaveLength(1);
  });

  it.each(["failed", "canceled"])("Polar가 환불을 %s로 돌려주면 failed + needs review", async (status) => {
    const { deps, rows } = world({}, { getOrder: [order()], createRefund: [{ id: REFUND_ID, status, amount: 1234, order_id: ORDER_ID }] });
    expect(await syncMorSubscription(deps, sub({ status: "canceled" }), false, { orderId: ORDER_ID })).toEqual({ kind: "ungranted", refund: "review" });
    expect(rows.refunds).toEqual([expect.objectContaining({ status: "failed", external_refund_id: REFUND_ID })]);
    expect(reviews(deps)).toHaveLength(1);
  });

  it("환불 금액은 refundable_amount(세금 제외), 없으면 net − 이미 환불한 금액", async () => {
    const a = world({}, { getOrder: [order({ refundable_amount: 1000 })], createRefund: [{ id: REFUND_ID, status: "succeeded", amount: 1000, order_id: ORDER_ID }] });
    await syncMorSubscription(a.deps, sub({ status: "canceled" }), false, { orderId: ORDER_ID });
    expect(a.deps.polar.calls.createRefund[0]![0]).toMatchObject({ amount: 1000, reason: "other" });

    const b = world(
      {},
      { getOrder: [order({ refundable_amount: null, net_amount: 1234, refunded_amount: 34 })], createRefund: [{ id: REFUND_ID, status: "succeeded", amount: 1200, order_id: ORDER_ID }] },
    );
    await syncMorSubscription(b.deps, sub({ status: "canceled" }), false, { orderId: ORDER_ID });
    expect(b.deps.polar.calls.createRefund[0]![0]).toMatchObject({ amount: 1200 });
    expect(b.rows.refunds[0]).toMatchObject({ amount: 1200 });
  });

  it("환불할 금액이 남지 않았으면 요청하지 않는다", async () => {
    const { deps, rows } = world({}, { getOrder: [order({ status: "refunded", refunded_amount: 1234, refundable_amount: 0 })] });
    expect(await syncMorSubscription(deps, sub({ status: "canceled" }), false, { orderId: ORDER_ID })).toEqual({ kind: "ungranted", refund: "none" });
    expect(deps.polar.calls.createRefund).toEqual([]);
    expect(rows.refunds).toEqual([]);
  });

  it("아직 결제되지 않은 주문은 needs review", async () => {
    const { deps } = world({}, { getOrder: [order({ status: "pending", paid: false })] });
    expect(await syncMorSubscription(deps, sub({ status: "canceled" }), false, { orderId: ORDER_ID })).toEqual({ kind: "ungranted", refund: "review" });
    expect(deps.polar.calls.createRefund).toEqual([]);
    expect(reviews(deps)).toHaveLength(1);
  });

  it("무효(void) 주문은 돌려줄 것이 없다", async () => {
    const { deps } = world({}, { getOrder: [order({ status: "void", paid: false })] });
    expect(await syncMorSubscription(deps, sub({ status: "canceled" }), false, { orderId: ORDER_ID })).toEqual({ kind: "ungranted", refund: "none" });
    expect(deps.polar.calls.createRefund).toEqual([]);
    expect(reviews(deps)).toEqual([]);
  });

  it("다른 구독의 주문이면 환불하지 않고 needs review", async () => {
    const { deps } = world({}, { getOrder: [order({ subscription_id: "12121212-1212-4212-8212-121212121212" })] });
    expect(await syncMorSubscription(deps, sub({ status: "canceled" }), false, { orderId: ORDER_ID })).toEqual({ kind: "ungranted", refund: "review" });
    expect(deps.polar.calls.createRefund).toEqual([]);
    expect(reviews(deps)).toHaveLength(1);
  });

  it("주문을 읽지 못하면 needs review(환불 요청 없음)", async () => {
    const { deps } = world({}, { getOrder: [new PolarError("HTTP_503", "x", 503)] });
    expect(await syncMorSubscription(deps, sub({ status: "canceled" }), false, { orderId: ORDER_ID })).toEqual({ kind: "ungranted", refund: "review" });
    expect(deps.polar.calls.createRefund).toEqual([]);
    expect(reviews(deps)).toEqual([expect.stringContaining(ORDER_ID)]);
  });
});

describe("해지 뒤 저장소 오류 — 기록을 남기고 던진다, 다시 받으면 마저 환불한다", () => {
  const live = () => subscriptionRow({ user_id: USER });

  function setup() {
    const attempt = checkoutRow({ user_id: USER, price_id: PRICE.id, provider: "mor" });
    const created = sub({ metadata: { user_id: USER, checkout_id: attempt.id } });
    const paid = order({ metadata: { user_id: USER, checkout_id: attempt.id } });
    const w = world(
      { subscriptions: [live()], checkouts: [attempt] },
      {
        updateSubscription: [{ ...created, status: "canceled" }],
        getOrder: [paid, paid, paid],
        createRefund: [{ id: REFUND_ID, status: "succeeded", amount: 1234, order_id: ORDER_ID }],
      },
    );
    return { ...w, created, attempt };
  }

  /** 그 저장소 메서드가 한 번만 던지게 한다 */
  function failOnce(store: ReturnType<typeof world>["store"], method: "hasRefundFor" | "insertRefund" | "updateRefund" | "finishCheckout" | "insertExternalPayment") {
    const real = (store[method] as (...a: unknown[]) => Promise<unknown>).bind(store);
    (store as unknown as Record<string, unknown>)[method] = async (...args: unknown[]) => {
      (store as unknown as Record<string, unknown>)[method] = real;
      throw new Error(`billing store ${method}: timeout`);
    };
  }

  it.each(["hasRefundFor", "insertRefund", "updateRefund", "finishCheckout"] as const)(
    "%s가 실패하면 needs review 한 줄 + 다시 던지고, 단서 없는 재시도가 결제 시도의 첫 결제로 마저 환불한다(Polar 환불은 한 번)",
    async (method) => {
      const { deps, rows, store, created } = setup();
      failOnce(store, method);
      await expect(syncMorSubscription(deps, created, false, { orderId: ORDER_ID })).rejects.toThrow("timeout");
      expect(reviews(deps)).toEqual([`billing needs review: mor subscription ${SUB_ID} was revoked (user already has a live subscription) but its refund did not finish`]);
      // 기록 실패를 환불 실패로 적지 않는다 — 돈은 이미 돌아갔을 수 있다
      expect(rows.refunds.filter((r) => r.status === "failed")).toEqual([]);
      // 웹훅 재시도 — Polar 정본은 이제 canceled, 이번엔 주문 단서가 없다
      const retry = await syncMorSubscription(deps, { ...created, status: "canceled", modified_at: T1 }, false);
      expect(retry).toEqual({ kind: "ungranted", refund: "refunded" });
      expect(deps.polar.calls.createRefund).toHaveLength(1);
      expect(rows.refunds).toHaveLength(1);
      expect(deps.polar.calls.updateSubscription).toHaveLength(1);
    },
  );

  it("결제 행을 적기 전에 실패하면 재시도에 단서가 없을 때는 건너뛰고, 주문 이벤트가 오면 환불한다", async () => {
    const { deps, rows, store, created } = setup();
    failOnce(store, "insertExternalPayment");
    await expect(syncMorSubscription(deps, created, false, { orderId: ORDER_ID })).rejects.toThrow("timeout");
    expect(reviews(deps)).toHaveLength(1);
    const canceled = { ...created, status: "canceled", modified_at: T1 };
    expect(await syncMorSubscription(deps, canceled, false)).toEqual({ kind: "skipped" });
    expect(await syncMorSubscription(deps, canceled, false, { orderId: ORDER_ID })).toEqual({ kind: "ungranted", refund: "refunded" });
    expect(deps.polar.calls.createRefund).toHaveLength(1);
    expect(rows.refunds).toHaveLength(1);
  });

  it("기존 행을 끝내다 실패해도 needs review 한 줄 + 다시 던진다", async () => {
    const paused = morRow({ status: "ended", ended_reason: "admin", ended_at: iso(NOW - DAY) });
    const resumed = sub({ modified_at: T1 });
    const { deps, store } = world(
      { subscriptions: [paused, live()] },
      { updateSubscription: [{ ...resumed, status: "canceled" }] },
    );
    const real = store.updateMorSubscriptionIf.bind(store);
    let calls = 0;
    store.updateMorSubscriptionIf = async (...args) => {
      calls += 1;
      if (calls === 2) throw new Error("billing store updateMorSubscriptionIf: timeout");
      return real(...args);
    };
    await expect(syncMorSubscription(deps, resumed, false, { orderId: ORDER_ID })).rejects.toThrow("timeout");
    expect(reviews(deps)).toEqual([expect.stringContaining("but its refund did not finish")]);
  });
});

describe("기존 행의 주문 단서 확인 — 이미 기간을 받은 주문은 환불하지 않는다", () => {
  it("탈퇴 사용자의 진행 중 행 — 행의 기간 시작보다 먼저 만든 주문은 needs review, 환불 없음", async () => {
    const orphan = morRow({ user_id: null });
    const cycled = sub({ modified_at: T1 });
    const oldCycle = order({ billing_reason: "subscription_cycle", created_at: "2025-12-20T16:00:01.000000Z" });
    const { deps, rows } = world(
      { subscriptions: [orphan], profiles: [] },
      { updateSubscription: [{ ...cycled, status: "canceled" }], getOrder: [oldCycle] },
    );
    expect(await syncMorSubscription(deps, cycled, false, { orderId: ORDER_ID })).toEqual({ kind: "ungranted", refund: "review" });
    expect(deps.polar.calls.createRefund).toEqual([]);
    expect(rows.refunds).toEqual([]);
    expect(reviews(deps)).toEqual([expect.stringContaining(ORDER_ID)]);
    // 해지는 했고 행도 refunded로 끝났다
    expect(morSub(rows)).toMatchObject({ status: "ended", ended_reason: "refunded" });
  });

  it("일시정지에서 돌아온 행 — 일시정지로 끝난 시각(ended_at) 이전의 주문은 환불하지 않는다", async () => {
    const paused = morRow({ status: "ended", ended_reason: "admin", ended_at: iso(NOW - DAY) });
    const resumed = sub({ modified_at: T1 });
    const { deps, rows } = world(
      { subscriptions: [paused, subscriptionRow({ user_id: USER })] },
      {
        updateSubscription: [{ ...resumed, status: "canceled" }],
        // 일시정지 전 주기의 주문(기간 시작 이후이지만 ended_at 이전)
        getOrder: [order({ billing_reason: "subscription_cycle", created_at: "2026-01-25T16:00:00.000000Z" })],
      },
    );
    expect(await syncMorSubscription(deps, resumed, false, { orderId: ORDER_ID })).toEqual({ kind: "ungranted", refund: "review" });
    expect(deps.polar.calls.createRefund).toEqual([]);
    expect(reviews(deps)).toHaveLength(1);
  });
});

describe("해지 뒤 행 정리 — 그 사이 해지 웹훅이 먼저 끝냈어도 사유는 refunded", () => {
  it("조건부 갱신이 엇갈리면 다시 읽어 ended 행의 사유만 refunded로", async () => {
    const orphan = morRow({ user_id: null });
    const cycled = sub({ modified_at: T1 });
    const { deps, rows, store } = world(
      { subscriptions: [orphan], profiles: [] },
      {
        updateSubscription: [{ ...cycled, status: "canceled", modified_at: "2026-01-25T16:00:09Z" }],
        getOrder: [order({ billing_reason: "subscription_cycle" })],
        createRefund: [{ id: REFUND_ID, status: "succeeded", amount: 1234, order_id: ORDER_ID }],
      },
    );
    const real = store.updateMorSubscriptionIf.bind(store);
    store.updateMorSubscriptionIf = async (...args) => {
      // 해지 웹훅(revoked)이 먼저 처리돼 user_canceled로 끝냈다
      Object.assign(rows.subscriptions[0], { status: "ended", ended_reason: "user_canceled", ended_at: "2026-01-25T16:00:09+00:00", external_updated_at: "2026-01-25T16:00:10+00:00" });
      store.updateMorSubscriptionIf = real;
      return real(...args);
    };
    expect(await syncMorSubscription(deps, cycled, false, { orderId: ORDER_ID })).toEqual({ kind: "ungranted", refund: "refunded" });
    expect(morSub(rows)).toMatchObject({ status: "ended", ended_reason: "refunded", external_updated_at: "2026-01-25T16:00:10+00:00" });
  });

  it("다시 맞추지도 못하면 로그 한 줄(환불은 그대로 진행)", async () => {
    const orphan = morRow({ user_id: null });
    const cycled = sub({ modified_at: T1 });
    const { deps, rows, store } = world(
      { subscriptions: [orphan], profiles: [] },
      {
        updateSubscription: [{ ...cycled, status: "canceled" }],
        getOrder: [order({ billing_reason: "subscription_cycle" })],
        createRefund: [{ id: REFUND_ID, status: "succeeded", amount: 1234, order_id: ORDER_ID }],
      },
    );
    store.updateMorSubscriptionIf = async () => "skipped";
    expect(await syncMorSubscription(deps, cycled, false, { orderId: ORDER_ID })).toEqual({ kind: "ungranted", refund: "refunded" });
    expect(logs(deps).filter((m) => m.includes(orphan.id))).toHaveLength(1);
    expect(rows.refunds).toHaveLength(1);
  });
});

describe("끝내는 상태는 주기·통화가 낯설어도 끝낸다", () => {
  it.each<[string, Partial<PolarSubscription>, string]>([
    ["canceled + week", { status: "canceled", recurring_interval: "week" }, "user_canceled"],
    ["paused + eur", { status: "paused", currency: "eur" }, "admin"],
  ])("%s", async (_, over, reason) => {
    const { deps, rows } = world({ subscriptions: [morRow()] });
    expect(await syncMorSubscription(deps, sub({ ...over, modified_at: T1 }), false)).toMatchObject({ kind: "applied", status: "ended" });
    expect(morSub(rows)).toMatchObject({ status: "ended", ended_reason: reason });
  });
});

describe("recordMorOrder — 주문을 결제 행으로", () => {
  it("첫 구독 결제 — 금액은 total_amount, 주문번호 mor_<id>, 연결 구독의 기간·사용자", async () => {
    const row = morRow();
    const { deps, rows } = world({ subscriptions: [row] });
    const p = await recordMorOrder(deps, order(), false);
    expect(p).toMatchObject({ id: rows.payments[0].id });
    expect(rows.payments[0]).toMatchObject({
      user_id: USER,
      subscription_id: row.id,
      checkout_id: null,
      provider: "mor",
      livemode: false,
      kind: "initial",
      order_id: `mor_${ORDER_ID}`,
      external_payment_id: ORDER_ID,
      amount: 1334,
      refunded_amount: 0,
      currency: "USD",
      period_start: pgTime(PERIOD_START),
      period_end: pgTime(PERIOD_END),
      attempt: 1,
      status: "paid",
      approved_at: pgTime("2026-01-20T16:00:02Z"),
    });
    expect(logs(deps)).toEqual([]);
  });

  it.each<[string, string]>([
    ["subscription_create", "initial"],
    ["purchase", "initial"],
    ["subscription_cycle", "renewal"],
    ["subscription_update", "initial"],
    ["subscription_meter_cycle", "initial"],
    ["something_new", "initial"],
  ])("billing_reason %s → %s", async (reason, kind) => {
    const { deps, rows } = world({ subscriptions: [morRow()] });
    await recordMorOrder(deps, order({ billing_reason: reason }), false);
    expect(rows.payments[0]?.kind).toBe(kind);
  });

  it.each<[string, boolean, string]>([
    ["paid", true, "paid"],
    ["refunded", true, "refunded"],
    ["partially_refunded", true, "partially_refunded"],
    ["pending", false, "pending"],
    ["draft", false, "pending"],
    ["void", false, "failed"],
  ])("status %s → %s", async (status, paid, mapped) => {
    const { deps, rows } = world({ subscriptions: [morRow()] });
    await recordMorOrder(deps, order({ status, paid }), false);
    expect(rows.payments[0]).toMatchObject({ status: mapped, approved_at: paid ? expect.any(String) : null });
  });

  it("환불액은 세금을 더해 금액(total_amount)과 같은 기준으로 적는다", async () => {
    const { deps, rows } = world({ subscriptions: [morRow()] });
    await recordMorOrder(deps, order(), false);
    await recordMorOrder(deps, order({ status: "refunded", refunded_amount: 1234, refunded_tax_amount: 100, refundable_amount: 0 }), false);
    expect(rows.payments[0]).toMatchObject({ status: "refunded", amount: 1334, refunded_amount: 1334 });
    const fresh = world({ subscriptions: [morRow()] });
    await recordMorOrder(fresh.deps, order({ status: "partially_refunded", refunded_amount: 600, refunded_tax_amount: 50 }), false);
    expect(fresh.rows.payments[0]).toMatchObject({ refunded_amount: 650 });
  });

  it("처음 보는 주문 상태는 needs review, 쓰지 않는다", async () => {
    const { deps, rows } = world({ subscriptions: [morRow()] });
    expect(await recordMorOrder(deps, order({ status: "disputed" }), false)).toBeNull();
    expect(rows.payments).toEqual([]);
    expect(reviews(deps)).toEqual([expect.stringContaining(ORDER_ID)]);
  });

  it("USD가 아니면 needs review, 쓰지 않는다", async () => {
    const { deps, rows } = world({ subscriptions: [morRow()] });
    expect(await recordMorOrder(deps, order({ currency: "eur" }), false)).toBeNull();
    expect(rows.payments).toEqual([]);
    expect(reviews(deps)).toHaveLength(1);
  });

  it("갱신 주문인데 연결 구독(기간)이 아직 없으면 initial로 적고 로그 한 줄", async () => {
    const { deps, rows } = world();
    await recordMorOrder(deps, order({ billing_reason: "subscription_cycle" }), false);
    expect(rows.payments[0]).toMatchObject({ kind: "initial", subscription_id: null, period_start: null, period_end: null });
    expect(logs(deps)).toEqual([expect.stringContaining(ORDER_ID)]);
    expect(reviews(deps)).toEqual([]);
    // 재전송은 다시 로그를 남기지 않는다
    await recordMorOrder(deps, order({ billing_reason: "subscription_cycle" }), false);
    expect(logs(deps)).toHaveLength(1);
  });

  it("같은 기간의 갱신 칸이 이미 다른 주문으로 찼으면 initial로 적고 로그", async () => {
    const row = morRow();
    const other = paymentRow({
      user_id: USER,
      provider: "mor",
      currency: "USD",
      subscription_id: row.id,
      kind: "renewal",
      order_id: `mor_${ORDER_2}`,
      external_payment_id: ORDER_2,
      period_start: PERIOD_START,
      period_end: PERIOD_END,
      status: "paid",
    });
    const { deps, rows } = world({ subscriptions: [row], payments: [other] });
    await recordMorOrder(deps, order({ billing_reason: "subscription_cycle" }), false);
    expect(rows.payments.find((p) => p.external_payment_id === ORDER_ID)).toMatchObject({ kind: "initial", subscription_id: row.id });
    expect(logs(deps)).toEqual([expect.stringContaining(ORDER_ID)]);
  });

  it("주문이 구독보다 먼저 와도 적고, 구독이 생긴 뒤 다시 받으면 구독·기간을 채운다", async () => {
    const { deps, rows } = world();
    await recordMorOrder(deps, order(), false);
    expect(rows.payments[0]).toMatchObject({ subscription_id: null, user_id: USER, period_start: null });
    await syncMorSubscription(deps, sub(), false);
    await recordMorOrder(deps, order(), false);
    expect(rows.payments).toHaveLength(1);
    expect(rows.payments[0]).toMatchObject({ subscription_id: morSub(rows)!.id, period_start: pgTime(PERIOD_START), period_end: pgTime(PERIOD_END) });
  });

  it("재전송은 같은 행 하나", async () => {
    const { deps, rows } = world({ subscriptions: [morRow()] });
    const a = await recordMorOrder(deps, order(), false);
    const b = await recordMorOrder(deps, order(), false);
    expect(rows.payments).toHaveLength(1);
    expect(b).toEqual(a);
  });

  it("환불 상태는 되돌리지 않는다 — refunded 뒤 늦게 읽은 paid는 무시, 환불액은 줄지 않는다", async () => {
    const { deps, rows } = world({ subscriptions: [morRow()] });
    await recordMorOrder(deps, order({ status: "partially_refunded", refunded_amount: 500 }), false);
    await recordMorOrder(deps, order({ status: "refunded", refunded_amount: 1234 }), false);
    expect(rows.payments[0]).toMatchObject({ status: "refunded", refunded_amount: 1234 });
    await recordMorOrder(deps, order({ status: "paid", refunded_amount: 0 }), false);
    expect(rows.payments[0]).toMatchObject({ status: "refunded", refunded_amount: 1234 });
    // 승인 시각은 처음 적은 값을 지킨다
    expect(rows.payments[0].approved_at).toBe(pgTime("2026-01-20T16:00:01Z"));
  });

  it("pending에서 paid로는 나아간다", async () => {
    const { deps, rows } = world({ subscriptions: [morRow()] });
    await recordMorOrder(deps, order({ status: "pending", paid: false }), false);
    await recordMorOrder(deps, order({ status: "paid", paid: true, modified_at: "2026-01-20T16:01:00Z" }), false);
    expect(rows.payments[0]).toMatchObject({ status: "paid", approved_at: pgTime("2026-01-20T16:01:00Z") });
  });

  it("읽은 뒤 다른 요청이 결제 행을 바꾸면 다시 읽어 합친다", async () => {
    const { deps, rows, store } = world({ subscriptions: [morRow()] });
    await recordMorOrder(deps, order(), false);
    const real = store.updatePaymentIf.bind(store);
    store.updatePaymentIf = async (id, expected, patch) => {
      Object.assign(rows.payments[0], { status: "refunded", refunded_amount: 1234 });
      store.updatePaymentIf = real;
      return real(id, expected, patch);
    };
    await recordMorOrder(deps, order({ status: "partially_refunded", refunded_amount: 500 }), false);
    expect(rows.payments[0]).toMatchObject({ status: "refunded", refunded_amount: 1234 });
  });

  it("사용자: 연결 구독이 없으면 주문의 사용자(profiles에 있을 때만), 탈퇴했으면 null", async () => {
    const a = world();
    await recordMorOrder(a.deps, order(), false);
    expect(a.rows.payments[0].user_id).toBe(USER);
    const b = world({ profiles: [] });
    await recordMorOrder(b.deps, order(), false);
    expect(b.rows.payments[0].user_id).toBeNull();
  });

  it("주문 metadata의 우리 결제 시도가 있으면 checkout_id로 묶는다(다른 사용자·모드·결제사의 시도는 무시)", async () => {
    const mine = checkoutRow({ user_id: USER, price_id: PRICE.id, provider: "mor" });
    const toss = checkoutRow({ user_id: USER, price_id: PRICE.id, provider: "toss" });
    const a = world({ checkouts: [mine, toss] });
    await recordMorOrder(a.deps, order({ metadata: { user_id: USER, checkout_id: mine.id } }), false);
    expect(a.rows.payments[0].checkout_id).toBe(mine.id);
    const b = world({ checkouts: [mine, toss] });
    await recordMorOrder(b.deps, order({ metadata: { user_id: USER, checkout_id: toss.id } }), false);
    expect(b.rows.payments[0].checkout_id).toBeNull();
    const c = world({ checkouts: [{ ...mine, livemode: true }] });
    await recordMorOrder(c.deps, order({ metadata: { user_id: USER, checkout_id: mine.id } }), false);
    expect(c.rows.payments[0].checkout_id).toBeNull();
  });

  it("다른 모드의 구독 행에는 묶지 않는다", async () => {
    const { deps, rows } = world({ subscriptions: [morRow({ livemode: true })] });
    await recordMorOrder(deps, order(), false);
    expect(rows.payments[0]).toMatchObject({ subscription_id: null, livemode: false });
  });
});

describe("markMorCheckout — 우리 결제 시도를 닫는다", () => {
  it("동기화가 새 구독을 만들면 시도를 completed로 닫고 동의 기록을 구독에 잇는다", async () => {
    const attempt = checkoutRow({ user_id: USER, price_id: PRICE.id, provider: "mor" });
    const { deps, rows } = world({
      checkouts: [attempt],
      consents: [{ id: "c1", user_id: USER, checkout_id: attempt.id, subscription_id: null, kind: "recurring_payment" }],
    });
    await syncMorSubscription(deps, sub({ metadata: { user_id: USER, checkout_id: attempt.id } }), false);
    const id = morSub(rows)!.id;
    expect(rows.checkouts[0]).toMatchObject({ status: "completed", subscription_id: id });
    expect(rows.consents[0].subscription_id).toBe(id);
  });

  it("expired — 끝나지 않은 시도만", async () => {
    const open = checkoutRow({ user_id: USER, price_id: PRICE.id, provider: "mor" });
    const processing = checkoutRow({ user_id: USER, price_id: PRICE.id, provider: "mor", status: "processing" });
    const done = checkoutRow({ user_id: USER, price_id: PRICE.id, provider: "mor", status: "completed" });
    const { deps, rows } = world({ checkouts: [open, processing, done] });
    expect(await markMorCheckout(deps, open.id, "expired", { livemode: false })).toBe(true);
    expect(await markMorCheckout(deps, processing.id, "expired", { livemode: false })).toBe(true);
    expect(await markMorCheckout(deps, done.id, "expired", { livemode: false })).toBe(false);
    expect(rows.checkouts.map((c) => c.status)).toEqual(["expired", "expired", "completed"]);
  });

  it.each<[string, (id: string) => string, { livemode: boolean; userId?: string }, Partial<{ provider: "toss" | "mor"; livemode: boolean }>]>([
    ["UUID가 아님", () => "not-a-uuid", { livemode: false }, {}],
    ["없는 시도", () => "abababab-abab-4bab-8bab-abababababab", { livemode: false }, {}],
    ["다른 모드", (id) => id, { livemode: true }, {}],
    ["토스 시도", (id) => id, { livemode: false }, { provider: "toss" }],
    ["다른 사용자", (id) => id, { livemode: false, userId: OTHER_USER }, {}],
  ])("%s면 바꾸지 않는다", async (_, pick, opts, over) => {
    const attempt = checkoutRow({ user_id: USER, price_id: PRICE.id, provider: "mor", ...over });
    const { deps, rows } = world({ checkouts: [attempt] });
    expect(await markMorCheckout(deps, pick(attempt.id), "completed", opts)).toBe(false);
    expect(rows.checkouts[0].status).toBe("open");
  });

  it("failed는 실패 코드와 함께", async () => {
    const attempt = checkoutRow({ user_id: USER, price_id: PRICE.id, provider: "mor" });
    const { deps, rows } = world({ checkouts: [attempt] });
    expect(await markMorCheckout(deps, attempt.id, "failed", { livemode: false, failureCode: "duplicateRefunded" })).toBe(true);
    expect(rows.checkouts[0]).toMatchObject({ status: "failed", failure_code: "duplicateRefunded" });
  });

  it("morAttemptId — metadata.checkout_id가 UUID일 때만", () => {
    expect(morAttemptId({ checkout_id: SUB_ID })).toBe(SUB_ID);
    expect(morAttemptId({ checkout_id: SUB_ID.toUpperCase() })).toBe(SUB_ID);
    expect(morAttemptId({ checkout_id: "x" })).toBeNull();
    expect(morAttemptId({ checkout_id: 7 })).toBeNull();
    expect(morAttemptId({})).toBeNull();
  });
});

describe("저장소 오류는 던진다(웹훅이 다시 시도한다)", () => {
  it("구독 조회 실패", async () => {
    const { deps, store } = world();
    store.getSubscriptionByExternal = async () => {
      throw new Error("billing store getSubscriptionByExternal: timeout");
    };
    await expect(syncMorSubscription(deps, sub(), false)).rejects.toThrow("timeout");
  });
});

// ── Supabase 저장소의 MoR 메서드 ──

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

describe("Supabase 저장소 — MoR 메서드", () => {
  it("updateMorSubscriptionIf: 상태·외부 시각 조건을 걸고, 바뀐 행이 없으면 skipped", async () => {
    const hit = fakeAdmin([{ data: [{ id: "s1" }], error: null }]);
    expect(await createSupabaseBillingStore(hit.admin).updateMorSubscriptionIf("s1", { status: "active", notAfter: T0 }, { status: "ended" })).toBe("updated");
    expect(hit.calls).toContainEqual(["eq", ["status", "active"]]);
    expect(hit.calls).toContainEqual(["or", [`external_updated_at.is.null,external_updated_at.lte."${T0}"`]]);
    const miss = fakeAdmin([{ data: [], error: null }]);
    expect(await createSupabaseBillingStore(miss.admin).updateMorSubscriptionIf("s1", { status: "active", notAfter: T0 }, { status: "ended" })).toBe("skipped");
  });

  it("updateMorSubscriptionIf: 23505는 conflict, ISO가 아닌 시각은 묻기 전에 던진다", async () => {
    const dup = fakeAdmin([{ data: null, error: { code: "23505", message: "duplicate key" } }]);
    expect(await createSupabaseBillingStore(dup.admin).updateMorSubscriptionIf("s1", { status: "ended", notAfter: T0 }, { status: "active" })).toBe("conflict");
    const bad = fakeAdmin([{ data: [], error: null }]);
    await expect(
      createSupabaseBillingStore(bad.admin).updateMorSubscriptionIf("s1", { status: "active", notAfter: '2026-01-01T00:00:00Z",id.neq.x' }, {}),
    ).rejects.toThrow("notAfter");
    expect(bad.calls).toEqual([]);
  });

  it("insertMorSubscription: 23505는 conflict, 그 밖 오류는 코드를 달아 던진다", async () => {
    const dup = fakeAdmin([{ data: null, error: { code: "23505", message: "duplicate key" } }]);
    const row = { external_id: SUB_ID } as never;
    expect(await createSupabaseBillingStore(dup.admin).insertMorSubscription(row)).toBe("conflict");
    const boom = fakeAdmin([{ data: null, error: { code: "42501", message: "permission denied" } }]);
    await expect(createSupabaseBillingStore(boom.admin).insertMorSubscription(row)).rejects.toMatchObject({ code: "42501" });
  });

  it("getSubscriptionByExternal·findPriceByExternal·getPaymentByExternal은 결제사·외부 id·livemode로 거른다", async () => {
    const s = fakeAdmin([{ data: null, error: null }]);
    const store = createSupabaseBillingStore(s.admin);
    await store.getSubscriptionByExternal("mor", SUB_ID, true);
    await store.findPriceByExternal("mor", PRODUCT, true);
    await store.getPaymentByExternal("mor", ORDER_ID, true);
    expect(s.calls.filter(([m]) => m === "from").map(([, a]) => a[0])).toEqual(["subscriptions", "billing_prices", "billing_payments"]);
    expect(s.calls).toContainEqual(["eq", ["external_id", SUB_ID]]);
    expect(s.calls).toContainEqual(["eq", ["external_price_id", PRODUCT]]);
    expect(s.calls).toContainEqual(["eq", ["external_payment_id", ORDER_ID]]);
    expect(s.calls.filter(([m, a]) => m === "eq" && a[0] === "livemode" && a[1] === true)).toHaveLength(3);
    expect(s.calls.filter(([m, a]) => m === "eq" && a[0] === "provider" && a[1] === "mor")).toHaveLength(3);
  });

  it("profileExists: UUID가 아니면 묻지 않고 false", async () => {
    const s = fakeAdmin([{ data: { id: USER }, error: null }]);
    const store = createSupabaseBillingStore(s.admin);
    expect(await store.profileExists("nope")).toBe(false);
    expect(s.calls).toEqual([]);
    expect(await store.profileExists(USER)).toBe(true);
    const none = fakeAdmin([{ data: null, error: null }]);
    expect(await createSupabaseBillingStore(none.admin).profileExists(USER)).toBe(false);
  });

  it("updatePaymentIf는 상태·환불액 조건", async () => {
    const s = fakeAdmin([{ data: [{ id: "r1" }], error: null }]);
    const store = createSupabaseBillingStore(s.admin);
    await store.updatePaymentIf("p1", { status: "paid", refundedAmount: 0 }, { status: "refunded" });
    expect(s.calls).toContainEqual(["eq", ["refunded_amount", 0]]);
    expect(s.calls).toContainEqual(["eq", ["status", "paid"]]);
  });

  it("insertRefund: 정해 준 id를 그대로 넣고 23505(기본 키)는 duplicate, hasRefundFor는 그 id·결제로만 찾는다", async () => {
    const dup = fakeAdmin([{ data: null, error: { code: "23505", message: "duplicate key" } }]);
    const row = { id: PINNED_REFUND_ID, payment_id: "p1", amount: 1234, reason: "auto_ungranted", external_refund_id: null, status: "pending" as const, requested_by: null };
    expect(await createSupabaseBillingStore(dup.admin).insertRefund(row)).toBe("duplicate");
    expect(dup.calls).toContainEqual(["insert", [row]]);
    const found = fakeAdmin([{ data: [{ id: PINNED_REFUND_ID }], error: null }]);
    expect(await createSupabaseBillingStore(found.admin).hasRefundFor("p1", PINNED_REFUND_ID)).toBe(true);
    expect(found.calls).toContainEqual(["eq", ["id", PINNED_REFUND_ID]]);
    expect(found.calls).toContainEqual(["eq", ["payment_id", "p1"]]);
    expect(found.calls.some(([m]) => m === "in")).toBe(false);
  });

  it("insertExternalPayment: 23505는 duplicate", async () => {
    const dup = fakeAdmin([{ data: null, error: { code: "23505", message: "duplicate key" } }]);
    expect(await createSupabaseBillingStore(dup.admin).insertExternalPayment({} as never)).toBe("duplicate");
  });
});

// ── 의존성 조립 ──

const serverMocks = vi.hoisted(() => ({ createAdminClient: vi.fn(() => ({ from: vi.fn() })), logAppError: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: serverMocks.createAdminClient }));
vi.mock("@/lib/logs", () => ({ logAppError: serverMocks.logAppError }));

describe("createMorDeps — 모드가 켜져 있고 Polar 키가 있을 때만(토스 키·암호화 키는 필요 없다)", () => {
  const POLAR_ENV = { POLAR_ACCESS_TOKEN: "polar_oat_fake", POLAR_WEBHOOK_SECRET: "whsec_ZmFrZQ==" };

  async function load(env: Record<string, string>) {
    vi.resetModules();
    for (const k of ["BILLING_MODE", "TOSS_SECRET_KEY", "TOSS_CLIENT_KEY", "BILLING_KEY_ENC_KEY", "POLAR_ACCESS_TOKEN", "POLAR_WEBHOOK_SECRET"]) vi.stubEnv(k, env[k] ?? "");
    const { createMorDeps } = await import("../src/lib/billing/server");
    return createMorDeps();
  }

  it("off면 null", async () => {
    expect(await load({ ...POLAR_ENV, BILLING_MODE: "off" })).toBeNull();
    vi.unstubAllEnvs();
  });

  it("Polar 키가 없으면 null", async () => {
    expect(await load({ BILLING_MODE: "test" })).toBeNull();
    vi.unstubAllEnvs();
  });

  it("test 모드 + Polar 키면 토스 키 없이도 만든다", async () => {
    const deps = await load({ ...POLAR_ENV, BILLING_MODE: "test" });
    expect(deps).not.toBeNull();
    expect(typeof deps!.polar.getSubscription).toBe("function");
    expect(typeof deps!.store.getSubscriptionByExternal).toBe("function");
    expect(deps!.now()).toBeGreaterThan(0);
    await deps!.log("billing test line");
    expect(serverMocks.logAppError).toHaveBeenCalledWith(expect.anything(), "billing test line", { path: "billing" });
    vi.unstubAllEnvs();
  });
});
