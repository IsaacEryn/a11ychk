import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { PolarError, type PolarSubscription } from "../src/lib/billing/polar";
import { createSupabaseBillingStore } from "../src/lib/billing/store";
import { cycleIssues } from "../src/lib/billing/cycleSummary";
import { morAutoRefundId } from "../src/lib/billing/flows/mor";
import { runMorCycle } from "../src/lib/billing/flows/morCycle";
import { runBillingCycle } from "../src/lib/billing/flows/renew";
import type { PaymentRow } from "../src/lib/billing/types";
import {
  DAY,
  MIN,
  NOW,
  checkoutRow,
  createFakePolar,
  createMemoryStore,
  iso,
  makeDeps,
  makeMorDeps,
  paymentRow,
  pgTime,
  polarSubscription,
  priceRow,
  subscriptionRow,
  type FakeMorDeps,
  type MemoryRefund,
  type MemoryRows,
  type MemorySubscription,
  type PolarScript,
} from "./billingFakes";

// 가짜 값만 쓴다 — 실제 금액·상품·사용자가 아니다
const USER = "11111111-1111-4111-8111-111111111111";
const OTHER_USER = "22222222-2222-4222-8222-222222222222";
const PRODUCT = "44444444-4444-4444-8444-444444444444";
const CUSTOMER = "55555555-5555-4555-8555-555555555555";
const SUB_ID = "66666666-6666-4666-8666-666666666666";
const SUB_2 = "67676767-6767-4767-8767-676767676767";
const HOUR = 60 * MIN;

/** 지난 기간(웹훅을 놓쳐 기간이 넘어가지 않은 행)과 Polar가 이미 넘긴 다음 기간 */
const OLD_START = "2025-12-30T16:00:00.000000Z";
const OLD_END = "2026-01-29T16:00:00.000000Z"; // NOW - 1일
const NEW_END = "2026-02-28T16:00:00.000000Z";
const T_OLD = "2025-12-30T16:00:05.000000Z";
const T_NEW = "2026-01-29T16:00:09.000000Z";

const PRICE = priceRow({ id: "99999999-9999-4999-8999-999999999999", provider: "mor", currency: "USD", external_price_id: PRODUCT, livemode: false });

function world(seed: Partial<MemoryRows> = {}, script: Partial<PolarScript> = {}, now: () => number = () => NOW) {
  const store = createMemoryStore({ prices: [PRICE], profiles: [USER, OTHER_USER], ...seed }, { now });
  const deps = makeMorDeps({ store, polar: createFakePolar(script), now });
  return { deps, store, rows: store.rows };
}

function morRow(over: Partial<MemorySubscription> = {}): MemorySubscription {
  return {
    ...subscriptionRow({
      user_id: USER,
      provider: "mor",
      currency: "USD",
      billing_anchor_day: null,
      price_id: PRICE.id,
      current_period_start: OLD_START,
      current_period_end: OLD_END,
    }),
    mor_provider: "polar",
    external_id: SUB_ID,
    external_customer_id: CUSTOMER,
    external_updated_at: T_OLD,
    ...over,
  };
}

/** Polar 정본 — 기본은 다음 기간으로 넘어간 active */
function sub(over: Partial<PolarSubscription> = {}): PolarSubscription {
  return polarSubscription({
    id: SUB_ID,
    modified_at: T_NEW,
    current_period_start: OLD_END,
    current_period_end: NEW_END,
    product_id: PRODUCT,
    customer: { id: CUSTOMER, external_id: USER },
    metadata: { user_id: USER },
    ...over,
  });
}

const logs = (deps: FakeMorDeps) => deps.log.mock.calls.map((c) => c[0]);
const reviews = (deps: FakeMorDeps) => logs(deps).filter((m) => m.startsWith("billing needs review:"));

function expectIdsOnly(deps: FakeMorDeps) {
  for (const m of logs(deps)) {
    expect(m).not.toMatch(/@/);
    expect(m).not.toMatch(/polar_oat|whsec_/);
  }
}

describe("runMorCycle — 놓친 웹훅을 정본으로 메운다", () => {
  it("기간 끝이 6시간 넘게 지난 진행 중 구독을 다시 읽어 맞춘다 — 기간이 넘어가고 mor_synced", async () => {
    const { deps, rows } = world({ subscriptions: [morRow()] }, { getSubscription: [sub()] });

    const out = await runMorCycle(deps, false);

    expect(out).toMatchObject({ mor_candidates: 1, mor_synced: 1, mor_review: 0, mor_failed: 0, mor_stale_refunds: 0 });
    expect(deps.polar.calls.getSubscription).toEqual([[SUB_ID]]);
    expect(rows.subscriptions[0]).toMatchObject({ status: "active", current_period_end: pgTime(NEW_END), external_updated_at: pgTime(T_NEW) });
    expect(logs(deps)).toEqual([]);
  });

  it("후보: mor·이 모드·진행 중이고 (기간 끝 < 지금−6시간 또는 미납) — 오래된 순서", async () => {
    const recent = morRow({ id: "a0000000-0000-4000-8000-000000000001", external_id: "b0000000-0000-4000-8000-000000000001", current_period_end: iso(NOW - 5 * HOUR) });
    const due = morRow({ id: "a0000000-0000-4000-8000-000000000002", external_id: "b0000000-0000-4000-8000-000000000002", current_period_end: iso(NOW - 7 * HOUR) });
    const older = morRow({
      id: "a0000000-0000-4000-8000-000000000003",
      user_id: OTHER_USER,
      external_id: "b0000000-0000-4000-8000-000000000003",
      current_period_end: iso(NOW - 3 * DAY),
    });
    const pastDueFuture = morRow({
      id: "a0000000-0000-4000-8000-000000000004",
      user_id: null,
      status: "past_due",
      external_id: "b0000000-0000-4000-8000-000000000004",
      current_period_end: iso(NOW + 10 * DAY),
    });
    const live = morRow({ id: "a0000000-0000-4000-8000-000000000005", livemode: true, user_id: null, external_id: "b0000000-0000-4000-8000-000000000005" });
    const ended = morRow({ id: "a0000000-0000-4000-8000-000000000006", user_id: null, status: "ended", ended_reason: "user_canceled", external_id: "b0000000-0000-4000-8000-000000000006" });
    const toss = subscriptionRow({ id: "a0000000-0000-4000-8000-000000000007", user_id: null, current_period_end: iso(NOW - 3 * DAY), current_period_start: iso(NOW - 33 * DAY) });
    const seen: string[] = [];
    const read = (id: string) => {
      seen.push(id);
      throw new PolarError("NETWORK", "polar getSubscription failed (network)", 0);
    };
    const { deps } = world({ subscriptions: [recent, due, older, pastDueFuture, live, ended, toss] }, { getSubscription: [read, read, read, read] });

    const out = await runMorCycle(deps, false);

    expect(seen).toEqual([older.external_id, due.external_id, pastDueFuture.external_id]);
    expect(out).toMatchObject({ mor_candidates: 3, mor_failed: 3 });
  });

  it("한 번에 50건까지", async () => {
    const many = Array.from({ length: 51 }, (_, i) =>
      morRow({
        id: `c0000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
        user_id: null,
        external_id: `d0000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
        current_period_end: iso(NOW - (60 - i) * DAY),
        current_period_start: iso(NOW - 400 * DAY),
      }),
    );
    const notFoundAtAll = () => {
      throw new PolarError("HTTP_502", "polar getSubscription failed: HTTP_502 (502)", 502);
    };
    const { deps } = world({ subscriptions: many }, { getSubscription: Array.from({ length: 51 }, () => notFoundAtAll) });

    expect(await runMorCycle(deps, false)).toMatchObject({ mor_candidates: 50, mor_failed: 50 });
    expect(deps.polar.calls.getSubscription).toHaveLength(50);
  });

  it("동기화 결과를 센다 — review는 mor_review, 기간을 줄 수 없어 해지·환불하면 mor_refunded", async () => {
    const reviewRow = morRow();
    const orphan = morRow({ id: "a1000000-0000-4000-8000-000000000001", user_id: null, external_id: SUB_2, current_period_end: iso(NOW - 2 * DAY) });
    const { deps } = world(
      { subscriptions: [reviewRow, orphan], profiles: [USER] },
      {
        // 기간 끝이 이른 쪽(orphan)이 먼저 — 탈퇴한 사용자의 구독이 계속 청구됐다 → revoke(주문 단서 없음 → review로 끝나는 환불)
        getSubscription: [sub({ id: SUB_2, customer: { id: CUSTOMER, external_id: OTHER_USER }, metadata: {} }), sub({ status: "weird_new_status" })],
        updateSubscription: [sub({ id: SUB_2, status: "canceled", customer: { id: CUSTOMER, external_id: OTHER_USER }, metadata: {} })],
      },
    );

    const out = await runMorCycle(deps, false);

    expect(out).toMatchObject({ mor_candidates: 2, mor_synced: 0, mor_review: 2, mor_failed: 0 });
    expect(reviews(deps)).toHaveLength(2);
    expectIdsOnly(deps);
  });

  it("Polar에 없는 구독(404)은 행을 ended(admin)로 끝내고 needs review 한 줄 — 같은 실행에 읽힌 구독이 있을 때", async () => {
    const gone = morRow({ id: "a2000000-0000-4000-8000-000000000001", user_id: OTHER_USER, external_id: SUB_2, current_period_end: iso(NOW - 2 * DAY) });
    const fine = morRow();
    const { deps, rows } = world(
      { subscriptions: [gone, fine] },
      { getSubscription: [new PolarError("ResourceNotFound", "polar getSubscription failed: ResourceNotFound (404)", 404), sub()] },
    );

    const out = await runMorCycle(deps, false);

    expect(out).toMatchObject({ mor_candidates: 2, mor_synced: 1, mor_ended: 1 });
    expect(rows.subscriptions.find((s) => s.id === gone.id)).toMatchObject({ status: "ended", ended_reason: "admin", ended_at: pgTime(NOW) });
    expect(reviews(deps)).toEqual([`billing needs review: mor subscription ${SUB_2} (row ${gone.id}) was not found at Polar; row ended`]);
    // 끝낸 행(과 기간이 넘어간 행)은 다음 실행의 후보가 아니다
    expect(await runMorCycle(deps, false)).toMatchObject({ mor_candidates: 0 });
  });

  it("후보가 하나뿐이고 404면 끝낸다", async () => {
    const { deps, rows } = world({ subscriptions: [morRow()] }, { getSubscription: [new PolarError("ResourceNotFound", "x", 404)] });
    expect(await runMorCycle(deps, false)).toMatchObject({ mor_ended: 1 });
    expect(rows.subscriptions[0]).toMatchObject({ status: "ended", ended_reason: "admin" });
  });

  it("둘 이상이 모두 404이고 하나도 읽히지 않으면 끝내지 않는다 — 토큰의 조직이 다를 수 있다(needs review 한 줄)", async () => {
    const a = morRow();
    const b = morRow({ id: "a3000000-0000-4000-8000-000000000001", user_id: OTHER_USER, external_id: SUB_2 });
    const { deps, rows } = world(
      { subscriptions: [a, b] },
      { getSubscription: [new PolarError("ResourceNotFound", "x", 404), new PolarError("ResourceNotFound", "x", 404)] },
    );

    const out = await runMorCycle(deps, false);

    expect(out).toMatchObject({ mor_candidates: 2, mor_review: 1 });
    expect(out.mor_ended ?? 0).toBe(0);
    expect(rows.subscriptions.map((s) => s.status)).toEqual(["active", "active"]);
    expect(reviews(deps)).toEqual([
      "billing needs review: 2 mor subscriptions were not found at Polar and none could be read in this run; rows left as they are — check that the Polar access token belongs to the organization of this billing mode",
    ]);
  });

  it("그 사이 행이 바뀌었으면(조건부 갱신 엇갈림) 끝내지 않는다", async () => {
    const { deps, store, rows } = world({ subscriptions: [morRow()] }, { getSubscription: [new PolarError("ResourceNotFound", "x", 404)] });
    const realUpdate = store.updateMorSubscriptionIf.bind(store);
    store.updateMorSubscriptionIf = async (id, expected, patch) => {
      rows.subscriptions[0].status = "past_due";
      return realUpdate(id, expected, patch);
    };
    expect(await runMorCycle(deps, false)).toMatchObject({ mor_changed: 1 });
    expect(rows.subscriptions[0].status).toBe("past_due");
    expect(reviews(deps)).toEqual([]);
  });

  it("401·403(토큰·권한)은 그 실행의 대사를 멈춘다 — 기록 한 줄, 남은 구독은 읽지 않는다", async () => {
    for (const status of [401, 403]) {
      const a = morRow({ current_period_end: iso(NOW - 3 * DAY) });
      const b = morRow({ id: "a4000000-0000-4000-8000-000000000001", user_id: OTHER_USER, external_id: SUB_2 });
      const { deps } = world({ subscriptions: [a, b] }, { getSubscription: [new PolarError(`HTTP_${status}`, "x", status), sub()] });

      const out = await runMorCycle(deps, false);

      expect(out, String(status)).toMatchObject({ mor_candidates: 2, mor_halted: 1, mor_failed: 1, mor_deferred: 1 });
      expect(deps.polar.calls.getSubscription, String(status)).toHaveLength(1);
      expect(logs(deps), String(status)).toEqual([`billing mor reconcile halted: Polar refused the access token (HTTP_${status} ${status})`]);
    }
  });

  it("결과 불명·저장소 오류는 그 건만 mor_failed로 세고 다음 건을 계속한다", async () => {
    const a = morRow({ current_period_end: iso(NOW - 3 * DAY) });
    const b = morRow({ id: "a5000000-0000-4000-8000-000000000001", user_id: OTHER_USER, external_id: SUB_2 });
    const { deps, rows } = world(
      { subscriptions: [a, b] },
      { getSubscription: [new PolarError("NETWORK", "polar getSubscription failed (network)", 0), sub({ id: SUB_2, customer: { id: CUSTOMER, external_id: OTHER_USER }, metadata: {} })] },
    );
    expect(await runMorCycle(deps, false)).toMatchObject({ mor_failed: 1, mor_synced: 1 });
    expect(logs(deps)).toEqual([`billing mor reconcile failed for subscription ${a.id}: NETWORK (0)`]);
    expect(rows.subscriptions.find((s) => s.id === b.id)).toMatchObject({ current_period_end: pgTime(NEW_END) });

    // 동기화가 던진 저장소 오류도 그 건만
    const again = world({ subscriptions: [morRow()] }, { getSubscription: [sub()] });
    again.store.updateMorSubscriptionIf = async () => {
      throw new Error("billing store updateMorSubscriptionIf: timeout");
    };
    expect(await runMorCycle(again.deps, false)).toMatchObject({ mor_failed: 1, mor_synced: 0 });
    expect(logs(again.deps)).toEqual([`billing mor reconcile failed for subscription ${again.rows.subscriptions[0].id}: billing store updateMorSubscriptionIf: timeout`]);
  });

  it("예산이 다 됐으면 구독을 읽지 않고 미룬다(mor_deferred)", async () => {
    const { deps } = world({ subscriptions: [morRow()] }, { getSubscription: [sub()] });
    expect(await runMorCycle(deps, false, { deadline: NOW })).toMatchObject({ mor_candidates: 1, mor_deferred: 1, mor_synced: 0 });
    expect(deps.polar.calls.getSubscription).toEqual([]);
  });

  it("예산이 도중에 다 되면 남은 건을 미룬다", async () => {
    const clock = { t: NOW };
    const slow = () => {
      clock.t += 200_000;
      return sub();
    };
    const b = morRow({ id: "a6000000-0000-4000-8000-000000000001", user_id: OTHER_USER, external_id: SUB_2 });
    const { deps } = world({ subscriptions: [morRow({ current_period_end: iso(NOW - 3 * DAY) }), b] }, { getSubscription: [slow, sub()] }, () => clock.t);
    expect(await runMorCycle(deps, false, { deadline: NOW + 100_000 })).toMatchObject({ mor_candidates: 2, mor_synced: 1, mor_deferred: 1 });
    expect(deps.polar.calls.getSubscription).toHaveLength(1);
  });
});

describe("runMorCycle — 만료된 MoR 결제 시도를 닫는다", () => {
  it("만료 시각이 지난 open MoR 시도만 expired(실패 코드 그대로) — 만료 전·processing·토스·다른 모드는 그대로", async () => {
    const stale = checkoutRow({ user_id: USER, price_id: PRICE.id, provider: "mor", expires_at: iso(NOW - MIN) });
    const fresh = checkoutRow({ user_id: USER, price_id: PRICE.id, provider: "mor", expires_at: iso(NOW + MIN) });
    const processing = checkoutRow({ user_id: USER, price_id: PRICE.id, provider: "mor", status: "processing", expires_at: iso(NOW - MIN) });
    const toss = checkoutRow({ user_id: USER, price_id: PRICE.id, provider: "toss", expires_at: iso(NOW - MIN) });
    const live = checkoutRow({ user_id: USER, price_id: PRICE.id, provider: "mor", livemode: true, expires_at: iso(NOW - MIN) });
    const { deps, rows } = world({ checkouts: [stale, fresh, processing, toss, live] });

    expect(await runMorCycle(deps, false)).toMatchObject({ mor_expired: 1 });

    expect(rows.checkouts.map((c) => [c.id, c.status, c.failure_code])).toEqual([
      [stale.id, "expired", null],
      [fresh.id, "open", null],
      [processing.id, "processing", null],
      [toss.id, "open", null],
      [live.id, "open", null],
    ]);
  });

  it("닫다가 저장소 오류가 나도 대사는 계속한다(mor_failed + 기록 한 줄)", async () => {
    const { deps, store } = world({ subscriptions: [morRow()] }, { getSubscription: [sub()] });
    store.expireOpenCheckouts = async () => {
      throw new Error("billing store expireOpenCheckouts: timeout");
    };
    expect(await runMorCycle(deps, false)).toMatchObject({ mor_failed: 1, mor_synced: 1 });
    expect(logs(deps)).toEqual(["billing mor reconcile could not expire checkout attempts: billing store expireOpenCheckouts: timeout"]);
  });
});

describe("runMorCycle — Polar id 없이 오래 pending인 자동 환불을 알린다", () => {
  function payment(over: Partial<PaymentRow> = {}): PaymentRow {
    return paymentRow({ user_id: USER, provider: "mor", currency: "USD", status: "paid", external_payment_id: "e0000000-0000-4000-8000-000000000001", order_id: "mor_e0000000-0000-4000-8000-000000000001", ...over });
  }
  const refund = (p: PaymentRow, over: Partial<MemoryRefund> = {}): MemoryRefund => ({
    id: morAutoRefundId(p.id),
    payment_id: p.id,
    amount: 1234,
    reason: "auto_duplicate",
    external_refund_id: null,
    status: "pending",
    requested_by: null,
    created_at: pgTime(NOW - 31 * MIN),
    ...over,
  });

  it("30분 넘게 pending이고 Polar 환불 id가 없는 자동 환불마다 needs review 한 줄(id만)", async () => {
    const p = payment();
    const { deps } = world({ payments: [p], refunds: [refund(p)] });

    expect(await runMorCycle(deps, false)).toMatchObject({ mor_stale_refunds: 1 });
    expect(reviews(deps)).toEqual([`billing needs review: automatic refund ${morAutoRefundId(p.id)} for payment ${p.id} has been pending without a Polar id`]);
    expectIdsOnly(deps);
  });

  it("자동 환불의 사유(auto_*)로도 알아본다 — 무작위 id여도", async () => {
    const p = payment();
    const { deps } = world({ payments: [p], refunds: [refund(p, { id: "f0000000-0000-4000-8000-000000000001", reason: "auto_ungranted" })] });
    expect(await runMorCycle(deps, false)).toMatchObject({ mor_stale_refunds: 1 });
  });

  it("알리지 않는 것: 30분 안 · Polar id 있음 · 끝난 상태 · 관리자 환불 · 다른 모드 · 토스 결제", async () => {
    const p = payment();
    const p2 = payment({ external_payment_id: "e0000000-0000-4000-8000-000000000002", order_id: "mor_e0000000-0000-4000-8000-000000000002" });
    const p3 = payment({ external_payment_id: "e0000000-0000-4000-8000-000000000003", order_id: "mor_e0000000-0000-4000-8000-000000000003" });
    const p4 = payment({ external_payment_id: "e0000000-0000-4000-8000-000000000004", order_id: "mor_e0000000-0000-4000-8000-000000000004" });
    const live = payment({ livemode: true, external_payment_id: "e0000000-0000-4000-8000-000000000005", order_id: "mor_e0000000-0000-4000-8000-000000000005" });
    const toss = paymentRow({ user_id: USER, status: "paid" });
    const { deps } = world({
      payments: [p, p2, p3, p4, live, toss],
      refunds: [
        refund(p, { created_at: pgTime(NOW - 10 * MIN) }),
        refund(p2, { external_refund_id: "88888888-8888-4888-8888-888888888888" }),
        refund(p3, { status: "failed" }),
        refund(p4, { id: "f0000000-0000-4000-8000-000000000002", reason: "customer_request" }),
        refund(live),
        refund(toss),
      ],
    });

    expect(await runMorCycle(deps, false)).toMatchObject({ mor_stale_refunds: 0 });
    expect(reviews(deps)).toEqual([]);
  });
});

describe("runBillingCycle — MoR 단계", () => {
  const tossDeps = (store: ReturnType<typeof createMemoryStore>) => makeDeps({ store, now: () => NOW });

  it("MoR 의존성을 주면 토스 단계 뒤에 MoR 대사를 돌려 요약에 mor_* 키를 더한다", async () => {
    const { deps: mor, store, rows } = world({ subscriptions: [morRow()] }, { getSubscription: [sub()] });
    const deps = tossDeps(store);

    const out = await runBillingCycle(deps, false, { mor });

    expect(out).toMatchObject({ candidates: 0, errors: 0, mor_candidates: 1, mor_synced: 1, mor_failed: 0, mor_review: 0, mor_stale_refunds: 0 });
    expect(rows.subscriptions[0].current_period_end).toBe(pgTime(NEW_END));
    // 토스 후보 조회는 MoR 행을 보지 않는다
    expect(deps.toss.calls.chargeBillingKey).toEqual([]);
  });

  it("MoR 의존성이 없으면 이 단계를 건너뛴다 — 요약에 mor_* 키가 없다", async () => {
    const { store } = world({ subscriptions: [morRow()] });
    const out = await runBillingCycle(tossDeps(store), false);
    expect(Object.keys(out).filter((k) => k.startsWith("mor_"))).toEqual([]);
    expect(store.rows.subscriptions[0].current_period_end).toBe(pgTime(OLD_END));
  });

  it("같은 예산을 쓴다 — 토스 단계가 예산을 다 쓰면 MoR 구독은 미룬다", async () => {
    const { deps: mor, store } = world({ subscriptions: [morRow()] }, { getSubscription: [sub()] });
    expect(await runBillingCycle(tossDeps(store), false, { mor, budgetMs: 0 })).toMatchObject({ mor_candidates: 1, mor_deferred: 1 });
    expect(mor.polar.calls.getSubscription).toEqual([]);
  });

  it("관리자 도구가 MoR 실패·확인 필요·중단을 문제로 보인다(cycleIssues)", () => {
    expect(cycleIssues({ errors: 0, mor_failed: 2 })).toMatchObject({ errors: 2, any: true });
    expect(cycleIssues({ mor_review: 1, mor_stale_refunds: 2, mor_ended: 1 })).toMatchObject({ review: 4, any: true });
    expect(cycleIssues({ mor_halted: 1 })).toMatchObject({ halted: 1, any: true });
    expect(cycleIssues({ mor_candidates: 3, mor_synced: 3, mor_expired: 1, mor_deferred: 0, mor_changed: 1 })).toEqual({ errors: 0, halted: 0, review: 0, any: false });
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

describe("Supabase 저장소 — MoR 대사·탈퇴·포털 메서드", () => {
  it("listMorReconcileCandidates: mor·livemode·진행 중·외부 id 있음, (기간 끝 < 기준 또는 미납), 기간 끝 오름차순·limit", async () => {
    const s = fakeAdmin([{ data: [{ id: "x" }], error: null }]);
    const before = "2026-01-30T10:00:00.000Z";
    expect(await createSupabaseBillingStore(s.admin).listMorReconcileCandidates(false, before, 50)).toEqual([{ id: "x" }]);
    expect(s.calls).toEqual(
      expect.arrayContaining([
        ["from", ["subscriptions"]],
        ["eq", ["provider", "mor"]],
        ["eq", ["livemode", false]],
        ["in", ["status", ["active", "past_due"]]],
        ["not", ["external_id", "is", null]],
        ["or", [`current_period_end.lt."${before}",status.eq.past_due`]],
        ["order", ["current_period_end", { ascending: true }]],
        ["limit", [50]],
      ]),
    );
    const select = s.calls.find(([name]) => name === "select")![1][0] as string;
    expect(select).toContain("external_id");
  });

  it("listMorReconcileCandidates: 기준 시각이 ISO가 아니면 묻기 전에 던진다(필터 주입 방지)", async () => {
    const s = fakeAdmin([{ data: [], error: null }]);
    await expect(createSupabaseBillingStore(s.admin).listMorReconcileCandidates(false, '2026-01-01",status.eq.ended', 50)).rejects.toThrow("ISO");
    expect(s.calls).toEqual([]);
  });

  it("expireOpenCheckouts: 그 결제사·모드의 open이고 만료가 지난 것만 expired, 바뀐 개수", async () => {
    const s = fakeAdmin([{ data: [{ id: "a" }, { id: "b" }], error: null }]);
    expect(await createSupabaseBillingStore(s.admin).expireOpenCheckouts("mor", true, "2026-01-30T16:00:00.000Z")).toBe(2);
    expect(s.calls).toEqual([
      ["from", ["billing_checkouts"]],
      ["update", [{ status: "expired" }]],
      ["eq", ["provider", "mor"]],
      ["eq", ["livemode", true]],
      ["eq", ["status", "open"]],
      ["lt", ["expires_at", "2026-01-30T16:00:00.000Z"]],
      ["select", ["id"]],
    ]);
  });

  it("listStaleRefunds: pending·Polar id 없음·오래된 것, 결제 행(inner)의 결제사·모드로 거르고 결제 열은 돌려주지 않는다", async () => {
    const row = { id: "r", payment_id: "p", amount: 1234, reason: "auto_duplicate", external_refund_id: null, status: "pending", requested_by: null };
    const s = fakeAdmin([{ data: [{ ...row, billing_payments: { provider: "mor", livemode: false } }], error: null }]);
    expect(await createSupabaseBillingStore(s.admin).listStaleRefunds("mor", false, "2026-01-30T15:30:00.000Z", 50)).toEqual([row]);
    expect(s.calls).toEqual(
      expect.arrayContaining([
        ["from", ["billing_refunds"]],
        ["eq", ["status", "pending"]],
        ["is", ["external_refund_id", null]],
        ["lt", ["created_at", "2026-01-30T15:30:00.000Z"]],
        ["eq", ["billing_payments.provider", "mor"]],
        ["eq", ["billing_payments.livemode", false]],
        ["order", ["created_at", { ascending: true }]],
        ["limit", [50]],
      ]),
    );
    expect(s.calls.find(([name]) => name === "select")![1][0]).toContain("billing_payments!inner(provider, livemode)");
  });

  it("listLiveMorSubscriptions·hasProviderSubscription: 사용자·결제사(·모드)로 거른다", async () => {
    const a = fakeAdmin([{ data: [], error: null }]);
    await createSupabaseBillingStore(a.admin).listLiveMorSubscriptions(USER);
    expect(a.calls).toEqual(expect.arrayContaining([["eq", ["user_id", USER]], ["eq", ["provider", "mor"]], ["in", ["status", ["active", "past_due"]]]]));
    expect(a.calls.some(([name, args]) => name === "eq" && args[0] === "livemode")).toBe(false);

    const b = fakeAdmin([{ data: [{ id: "x" }], error: null }]);
    expect(await createSupabaseBillingStore(b.admin).hasProviderSubscription(USER, "mor", false)).toBe(true);
    expect(b.calls).toEqual(expect.arrayContaining([["eq", ["user_id", USER]], ["eq", ["provider", "mor"]], ["eq", ["livemode", false]], ["limit", [1]]]));
    const c = fakeAdmin([{ data: [], error: null }]);
    expect(await createSupabaseBillingStore(c.admin).hasProviderSubscription(USER, "mor", true)).toBe(false);
  });

  it("오류는 코드를 달아 던진다", async () => {
    const s = fakeAdmin([{ data: null, error: { code: "42P01", message: "missing" } }]);
    const store = createSupabaseBillingStore(s.admin);
    await expect(store.listLiveMorSubscriptions(USER)).rejects.toMatchObject({ code: "42P01" });
    await expect(store.listStaleRefunds("mor", false, "2026-01-30T15:30:00.000Z", 1)).rejects.toMatchObject({ code: "42P01" });
    await expect(store.expireOpenCheckouts("mor", false, "2026-01-30T15:30:00.000Z")).rejects.toMatchObject({ code: "42P01" });
  });
});
