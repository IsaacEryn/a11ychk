import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { DISCLOSURE_VERSION } from "../src/lib/billing/checkout";
import { abandonOpenCheckouts, startCardChangeCheckout, startSubscribeCheckout } from "../src/lib/billing/flows/start";
import { isMissingTable } from "../src/lib/billing/dbErrors";
import { createSupabaseBillingStore } from "../src/lib/billing/store";
import type { MemoryRows } from "./billingFakes";
import {
  DAY,
  MIN,
  NOW,
  checkoutRow,
  createMemoryStore,
  customerRow,
  iso,
  makeDeps,
  paymentRow,
  pgTime,
  priceRow,
  subscriptionRow,
} from "./billingFakes";

const USER = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function setup(rows: Partial<MemoryRows> = {}) {
  const price = priceRow({ amount: 1234 });
  const store = createMemoryStore({ prices: [price], ...rows }, { now: () => NOW });
  const deps = makeDeps({ store });
  return { deps, store, price };
}

const subscribe = (deps: ReturnType<typeof setup>["deps"], priceId: string) =>
  startSubscribeCheckout(deps, { userId: USER, livemode: false, priceId, locale: "ko" });

describe("startSubscribeCheckout — 새 구독의 결제 시도", () => {
  it("정상: 고객 행(무작위 UUID 고객 키)·open 시도(30분)·동의 스냅샷을 만들고 시도 id와 고객 키를 돌려준다", async () => {
    const { deps, store, price } = setup();

    const out = await subscribe(deps, price.id);

    expect(store.rows.customers).toHaveLength(1);
    const customer = store.rows.customers[0];
    expect(customer).toMatchObject({ user_id: USER, livemode: false, toss_billing_key_enc: null });
    expect(customer.toss_customer_key).toMatch(UUID_RE);
    expect(store.rows.checkouts).toHaveLength(1);
    const checkout = store.rows.checkouts[0];
    expect(out).toEqual({ ok: true, checkoutId: checkout.id, customerKey: customer.toss_customer_key });
    expect(checkout).toMatchObject({
      user_id: USER,
      provider: "toss",
      livemode: false,
      price_id: price.id,
      purpose: "subscribe",
      status: "open",
      subscription_id: null,
      failure_code: null,
      expires_at: pgTime(NOW + 30 * MIN),
    });
    expect(store.rows.consents).toEqual([
      {
        id: expect.any(String),
        user_id: USER,
        checkout_id: checkout.id,
        subscription_id: null,
        kind: "recurring_payment",
        disclosure_version: DISCLOSURE_VERSION,
        snapshot: {
          plan_code: "pro",
          amount: 1234,
          currency: "KRW",
          interval: "month",
          first_charge_at: iso(NOW),
          period_end: "2026-02-27T16:00:00.000Z",
          next_charge_at: "2026-02-26T16:00:00.000Z",
          locale: "ko",
        },
      },
    ]);
  });

  it("이미 있는 고객 행의 고객 키를 그대로 쓴다(빌링키는 건드리지 않는다)", async () => {
    const customer = customerRow({ user_id: USER, toss_billing_key_enc: "v1:a:b:c" });
    const { deps, store, price } = setup({ customers: [customer] });
    expect(await subscribe(deps, price.id)).toMatchObject({ ok: true, customerKey: customer.toss_customer_key });
    expect(store.rows.customers).toEqual([customer]);
  });

  it.each([
    ["없는 가격", null],
    ["비활성", { active: false }],
    ["다른 모드", { livemode: true }],
    ["토스가 아닌 결제사", { provider: "manual" as const }],
    ["원화가 아님", { currency: "USD" as const }],
  ])("가격이 %s이면 priceInactive — 아무것도 만들지 않는다", async (_label, over) => {
    const price = priceRow(over ?? {});
    const store = createMemoryStore({ prices: over ? [price] : [] }, { now: () => NOW });
    const deps = makeDeps({ store });
    expect(await subscribe(deps, price.id)).toEqual({ ok: false, error: "priceInactive" });
    expect(store.rows.checkouts).toHaveLength(0);
    expect(store.rows.customers).toHaveLength(0);
    expect(store.rows.consents).toHaveLength(0);
  });

  it("진행 중(active·past_due) 구독이 있으면 hasActive — 다른 모드의 구독은 상관없다", async () => {
    const a = setup({ subscriptions: [subscriptionRow({ user_id: USER, status: "past_due" })] });
    expect(await subscribe(a.deps, a.price.id)).toEqual({ ok: false, error: "hasActive" });
    expect(a.store.rows.checkouts).toHaveLength(0);

    const b = setup({ subscriptions: [subscriptionRow({ user_id: USER, livemode: true }), subscriptionRow({ user_id: USER, status: "ended" })] });
    expect(await subscribe(b.deps, b.price.id)).toMatchObject({ ok: true });
  });

  it("만료 전 open 시도가 있으면 inProgress — 새 시도·동의를 만들지 않는다", async () => {
    const { deps, store, price } = setup();
    expect(await subscribe(deps, price.id)).toMatchObject({ ok: true });

    expect(await subscribe(deps, price.id)).toEqual({ ok: false, error: "inProgress", blockedBy: "open" });
    expect(store.rows.checkouts).toHaveLength(1);
    expect(store.rows.consents).toHaveLength(1);
  });

  it("카드 변경 시도가 진행 중이어도 inProgress(목적과 무관하게 한 번에 하나)", async () => {
    const { deps, store, price } = setup({ checkouts: [] });
    store.rows.checkouts.push(checkoutRow({ user_id: USER, price_id: price.id, purpose: "card_change", status: "processing", expires_at: iso(NOW + 10 * MIN) }));
    expect(await subscribe(deps, price.id)).toEqual({ ok: false, error: "inProgress", blockedBy: "processing" });
  });

  it("만료된 open과 멈춘 processing(만료 +30분, 결과 불명 결제 없음)은 expired로 정리하고 새 시도를 연다", async () => {
    const price = priceRow();
    const staleOpen = checkoutRow({ user_id: USER, price_id: price.id, expires_at: iso(NOW - MIN) });
    const deadProcessing = checkoutRow({ user_id: USER, price_id: price.id, status: "processing", expires_at: iso(NOW - 31 * MIN) });
    const othersOpen = checkoutRow({ user_id: OTHER, price_id: price.id });
    const store = createMemoryStore({ prices: [price], checkouts: [staleOpen, deadProcessing, othersOpen] }, { now: () => NOW });
    const deps = makeDeps({ store });

    const out = await subscribe(deps, price.id);

    expect(out).toMatchObject({ ok: true });
    const byId = new Map(store.rows.checkouts.map((c) => [c.id, c]));
    expect(byId.get(staleOpen.id)).toMatchObject({ status: "expired", failure_code: null });
    expect(byId.get(deadProcessing.id)).toMatchObject({ status: "expired", failure_code: "stale" });
    // 다른 사용자의 시도는 건드리지 않는다
    expect(byId.get(othersOpen.id)?.status).toBe("open");
    expect(store.rows.checkouts.filter((c) => c.user_id === USER && c.status === "open")).toHaveLength(1);
  });

  it("결과를 모르는 첫 결제가 있으면 inProgress — 그 시도는 오래돼도 정리하지 않는다", async () => {
    const price = priceRow();
    const processing = checkoutRow({ user_id: USER, price_id: price.id, status: "processing", expires_at: iso(NOW - DAY) });
    const pending = paymentRow({ user_id: USER, checkout_id: processing.id, status: "pending" });
    const store = createMemoryStore({ prices: [price], checkouts: [processing], payments: [pending] }, { now: () => NOW });
    const deps = makeDeps({ store });

    expect(await subscribe(deps, price.id)).toEqual({ ok: false, error: "inProgress", blockedBy: "processing" });
    expect(store.rows.checkouts).toHaveLength(1);
    expect(store.rows.checkouts[0].status).toBe("processing");
  });

  it("다른 모드의 pending 첫 결제·끝난 결제는 막지 않는다", async () => {
    const { deps, price } = setup({
      payments: [paymentRow({ user_id: USER, livemode: true, status: "pending" }), paymentRow({ user_id: USER, status: "failed" })],
    });
    expect(await subscribe(deps, price.id)).toMatchObject({ ok: true });
  });

  it("확인과 insert 사이에 다른 요청이 시도를 만들었으면 방금 만든 시도를 물리고 inProgress(superseded)", async () => {
    const { deps, store, price } = setup();
    const realInsert = store.insertCheckout.bind(store);
    store.insertCheckout = async (row) => {
      // 같은 순간 다른 탭의 요청이 먼저 시도를 만들었다
      await realInsert({ ...row });
      return realInsert(row);
    };

    expect(await subscribe(deps, price.id)).toEqual({ ok: false, error: "inProgress", blockedBy: "open" });
    const statuses = store.rows.checkouts.map((c) => [c.status, c.failure_code]);
    expect(statuses).toEqual([
      ["open", null],
      ["expired", "superseded"],
    ]);
    expect(store.rows.consents).toHaveLength(0);
  });

  it("동시에 두 번 시작해도 결제창을 열 수 있는 시도는 많아야 하나", async () => {
    const { deps, store, price } = setup();
    const outs = await Promise.all([subscribe(deps, price.id), subscribe(deps, price.id)]);
    expect(outs.filter((o) => o.ok).length).toBeLessThanOrEqual(1);
    expect(store.rows.checkouts.filter((c) => c.status === "open")).toHaveLength(outs.filter((o) => o.ok).length);
  });

  it("동의 기록이 실패하면 시도를 열어 두지 않는다(30분 차단 방지) — 오류는 던진다", async () => {
    const { deps, store, price } = setup();
    store.insertConsent = async () => {
      throw new Error("billing store insertConsent: connection reset");
    };

    await expect(subscribe(deps, price.id)).rejects.toThrow("insertConsent");
    expect(store.rows.checkouts[0]).toMatchObject({ status: "expired", failure_code: "startFailed" });
    // 다음 시도는 막히지 않는다
    store.insertConsent = createMemoryStore().insertConsent;
    expect(await subscribe(deps, price.id)).toMatchObject({ ok: true });
  });
});

describe("startCardChangeCheckout — 카드 변경의 결제 시도", () => {
  it("그 사용자의 진행 중 토스 구독이면 card_change 시도(가격 = 구독의 가격, subscription_id)를 만들고 동의는 받지 않는다", async () => {
    const price = priceRow();
    const sub = subscriptionRow({ user_id: USER, price_id: price.id, status: "past_due" });
    const customer = customerRow({ user_id: USER, toss_billing_key_enc: "v1:a:b:c" });
    const store = createMemoryStore({ prices: [price], subscriptions: [sub], customers: [customer] }, { now: () => NOW });
    const deps = makeDeps({ store });

    const out = await startCardChangeCheckout(deps, { userId: USER, livemode: false, subscriptionId: sub.id });

    expect(out).toEqual({ ok: true, checkoutId: store.rows.checkouts[0].id, customerKey: customer.toss_customer_key });
    expect(store.rows.checkouts[0]).toMatchObject({ purpose: "card_change", price_id: price.id, subscription_id: sub.id, status: "open" });
    expect(store.rows.consents).toHaveLength(0);
    expect(store.rows.customers).toEqual([customer]);
  });

  it.each([
    ["다른 사용자의 구독", { user_id: OTHER }],
    ["다른 모드의 구독", { livemode: true }],
    ["끝난 구독", { status: "ended" as const }],
    ["기관 계약", { provider: "manual" as const, interval: "contract" as const }],
  ])("%s이면 notAllowed — 시도를 만들지 않는다", async (_label, over) => {
    const sub = subscriptionRow({ user_id: USER, price_id: randomUUID(), ...over });
    const store = createMemoryStore({ subscriptions: [sub] }, { now: () => NOW });
    const deps = makeDeps({ store });
    expect(await startCardChangeCheckout(deps, { userId: USER, livemode: false, subscriptionId: sub.id })).toEqual({ ok: false, error: "notAllowed" });
    expect(store.rows.checkouts).toHaveLength(0);
  });

  it("없는 구독은 notAllowed, 가격 없는 구독은 failed(기록)", async () => {
    const store = createMemoryStore({ subscriptions: [subscriptionRow({ user_id: USER, price_id: null })] }, { now: () => NOW });
    const deps = makeDeps({ store });
    expect(await startCardChangeCheckout(deps, { userId: USER, livemode: false, subscriptionId: randomUUID() })).toEqual({ ok: false, error: "notAllowed" });
    expect(await startCardChangeCheckout(deps, { userId: USER, livemode: false, subscriptionId: store.rows.subscriptions[0].id })).toEqual({
      ok: false,
      error: "failed",
    });
    expect(deps.log).toHaveBeenCalledTimes(1);
  });

  it("진행 중 시도가 있으면 inProgress", async () => {
    const price = priceRow();
    const sub = subscriptionRow({ user_id: USER, price_id: price.id });
    const store = createMemoryStore({ prices: [price], subscriptions: [sub], checkouts: [checkoutRow({ user_id: USER, price_id: price.id })] }, { now: () => NOW });
    const deps = makeDeps({ store });
    expect(await startCardChangeCheckout(deps, { userId: USER, livemode: false, subscriptionId: sub.id })).toEqual({ ok: false, error: "inProgress", blockedBy: "open" });
  });
});

describe("abandonOpenCheckouts — 그만둔 시도 닫기", () => {
  it("그 사용자·모드의 open만 abandoned로 닫는다 — processing·다른 사용자·다른 모드는 그대로, 남은 processing을 까닭으로 알린다", async () => {
    const price = priceRow();
    const mine = checkoutRow({ user_id: USER, price_id: price.id });
    const claimed = checkoutRow({ user_id: USER, price_id: price.id, status: "processing" });
    const others = checkoutRow({ user_id: OTHER, price_id: price.id });
    const live = checkoutRow({ user_id: USER, price_id: price.id, livemode: true });
    const store = createMemoryStore({ prices: [price], checkouts: [mine, claimed, others, live] }, { now: () => NOW });
    const deps = makeDeps({ store });

    expect(await abandonOpenCheckouts(deps, { userId: USER, livemode: false })).toEqual({ ok: true, closed: 1, blockedBy: "processing" });
    expect(store.rows.checkouts.map((c) => [c.id, c.status, c.failure_code])).toEqual([
      [mine.id, "expired", "abandoned"],
      [claimed.id, "processing", null],
      [others.id, "open", null],
      [live.id, "open", null],
    ]);
  });

  it("open만 있었으면 닫은 뒤 막는 까닭이 없다, 닫을 것이 없으면 closed 0", async () => {
    const price = priceRow();
    const store = createMemoryStore({ prices: [price], checkouts: [checkoutRow({ user_id: USER, price_id: price.id })] }, { now: () => NOW });
    const deps = makeDeps({ store });
    expect(await abandonOpenCheckouts(deps, { userId: USER, livemode: false })).toEqual({ ok: true, closed: 1, blockedBy: null });
    expect(await abandonOpenCheckouts(deps, { userId: USER, livemode: false })).toEqual({ ok: true, closed: 0, blockedBy: null });
    // 닫은 뒤에는 새 시도를 열 수 있다
    expect(await subscribe(deps, price.id)).toMatchObject({ ok: true });
  });

  it("결과를 모르는 첫 결제가 있으면 닫을 open이 없어도 processing", async () => {
    const store = createMemoryStore({ payments: [paymentRow({ user_id: USER, status: "pending" })] }, { now: () => NOW });
    const deps = makeDeps({ store });
    expect(await abandonOpenCheckouts(deps, { userId: USER, livemode: false })).toEqual({ ok: true, closed: 0, blockedBy: "processing" });
  });

  it("저장소 오류는 기록하고 ok: false", async () => {
    const store = createMemoryStore();
    store.listUnfinishedCheckouts = async () => {
      throw new Error("billing store listUnfinishedCheckouts: timeout");
    };
    const deps = makeDeps({ store });
    expect(await abandonOpenCheckouts(deps, { userId: USER, livemode: false })).toEqual({ ok: false });
    expect(deps.log).toHaveBeenCalledTimes(1);
  });
});

// ── Supabase 저장소의 새 메서드 ──

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

describe("Supabase 저장소 — 결제 시작 메서드", () => {
  const row = { id: "c1", user_id: USER, livemode: false, toss_customer_key: "key-1", toss_billing_key_enc: null, toss_card_summary: null };

  it("ensureCustomer: 행이 있으면 그대로(쓰기 없음)", async () => {
    const { admin, calls } = fakeAdmin([{ data: row, error: null }]);
    expect(await createSupabaseBillingStore(admin).ensureCustomer(USER, false, "new-key")).toEqual(row);
    expect(calls.some(([m]) => m === "insert" || m === "update")).toBe(false);
  });

  it("ensureCustomer: 없으면 새 키로 insert, 동시 생성(23505)에 지면 다시 읽어 이긴 행을 쓴다", async () => {
    const won = fakeAdmin([{ data: null, error: null }, { data: null, error: null }, { data: { ...row, toss_customer_key: "new-key" }, error: null }]);
    expect(await createSupabaseBillingStore(won.admin).ensureCustomer(USER, false, "new-key")).toMatchObject({ toss_customer_key: "new-key" });
    expect(won.calls).toEqual(expect.arrayContaining([["insert", [{ user_id: USER, livemode: false, toss_customer_key: "new-key" }]]]));

    const lost = fakeAdmin([{ data: null, error: null }, { data: null, error: { code: "23505", message: "duplicate key" } }, { data: row, error: null }]);
    expect(await createSupabaseBillingStore(lost.admin).ensureCustomer(USER, false, "new-key")).toEqual(row);
  });

  it("ensureCustomer: 행은 있는데 토스 고객 키가 비었으면 비어 있을 때만 채운다, 다른 오류는 던진다", async () => {
    const empty = { ...row, toss_customer_key: null };
    const fill = fakeAdmin([{ data: empty, error: null }, { data: null, error: null }, { data: { ...row, toss_customer_key: "new-key" }, error: null }]);
    expect(await createSupabaseBillingStore(fill.admin).ensureCustomer(USER, false, "new-key")).toMatchObject({ toss_customer_key: "new-key" });
    expect(fill.calls).toEqual(expect.arrayContaining([["is", ["toss_customer_key", null]]]));

    const boom = fakeAdmin([{ data: null, error: null }, { data: null, error: { code: "42501", message: "permission denied" } }]);
    await expect(createSupabaseBillingStore(boom.admin).ensureCustomer(USER, false, "new-key")).rejects.toThrow(
      "billing store ensureCustomer: permission denied",
    );
  });

  it("listUnfinishedCheckouts·hasPendingInitialPayment·expireCheckouts의 조건", async () => {
    const list = fakeAdmin([{ data: [], error: null }]);
    expect(await createSupabaseBillingStore(list.admin).listUnfinishedCheckouts(USER, false)).toEqual([]);
    expect(list.calls).toEqual(
      expect.arrayContaining([
        ["from", ["billing_checkouts"]],
        ["eq", ["user_id", USER]],
        ["eq", ["livemode", false]],
        ["in", ["status", ["open", "processing"]]],
      ]),
    );

    const pending = fakeAdmin([{ data: [{ id: "p1" }], error: null }]);
    expect(await createSupabaseBillingStore(pending.admin).hasPendingInitialPayment(USER, true)).toBe(true);
    expect(pending.calls).toEqual(
      expect.arrayContaining([
        ["from", ["billing_payments"]],
        ["eq", ["user_id", USER]],
        ["eq", ["livemode", true]],
        ["eq", ["kind", "initial"]],
        ["eq", ["status", "pending"]],
        ["limit", [1]],
      ]),
    );

    const expire = fakeAdmin([{ data: null, error: null }]);
    await createSupabaseBillingStore(expire.admin).expireCheckouts(["a", "b"], "processing", "stale");
    expect(expire.calls).toEqual(
      expect.arrayContaining([
        ["update", [{ status: "expired", failure_code: "stale" }]],
        ["in", ["id", ["a", "b"]]],
        ["eq", ["status", "processing"]],
      ]),
    );
    const keepCode = fakeAdmin([{ data: null, error: null }]);
    await createSupabaseBillingStore(keepCode.admin).expireCheckouts(["a"], "open", null);
    expect(keepCode.calls).toEqual(expect.arrayContaining([["update", [{ status: "expired" }]]]));

    // 빈 목록이면 요청하지 않는다
    const none = fakeAdmin([{ data: null, error: null }]);
    await createSupabaseBillingStore(none.admin).expireCheckouts([], "open", null);
    expect(none.calls).toHaveLength(0);
  });

  it("던지는 오류에 PostgREST 코드를 code로 단다 — 호출부가 0041 미적용(테이블 없음)을 가려낸다", async () => {
    const missing = { code: "42P01", message: 'relation "public.subscriptions" does not exist' };
    const err = await createSupabaseBillingStore(fakeAdmin([{ data: null, error: missing }]).admin)
      .listLiveSubscriptions(USER)
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toBe(`billing store listLiveSubscriptions: ${missing.message}`);
    expect(isMissingTable(err)).toBe(true);

    const cache = await createSupabaseBillingStore(fakeAdmin([{ data: null, error: { code: "PGRST205", message: "schema cache" } }]).admin)
      .hasPendingPayment("s1")
      .catch((e: unknown) => e);
    expect(isMissingTable(cache)).toBe(true);

    const denied = await createSupabaseBillingStore(fakeAdmin([{ data: null, error: { code: "42501", message: "permission denied" } }]).admin)
      .listLiveSubscriptions(USER)
      .catch((e: unknown) => e);
    expect(isMissingTable(denied)).toBe(false);
    expect(isMissingTable(new Error("billing store x: timeout"))).toBe(false);
    expect(isMissingTable(undefined)).toBe(false);
  });
});
