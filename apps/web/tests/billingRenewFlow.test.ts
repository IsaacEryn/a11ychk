import { afterEach, describe, expect, it, vi } from "vitest";
import { randomBytes } from "node:crypto";
import { encryptBillingKey } from "../src/lib/billing/crypto";
import { addInterval } from "../src/lib/billing/period";
import { TossError, type TossPayment } from "../src/lib/billing/toss";
import type { CheckoutRow, PaymentRow, SubscriptionRow } from "../src/lib/billing/types";
import {
  chargeSubscription,
  decideRenewalAction,
  reconcilePending,
  runBillingCycle,
  type RenewalAction,
} from "../src/lib/billing/flows/renew";
import {
  DAY,
  MIN,
  NOW,
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
  type FakeDeps,
  type MemoryRows,
  type TossScript,
} from "./billingFakes";

// 크론 라우트 테스트용 — 흐름(renew.ts)은 이 두 모듈을 쓰지 않는다
const { withCronRun, createBillingDeps } = vi.hoisted(() => ({
  withCronRun: vi.fn(async (_job: string, fn: () => Promise<Record<string, unknown>>) => fn()),
  createBillingDeps: vi.fn(),
}));
vi.mock("@/lib/cronRun", () => ({ withCronRun }));
vi.mock("@/lib/billing/server", () => ({ createBillingDeps }));

import { GET } from "../src/app/api/cron/billing/route";

const USER = "11111111-1111-4111-8111-111111111111";
const USER2 = "22222222-2222-4222-8222-222222222222";
const USER3 = "33333333-3333-4333-8333-333333333333";
const CUSTOMER_KEY = "5b0c7a7e-0f4e-4a40-9c55-8a3f4e1d2c10";
const BILLING_KEY = "bk_plain_secret_0001";
const CARD = { issuerCode: "61", number: "1234****", cardType: "신용" };
const HOUR = 3_600_000;
/** 설정 사고 뒤 재시도까지 — 다음 날 크론(Hobby ±59분)이 늘 기한이 지난 것으로 보게 24시간보다 짧다 */
const INCIDENT_RETRY = 20 * HOUR;

/** 앵커 31일: 첫 기간 1/31 01:00 KST → 2/28 01:00 KST(짧은 달 말일) */
const START = iso(NOW);
const END = addInterval(START, "month", 31);
const E = Date.parse(END);
/** 3/31 01:00 KST, 4/30 01:00 KST */
const END2 = "2026-03-30T16:00:00.000Z";
const END3 = "2026-04-29T16:00:00.000Z";
const YEAR_END = addInterval(START, "year", 31);
const YE = Date.parse(YEAR_END);

interface SetupOpts {
  sub?: Partial<SubscriptionRow>;
  /** false면 고객 행에 빌링키가 없다 */
  key?: boolean;
  toss?: Partial<TossScript>;
  rows?: Partial<MemoryRows>;
  /** 처음 시각(기본: 기간 끝 1시간 전 = 갱신 결제 시점) */
  at?: number;
}

/** 빌링키가 저장된 고객과 앵커 31일 월간 구독 1건. clock.t를 바꾸면 deps·저장소의 지금이 같이 바뀐다 */
function setup(opts: SetupOpts = {}) {
  const clock = { t: opts.at ?? E - HOUR };
  const now = () => clock.t;
  const encKey = randomBytes(32);
  const enc = encryptBillingKey(BILLING_KEY, { userId: USER, livemode: false }, encKey);
  const price = priceRow();
  const customer = customerRow({
    user_id: USER,
    toss_customer_key: CUSTOMER_KEY,
    toss_billing_key_enc: opts.key === false ? null : enc,
    toss_card_summary: opts.key === false ? null : CARD,
  });
  const sub = subscriptionRow({
    user_id: USER,
    price_id: price.id,
    current_period_start: START,
    current_period_end: END,
    billing_anchor_day: 31,
    ...opts.sub,
  });
  const store = createMemoryStore({ prices: [price], customers: [customer], subscriptions: [sub], ...opts.rows }, { now });
  const deps = makeDeps({ store, toss: createFakeToss(opts.toss), encKey, now });
  return { deps, store, clock, price, customer, sub, enc, encKey };
}

/** 결제 요청에 맞춘 DONE 응답 — paymentKey도 주문마다 다르다(DB 유니크) */
const done = (_bk: string, req: { orderId: string; amount: number }) =>
  tossPayment({ paymentKey: `pk_${req.orderId}`, orderId: req.orderId, totalAmount: req.amount });
/** 주문 조회 응답 */
const lookup =
  (status: string, over: Partial<TossPayment> = {}) =>
  (orderId: string) =>
    tossPayment({ paymentKey: `pk_${orderId}`, orderId, status, ...over });
const reject = (code: string, message = "카드 결제가 거절됐어요", status = 400) => new TossError(code, message, status);

const tossCalls = (d: FakeDeps) =>
  d.toss.calls.issueBillingKey.length +
  d.toss.calls.chargeBillingKey.length +
  d.toss.calls.getPaymentByOrderId.length +
  d.toss.calls.cancelPayment.length;
const logged = (d: FakeDeps) => d.log.mock.calls.map((c) => String(c[0])).join("\n");

/**
 * setup()의 구독(먼저 처리) + 빌링키가 있는 두 번째 갱신 대상(10분 늦게 끝남)
 * + reminder면 안내만 받을 세 번째 구독(3일 뒤 끝남, 빌링키 없음)
 */
function withMore(toss: Partial<TossScript>, opts: { reminder?: boolean } = {}) {
  const base = setup({ toss });
  const encOther = encryptBillingKey(BILLING_KEY, { userId: USER2, livemode: false }, base.encKey);
  base.store.rows.customers.push(customerRow({ user_id: USER2, toss_customer_key: "cust-2", toss_billing_key_enc: encOther }));
  const second = subscriptionRow({ user_id: USER2, current_period_start: START, current_period_end: pgTime(E + 10 * MIN), billing_anchor_day: 31 });
  base.store.rows.subscriptions.push(second);
  const third = subscriptionRow({ user_id: USER3, current_period_start: START, current_period_end: pgTime(E + 3 * DAY), billing_anchor_day: 31 });
  if (opts.reminder) base.store.rows.subscriptions.push(third);
  const row = (id: string) => base.store.rows.subscriptions.find((x) => x.id === id)!;
  return { ...base, second, third, row };
}

describe("decideRenewalAction — 조합표", () => {
  const row = (over: Partial<SubscriptionRow> = {}) =>
    subscriptionRow({ user_id: USER, current_period_start: START, current_period_end: END, billing_anchor_day: 31, ...over });
  const pastDue = { status: "past_due" as const, dunning_attempts: 1, next_retry_at: iso(E + DAY), grace_until: iso(E + 7 * DAY) };
  const yearly = { interval: "year" as const, current_period_end: YEAR_END };

  it.each<[string, Partial<SubscriptionRow>, number, RenewalAction]>([
    ["해지 예약 — 기간 끝 전에는 결제도 안내도 하지 않는다", { cancel_at_period_end: true }, E - HOUR, "none"],
    ["해지 예약 — 기간 끝부터 종료", { cancel_at_period_end: true }, E, "end_canceled"],
    ["갱신 24시간 전 직전은 아직 결제하지 않는다(안내만)", {}, E - DAY - 1, "remind"],
    ["갱신 24시간 전부터 결제", {}, E - DAY, "charge"],
    ["기간 끝이 지났어도 active면 결제", {}, E + HOUR, "charge"],
    ["결제 시점에는 안내보다 결제가 먼저", { reminder_sent_for: null }, E - HOUR, "charge"],
    ["월간 안내 — 7일 전부터", {}, E - 7 * DAY, "remind"],
    ["월간 안내 — 7일 전 직전은 아직", {}, E - 7 * DAY - 1, "none"],
    ["월간은 30일 전에 안내하지 않는다", {}, E - 30 * DAY, "none"],
    ["연간 안내 — 30일 전부터", yearly, YE - 30 * DAY, "remind"],
    ["연간 안내 — 30일 전 직전은 아직", yearly, YE - 30 * DAY - 1, "none"],
    ["이번 기간 안내를 이미 보냈으면 다시 보내지 않는다", { reminder_sent_for: END }, E - 3 * DAY, "none"],
    ["안내 기록(+00:00)과 기간 끝(Z) 표기가 달라도 같은 시각이면 보낸 것", { reminder_sent_for: pgTime(END) }, E - 3 * DAY, "none"],
    ["기간 끝(+00:00)과 안내 기록(Z) 표기가 달라도 같은 시각이면 보낸 것", { current_period_end: pgTime(END), reminder_sent_for: END }, E - 3 * DAY, "none"],
    ["지난 기간의 안내 기록은 이번 기간 안내를 막지 않는다", { reminder_sent_for: START }, E - 3 * DAY, "remind"],
    ["미납 — 재시도 시각 전에는 아무것도", pastDue, E + DAY - 1, "none"],
    ["미납 — 재시도 시각부터 재시도", pastDue, E + DAY, "retry"],
    ["미납 — 재시도 소진(next_retry_at null)이면 기다린다", { ...pastDue, dunning_attempts: 4, next_retry_at: null }, E + 6 * DAY, "none"],
    ["미납 — 유예 만료면 재시도보다 먼저 종료", { ...pastDue, next_retry_at: iso(E + 5 * DAY) }, E + 7 * DAY, "end_unpaid"],
    ["미납 — grace_until이 비면 기간 끝 + 7일로 본다", { ...pastDue, next_retry_at: null, grace_until: null }, E + 7 * DAY, "end_unpaid"],
    ["미납 — grace_until이 비어도 7일 전이면 아직", { ...pastDue, next_retry_at: null, grace_until: null }, E + 7 * DAY - 1, "none"],
    ["미납인데 해지 예약이 있으면 재시도하지 않고 끝낸다", { ...pastDue, cancel_at_period_end: true }, E + DAY, "end_canceled"],
    ["수동 계약은 none", { provider: "manual", interval: "contract" }, E, "none"],
    ["MoR은 none", { provider: "mor" }, E, "none"],
    ["종료된 구독은 none", { status: "ended", ended_reason: "user_canceled" }, E, "none"],
  ])("%s", (_name, over, now, expected) => {
    expect(decideRenewalAction(row(over), now)).toBe(expected);
  });
});

describe("갱신 결제", () => {
  it("성공: 한 주기 전진·앵커 31일 유지(2/28 → 3/31 → 4/30), 금액은 구독 스냅샷, 영수증 메일", async () => {
    const { deps, store, clock, sub } = setup({ toss: { chargeBillingKey: [done, done] } });
    // 가격표가 바뀌어도 기존 구독은 가입 시점 금액으로 갱신한다
    store.rows.prices[0].amount = 9900;

    const first = await runBillingCycle(deps, false);

    expect(first).toMatchObject({ candidates: 1, charge_paid: 1, errors: 0, deferred: 0 });
    expect(store.rows.subscriptions[0]).toMatchObject({
      status: "active",
      current_period_start: pgTime(END),
      current_period_end: pgTime(END2),
      billing_anchor_day: 31,
      amount: 1234,
      dunning_attempts: 0,
      next_retry_at: null,
      grace_until: null,
      reminder_sent_for: null,
    });
    expect(store.rows.payments).toHaveLength(1);
    const p1 = store.rows.payments[0];
    expect(p1).toMatchObject({
      user_id: USER,
      subscription_id: sub.id,
      checkout_id: null,
      provider: "toss",
      livemode: false,
      kind: "renewal",
      attempt: 1,
      status: "paid",
      amount: 1234,
      currency: "KRW",
      period_start: pgTime(END),
      period_end: pgTime(END2),
      external_payment_id: `pk_${p1.order_id}`,
      receipt_url: "https://dashboard.tosspayments.com/receipt/0001",
      card_summary: CARD,
      failure_code: null,
    });
    expect(p1.order_id).toMatch(/^pay_[0-9a-f-]{36}$/);
    // 복호화한 빌링키로, 결제 행 id를 멱등 키로, 스냅샷 금액을 청구한다
    expect(deps.toss.calls.chargeBillingKey).toEqual([
      [BILLING_KEY, { customerKey: CUSTOMER_KEY, amount: 1234, orderId: p1.order_id, orderName: "A11y Check Pro 월간 구독" }, p1.id],
    ]);
    expect(deps.mailer.sent).toEqual([
      {
        userId: USER,
        kind: "receipt",
        data: {
          planName: "Pro",
          amount: 1234,
          currency: "KRW",
          periodEnd: pgTime(END2),
          receiptUrl: "https://dashboard.tosspayments.com/receipt/0001",
          card: "신용 1234****",
        },
      },
    ]);

    // 다음 주기: 3/31 → 4/30. 앞 기간 끝의 일자(28일)가 아니라 앵커(31일)로 계산한다
    clock.t = Date.parse(END2) - HOUR;
    expect(await runBillingCycle(deps, false)).toMatchObject({ charge_paid: 1 });
    expect(store.rows.subscriptions[0]).toMatchObject({ current_period_start: pgTime(END2), current_period_end: pgTime(END3) });
    expect(store.rows.payments.map((p) => [p.kind, p.attempt, p.status, p.period_start])).toEqual([
      ["renewal", 1, "paid", pgTime(END)],
      ["renewal", 1, "paid", pgTime(END2)],
    ]);
    expect(deps.mailer.sent).toHaveLength(2);
    expect(deps.log).not.toHaveBeenCalled();
    expect(JSON.stringify(store.rows)).not.toContain(BILLING_KEY);
  });

  it("앵커일이 비어 있으면 지금 기간 끝의 KST 일자로 계산한다", async () => {
    const { deps, store } = setup({ sub: { billing_anchor_day: null }, toss: { chargeBillingKey: [done] } });
    await runBillingCycle(deps, false);
    // 2/28 01:00 KST가 기준 → 3/28 01:00 KST
    expect(store.rows.subscriptions[0].current_period_end).toBe(pgTime("2026-03-27T16:00:00.000Z"));
  });

  it("같은 주기를 두 번 돌려도 결제는 1회 — 두 번째는 skipped", async () => {
    const { deps, store, sub } = setup({ toss: { chargeBillingKey: [done, done] } });
    const stale = (await store.getSubscription(sub.id))!;

    expect(await chargeSubscription(deps, stale, "renewal")).toBe("paid");
    // 낡은 구독 행으로 다시 불러도 결제 행 유니크(구독·기간 시작·시도)가 막는다
    expect(await chargeSubscription(deps, stale, "renewal")).toBe("skipped");
    // 크론을 다시 돌려도 이미 전진한 구독이라 결제하지 않는다
    const again = await runBillingCycle(deps, false);
    expect(again.charge_paid).toBeUndefined();

    expect(deps.toss.calls.chargeBillingKey).toHaveLength(1);
    expect(store.rows.payments).toHaveLength(1);
    expect(deps.mailer.sent).toHaveLength(1);
  });

  it("크론 두 개가 동시에 돌아도 결제 1회", async () => {
    const { deps, store } = setup({ toss: { chargeBillingKey: [done, done] } });
    const [a, b] = await Promise.all([runBillingCycle(deps, false), runBillingCycle(deps, false)]);
    expect(deps.toss.calls.chargeBillingKey).toHaveLength(1);
    expect(store.rows.payments).toHaveLength(1);
    expect([a.charge_paid ?? 0, b.charge_paid ?? 0].sort()).toEqual([0, 1]);
    expect([a.charge_skipped ?? 0, b.charge_skipped ?? 0].sort()).toEqual([0, 1]);
  });

  it("거절(REJECT_CARD_PAYMENT) → 미납·재시도(+1·+3·+5일)·메일은 첫 실패 1통 → 소진 → 유예 만료 시 종료", async () => {
    const declined = () => reject("REJECT_CARD_PAYMENT", "한도가 초과됐어요");
    const { deps, store, clock, sub } = setup({ toss: { chargeBillingKey: [declined(), declined(), declined(), declined()] } });
    const at = (t: number) => {
      clock.t = t;
      return runBillingCycle(deps, false);
    };
    const s = () => store.rows.subscriptions[0];

    expect(await at(E - HOUR)).toMatchObject({ charge_failed: 1 });
    expect(s()).toMatchObject({
      status: "past_due",
      dunning_attempts: 1,
      next_retry_at: pgTime(E + DAY),
      grace_until: pgTime(E + 7 * DAY),
      // 미납 동안 기간은 그대로다(재시도·유예는 이 시각 기준)
      current_period_start: pgTime(START),
      current_period_end: pgTime(END),
    });
    expect(store.rows.payments[0]).toMatchObject({
      kind: "renewal",
      attempt: 1,
      status: "failed",
      failure_code: "REJECT_CARD_PAYMENT",
      failure_message: "한도가 초과됐어요",
      subscription_id: sub.id,
    });
    expect(deps.mailer.sent).toEqual([
      {
        userId: USER,
        kind: "failed",
        data: { planName: "Pro", amount: 1234, currency: "KRW", graceUntil: iso(E + 7 * DAY), needsCardChange: false },
      },
    ]);

    expect(await at(E + DAY - MIN)).toMatchObject({ none: 1 });
    expect(await at(E + DAY)).toMatchObject({ retry_failed: 1 });
    expect(s()).toMatchObject({ status: "past_due", dunning_attempts: 2, next_retry_at: pgTime(E + 3 * DAY) });
    expect(await at(E + 3 * DAY)).toMatchObject({ retry_failed: 1 });
    expect(s()).toMatchObject({ dunning_attempts: 3, next_retry_at: pgTime(E + 5 * DAY), grace_until: pgTime(E + 7 * DAY) });
    expect(deps.mailer.sent).toHaveLength(1);

    // 네 번째 실패 — 남은 재시도가 없다
    expect(await at(E + 5 * DAY)).toMatchObject({ retry_failed: 1 });
    expect(s()).toMatchObject({ status: "past_due", dunning_attempts: 4, next_retry_at: null });
    expect(await at(E + 6 * DAY)).toMatchObject({ none: 1 });
    expect(deps.mailer.sent).toHaveLength(1);
    expect(deps.toss.calls.chargeBillingKey).toHaveLength(4);
    expect(store.rows.payments.map((p) => [p.kind, p.attempt, p.status, p.period_start])).toEqual([
      ["renewal", 1, "failed", pgTime(END)],
      ["retry", 2, "failed", pgTime(END)],
      ["retry", 3, "failed", pgTime(END)],
      ["retry", 4, "failed", pgTime(END)],
    ]);

    // 유예 만료 → 종료, 빌링키·카드 지움, 종료 메일
    expect(await at(E + 7 * DAY)).toMatchObject({ end_unpaid: 1 });
    expect(s()).toMatchObject({ status: "ended", ended_reason: "payment_failed", ended_at: pgTime(E + 7 * DAY) });
    expect(store.rows.customers[0]).toMatchObject({ toss_billing_key_enc: null, toss_card_summary: null });
    expect(deps.mailer.sent).toHaveLength(2);
    expect(deps.mailer.sent[1]).toEqual({ userId: USER, kind: "ended", data: { planName: "Pro", reason: "unpaid" } });
    // 끝난 구독은 후보에서 빠진다
    expect(await at(E + 8 * DAY)).toMatchObject({ candidates: 0 });
    expect(deps.toss.calls.chargeBillingKey).toHaveLength(4);
    expect(deps.log).not.toHaveBeenCalled();
  });

  it("카드 오류(INVALID_STOPPED_CARD)면 재시도하지 않고 카드 변경 안내 메일", async () => {
    const { deps, store, clock } = setup({ toss: { chargeBillingKey: [reject("INVALID_STOPPED_CARD")] } });
    expect(await runBillingCycle(deps, false)).toMatchObject({ charge_failed: 1 });
    expect(store.rows.subscriptions[0]).toMatchObject({
      status: "past_due",
      dunning_attempts: 1,
      next_retry_at: null,
      grace_until: pgTime(E + 7 * DAY),
    });
    expect(store.rows.payments[0]).toMatchObject({ status: "failed", failure_code: "INVALID_STOPPED_CARD" });
    expect(deps.mailer.sent).toEqual([
      {
        userId: USER,
        kind: "failed",
        data: { planName: "Pro", amount: 1234, currency: "KRW", graceUntil: iso(E + 7 * DAY), needsCardChange: true },
      },
    ]);
    // 카드 문제는 운영 오류가 아니다
    expect(deps.log).not.toHaveBeenCalled();
    // 다음 날에도 다시 결제하지 않는다(카드 변경을 기다린다)
    clock.t = E + DAY;
    expect(await runBillingCycle(deps, false)).toMatchObject({ none: 1 });
    expect(deps.toss.calls.chargeBillingKey).toHaveLength(1);
  });

  it("재시도 중 카드 오류로 바뀌면 첫 실패가 아니어도 카드 변경 메일을 보낸다", async () => {
    const { deps } = setup({
      sub: { status: "past_due", dunning_attempts: 1, next_retry_at: iso(E + DAY), grace_until: iso(E + 7 * DAY) },
      at: E + DAY,
      toss: { chargeBillingKey: [reject("INVALID_CARD_EXPIRATION")] },
    });
    expect(await runBillingCycle(deps, false)).toMatchObject({ retry_failed: 1 });
    expect(deps.mailer.sent).toHaveLength(1);
    expect(deps.mailer.sent[0]).toMatchObject({ kind: "failed", data: { needsCardChange: true } });
  });

  it("설정 오류(UNAUTHORIZED_KEY)는 카드 실패가 아니다 — 메일 없이 미납·다음 날 재시도, 이번 실행의 남은 결제는 멈추고 안내는 계속", async () => {
    const { deps, store, sub, second, third, row } = withMore(
      { chargeBillingKey: [reject("UNAUTHORIZED_KEY", "secret detail from toss", 401), done] },
      { reminder: true },
    );

    expect(await runBillingCycle(deps, false)).toMatchObject({ candidates: 3, charge_halted: 1, halted: 1, halt_skipped: 1, remind: 1 });

    // 새 시도 번호를 비우고(dunning +1) 하루 뒤 다시 — 유예는 기간 끝 기준
    expect(row(sub.id)).toMatchObject({
      status: "past_due",
      dunning_attempts: 1,
      next_retry_at: pgTime(E - HOUR + INCIDENT_RETRY),
      grace_until: pgTime(E + 7 * DAY),
      current_period_end: pgTime(END),
    });
    expect(store.rows.payments).toHaveLength(1);
    expect(store.rows.payments[0]).toMatchObject({ subscription_id: sub.id, status: "failed", failure_code: "UNAUTHORIZED_KEY" });
    // 같은 실행의 다음 결제 대상은 건드리지 않는다
    expect(deps.toss.calls.chargeBillingKey).toHaveLength(1);
    expect(row(second.id)).toMatchObject({ status: "active", current_period_end: pgTime(E + 10 * MIN), dunning_attempts: 0 });
    // 사용자에게는 실패 메일이 가지 않는다(안내 메일만)
    expect(deps.mailer.sent.map((m) => [m.userId, m.kind])).toEqual([[USER3, "reminder"]]);
    expect(row(third.id).reminder_sent_for).toBe(pgTime(E + 3 * DAY));
    // 기록은 한 번, 코드만
    expect(deps.log).toHaveBeenCalledTimes(1);
    const text = logged(deps);
    expect(text).toContain("UNAUTHORIZED_KEY");
    expect(text).not.toContain("secret detail from toss");
    expect(text).not.toContain(BILLING_KEY);
  });

  it("운영 사고 다음 날 재시도는 새 시도 번호로 결제한다", async () => {
    const { deps, store, clock } = setup({ toss: { chargeBillingKey: [reject("INVALID_API_KEY", "bad key", 401), done] } });
    await runBillingCycle(deps, false);
    clock.t = E - HOUR + DAY;
    expect(await runBillingCycle(deps, false)).toMatchObject({ retry_paid: 1 });
    expect(store.rows.payments.map((p) => [p.kind, p.attempt, p.status])).toEqual([
      ["renewal", 1, "failed"],
      ["retry", 2, "paid"],
    ]);
    expect(store.rows.subscriptions[0]).toMatchObject({ status: "active", current_period_end: pgTime(END2), dunning_attempts: 0 });
  });

  it("미납 중 운영 사고는 이미 정한 유예를 바꾸지 않는다", async () => {
    const { deps, store } = setup({
      sub: { status: "past_due", dunning_attempts: 2, next_retry_at: iso(E + 3 * DAY), grace_until: iso(E + 10 * DAY) },
      at: E + 3 * DAY,
      toss: { chargeBillingKey: [reject("FORBIDDEN_REQUEST", "forbidden", 403)] },
    });
    expect(await runBillingCycle(deps, false)).toMatchObject({ retry_halted: 1, halted: 1 });
    expect(store.rows.subscriptions[0]).toMatchObject({
      status: "past_due",
      dunning_attempts: 3,
      next_retry_at: pgTime(E + 3 * DAY + INCIDENT_RETRY),
      grace_until: pgTime(E + 10 * DAY),
    });
    expect(store.rows.payments[0]).toMatchObject({ kind: "retry", attempt: 3, status: "failed", failure_code: "FORBIDDEN_REQUEST" });
    expect(deps.mailer.sent).toHaveLength(0);
  });

  it("재시도 성공: active로 돌아가고 기간 전진, 미납 기록을 지운다", async () => {
    const { deps, store, sub } = setup({
      sub: { status: "past_due", dunning_attempts: 1, next_retry_at: iso(E + DAY), grace_until: iso(E + 7 * DAY) },
      at: E + DAY,
      toss: { chargeBillingKey: [done] },
    });
    expect(await runBillingCycle(deps, false)).toMatchObject({ retry_paid: 1 });
    expect(store.rows.subscriptions[0]).toMatchObject({
      status: "active",
      current_period_start: pgTime(END),
      current_period_end: pgTime(END2),
      dunning_attempts: 0,
      next_retry_at: null,
      grace_until: null,
      reminder_sent_for: null,
    });
    expect(store.rows.payments[0]).toMatchObject({ kind: "retry", attempt: 2, status: "paid", subscription_id: sub.id, period_start: pgTime(END) });
    expect(deps.mailer.sent.map((m) => m.kind)).toEqual(["receipt"]);
  });

  it("빌링키가 없으면 토스를 부르지 않고 미납(NO_BILLING_KEY)·카드 변경 안내", async () => {
    const { deps, store } = setup({ key: false });
    expect(await runBillingCycle(deps, false)).toMatchObject({ charge_failed: 1 });
    expect(tossCalls(deps)).toBe(0);
    expect(store.rows.subscriptions[0]).toMatchObject({ status: "past_due", dunning_attempts: 1, next_retry_at: null, grace_until: pgTime(E + 7 * DAY) });
    expect(store.rows.payments[0]).toMatchObject({ kind: "renewal", attempt: 1, status: "failed", failure_code: "NO_BILLING_KEY", amount: 1234 });
    expect(deps.mailer.sent[0]).toMatchObject({ kind: "failed", data: { needsCardChange: true } });
  });

  it("고객 행이 없어도 빌링키 없음으로 처리한다", async () => {
    const { deps, store } = setup({ rows: { customers: [] } });
    expect(await runBillingCycle(deps, false)).toMatchObject({ charge_failed: 1 });
    expect(tossCalls(deps)).toBe(0);
    expect(store.rows.payments[0]).toMatchObject({ status: "failed", failure_code: "NO_BILLING_KEY" });
  });

  it("암호문을 풀 수 없으면 그 행만의 사고 — DECRYPT_FAILED·메일 없음·나중에 재시도, 다음 후보는 그대로 결제한다", async () => {
    const foreign = encryptBillingKey(BILLING_KEY, { userId: USER, livemode: false }, randomBytes(32));
    const { deps, store, sub, second, third, row } = withMore({ chargeBillingKey: [done] }, { reminder: true });
    store.rows.customers[0].toss_billing_key_enc = foreign;

    const out = await runBillingCycle(deps, false);
    expect(out).toMatchObject({ charge_incident: 1, charge_paid: 1, remind: 1 });
    expect(out.halted).toBeUndefined();
    expect(out.halt_skipped).toBeUndefined();
    // 사고 난 행은 토스를 부르지 않고, 다음 후보만 결제됐다
    expect(deps.toss.calls.chargeBillingKey).toHaveLength(1);
    expect(row(sub.id)).toMatchObject({ status: "past_due", dunning_attempts: 1, next_retry_at: pgTime(E - HOUR + INCIDENT_RETRY), grace_until: pgTime(E + 7 * DAY) });
    const own = store.rows.payments.filter((p) => p.subscription_id === sub.id);
    expect(own).toHaveLength(1);
    expect(own[0]).toMatchObject({ status: "failed", failure_code: "DECRYPT_FAILED" });
    expect(row(second.id)).toMatchObject({ status: "active", current_period_start: pgTime(E + 10 * MIN) });
    expect(deps.mailer.sent.map((m) => [m.userId, m.kind])).toEqual([
      [USER2, "receipt"],
      [USER3, "reminder"],
    ]);
    expect(row(third.id).status).toBe("active");
    // 고객 행의 암호문은 지우지 않는다(키를 되돌리면 다시 쓸 수 있다)
    expect(store.rows.customers[0].toss_billing_key_enc).toBe(foreign);
    expect(deps.log).toHaveBeenCalledTimes(1);
    expect(logged(deps)).toContain("DECRYPT_FAILED");
    expect(logged(deps)).not.toContain(BILLING_KEY);
    expect(logged(deps)).not.toContain(foreign);
  });

  it("INVALID_REQUEST는 그 행만의 사고 — 메일 없이 미납·나중에 재시도, 다음 후보는 결제한다", async () => {
    const { deps, store, sub, second, row } = withMore({ chargeBillingKey: [reject("INVALID_REQUEST", "bad body", 400), done] });
    const out = await runBillingCycle(deps, false);
    expect(out).toMatchObject({ charge_incident: 1, charge_paid: 1 });
    expect(out.halted).toBeUndefined();
    expect(row(sub.id)).toMatchObject({ status: "past_due", dunning_attempts: 1, next_retry_at: pgTime(E - HOUR + INCIDENT_RETRY) });
    expect(store.rows.payments.find((p) => p.subscription_id === sub.id)).toMatchObject({ status: "failed", failure_code: "INVALID_REQUEST" });
    expect(row(second.id).current_period_start).toBe(pgTime(E + 10 * MIN));
    expect(deps.mailer.sent.map((m) => m.kind)).toEqual(["receipt"]);
    expect(deps.log).toHaveBeenCalledTimes(1);
    expect(logged(deps)).not.toContain("bad body");
  });

  it("운영 사고 뒤 첫 실제 카드 거절은 실패 메일을 한 번 보낸다", async () => {
    const declined = () => reject("REJECT_CARD_PAYMENT", "한도가 초과됐어요");
    const { deps, store, clock } = setup({ toss: { chargeBillingKey: [reject("INVALID_REQUEST", "bad body", 400), declined(), declined()] } });
    await runBillingCycle(deps, false);
    expect(deps.mailer.sent).toHaveLength(0);

    clock.t = E - HOUR + DAY;
    expect(await runBillingCycle(deps, false)).toMatchObject({ retry_failed: 1 });
    expect(store.rows.subscriptions[0]).toMatchObject({ dunning_attempts: 2, next_retry_at: pgTime(E + 3 * DAY) });
    expect(deps.mailer.sent).toEqual([
      { userId: USER, kind: "failed", data: { planName: "Pro", amount: 1234, currency: "KRW", graceUntil: iso(E + 7 * DAY), needsCardChange: false } },
    ]);

    clock.t = E + 3 * DAY;
    expect(await runBillingCycle(deps, false)).toMatchObject({ retry_failed: 1 });
    expect(deps.mailer.sent).toHaveLength(1);
  });

  it("대사로 확정한 실패 뒤 첫 실제 카드 거절은 실패 메일을 한 번 보낸다", async () => {
    const declined = () => reject("REJECT_CARD_PAYMENT", "한도가 초과됐어요");
    const { deps, clock } = setup({
      toss: { chargeBillingKey: [new TossError("NETWORK", "toss request failed (network)", 0), declined(), declined()], getPaymentByOrderId: [null] },
    });
    await runBillingCycle(deps, false);
    clock.t = E - HOUR + DAY;
    expect(await runBillingCycle(deps, false)).toMatchObject({ reconciled_failed: 1 });
    expect(deps.mailer.sent).toHaveLength(0);

    clock.t = E + DAY;
    expect(await runBillingCycle(deps, false)).toMatchObject({ retry_failed: 1 });
    expect(deps.mailer.sent.map((m) => m.kind)).toEqual(["failed"]);
    clock.t = E + 3 * DAY;
    expect(await runBillingCycle(deps, false)).toMatchObject({ retry_failed: 1 });
    expect(deps.mailer.sent).toHaveLength(1);
  });

  it("한 기간에 실제 거절이 두 번이면 메일은 한 번 — 다음 기간의 첫 거절은 다시 보낸다", async () => {
    const declined = () => reject("REJECT_CARD_PAYMENT", "한도가 초과됐어요");
    const { deps, store, clock, sub } = setup({ toss: { chargeBillingKey: [declined(), declined(), declined()] } });
    await runBillingCycle(deps, false);
    clock.t = E + DAY;
    await runBillingCycle(deps, false);
    expect(deps.mailer.sent).toHaveLength(1);

    // 구독이 다음 기간으로 넘어간 뒤 그 갱신(END2 시작)의 첫 거절 — 지난 기간의 거절 기록은 세지 않는다
    Object.assign(store.rows.subscriptions[0], {
      status: "active",
      current_period_start: pgTime(END),
      current_period_end: pgTime(END2),
      dunning_attempts: 0,
      next_retry_at: null,
      grace_until: null,
    });
    clock.t = Date.parse(END2) - HOUR;
    expect(await chargeSubscription(deps, (await store.getSubscription(sub.id))!, "renewal")).toBe("failed");
    expect(deps.mailer.sent.map((m) => m.kind)).toEqual(["failed", "failed"]);
  });

  it.each<[string, number]>([
    ["NETWORK", 0],
    ["HTTP_503", 503],
  ])("결과 불명(%s %d) → 결제 pending·구독 그대로 → 다음 날 대사 DONE이면 기간 전진", async (code, status) => {
    const { deps, store, clock } = setup({
      toss: { chargeBillingKey: [new TossError(code, "toss error", status)], getPaymentByOrderId: [lookup("DONE")] },
    });

    expect(await runBillingCycle(deps, false)).toMatchObject({ charge_pending: 1 });
    const payment = store.rows.payments[0];
    expect(payment).toMatchObject({ kind: "renewal", status: "pending", attempt: 1 });
    expect(store.rows.subscriptions[0]).toMatchObject({ status: "active", current_period_end: pgTime(END), dunning_attempts: 0, next_retry_at: null });
    expect(deps.mailer.sent).toHaveLength(0);

    // 같은 날 다시 돌려도(10분 안) 대사하지 않고 같은 주기 결제도 다시 보내지 않는다
    clock.t += 5 * MIN;
    expect(await runBillingCycle(deps, false)).toMatchObject({ charge_skipped: 1, reconciled_paid: 0, reconciled_unresolved: 0 });
    expect(deps.toss.calls.getPaymentByOrderId).toHaveLength(0);

    // 다음 날: 대사가 DONE을 확인하고 기간을 전진한다
    clock.t = E - HOUR + DAY;
    expect(await runBillingCycle(deps, false)).toMatchObject({ reconciled_paid: 1, reconciled_failed: 0 });
    expect(deps.toss.calls.getPaymentByOrderId).toEqual([[payment.order_id]]);
    expect(store.rows.subscriptions[0]).toMatchObject({ status: "active", current_period_start: pgTime(END), current_period_end: pgTime(END2) });
    expect(store.rows.payments[0]).toMatchObject({ status: "paid", external_payment_id: `pk_${payment.order_id}` });
    expect(deps.mailer.sent.map((m) => m.kind)).toEqual(["receipt"]);
    expect(deps.toss.calls.chargeBillingKey).toHaveLength(1);
  });

  it("결과 불명 뒤 대사가 ABORTED면 결제 failed(RECONCILED_ABORTED)·미납으로 넘기고, 다음 재시도는 막히지 않는다", async () => {
    const { deps, store, clock } = setup({
      toss: { chargeBillingKey: [new TossError("NETWORK", "toss request failed (network)", 0), done], getPaymentByOrderId: [lookup("ABORTED")] },
    });
    expect(await runBillingCycle(deps, false)).toMatchObject({ charge_pending: 1 });

    clock.t = E - HOUR + DAY;
    expect(await runBillingCycle(deps, false)).toMatchObject({ reconciled_failed: 1 });
    expect(store.rows.payments[0]).toMatchObject({ status: "failed", failure_code: "RECONCILED_ABORTED" });
    expect(store.rows.subscriptions[0]).toMatchObject({
      status: "past_due",
      dunning_attempts: 1,
      next_retry_at: pgTime(E + DAY),
      grace_until: pgTime(E + 7 * DAY),
      current_period_end: pgTime(END),
    });
    // 대사로 확정한 실패는 카드 거절이 아니다 — 사용자 메일 없음
    expect(deps.mailer.sent).toHaveLength(0);

    // 재시도 시각 — 실패한 1번 시도와 다른 2번 시도로 결제한다
    clock.t = E + DAY;
    expect(await runBillingCycle(deps, false)).toMatchObject({ retry_paid: 1 });
    expect(store.rows.subscriptions[0]).toMatchObject({ status: "active", current_period_end: pgTime(END2) });
    expect(store.rows.payments.map((p) => [p.kind, p.attempt, p.status])).toEqual([
      ["renewal", 1, "failed"],
      ["retry", 2, "paid"],
    ]);
  });

  it("DONE이 아닌 응답은 pending으로 남기고 기록한다", async () => {
    const { deps, store } = setup({ toss: { chargeBillingKey: [(bk, req) => ({ ...done(bk, req), status: "IN_PROGRESS" })] } });
    expect(await runBillingCycle(deps, false)).toMatchObject({ charge_pending: 1 });
    expect(store.rows.payments[0].status).toBe("pending");
    expect(store.rows.subscriptions[0]).toMatchObject({ status: "active", current_period_end: pgTime(END) });
    expect(logged(deps)).toContain("IN_PROGRESS");
  });

  it("결제가 승인된 뒤 저장소 오류가 나면 pending — 결제 행은 대사가 확정한다", async () => {
    const { deps, store, sub } = setup({ toss: { chargeBillingKey: [done] } });
    store.updateSubscriptionIf = async () => {
      throw new Error("billing store updateSubscriptionIf: connection reset");
    };
    expect(await chargeSubscription(deps, sub, "renewal")).toBe("pending");
    expect(store.rows.payments[0].status).toBe("pending");
    expect(logged(deps)).toContain("connection reset");
  });

  it("구독을 전진시킨 뒤 결제 확정이 실패하면 pending — 대사가 결제만 paid로 마무리하고 기간을 두 번 전진하지 않는다", async () => {
    const { deps, store, clock, sub } = setup({ toss: { chargeBillingKey: [done], getPaymentByOrderId: [lookup("DONE")] } });
    const realUpdatePayment = store.updatePayment.bind(store);
    store.updatePayment = async () => {
      throw new Error("billing store updatePayment: connection reset");
    };
    expect(await chargeSubscription(deps, sub, "renewal")).toBe("pending");
    // 구독은 먼저 전진했고 결제 행은 pending으로 남았다
    expect(store.rows.subscriptions[0]).toMatchObject({ status: "active", current_period_end: pgTime(END2) });
    expect(store.rows.payments[0].status).toBe("pending");
    expect(deps.mailer.sent).toHaveLength(0);
    store.updatePayment = realUpdatePayment;

    clock.t = E - HOUR + DAY;
    expect(await reconcilePending(deps, false)).toEqual({ paid: 1, failed: 0, unresolved: 0 });
    expect(store.rows.subscriptions[0]).toMatchObject({ current_period_start: pgTime(END), current_period_end: pgTime(END2) });
    expect(store.rows.payments[0]).toMatchObject({ status: "paid", external_payment_id: `pk_${store.rows.payments[0].order_id}` });
    expect(deps.mailer.sent.map((m) => m.kind)).toEqual(["receipt"]);
  });

  it("대사가 DONE을 확인했는데 구독이 그 결제의 기간에 있지 않으면 기간을 바꾸지 않고 운영자 확인을 남긴다", async () => {
    // 지난 주기(START 시작)의 결제가 뒤늦게 확인됐다 — 구독은 이미 END에서 시작하는 주기에 있다
    const { deps, store, sub } = setup({ at: E - 3 * DAY, toss: { getPaymentByOrderId: [lookup("DONE")] } });
    const old = paymentRow({ user_id: USER, kind: "renewal", period_start: iso(NOW - 28 * DAY), period_end: START, requested_at: iso(NOW - 28 * DAY) });
    store.rows.payments.push({ ...old, subscription_id: sub.id, period_start: pgTime(old.period_start!), period_end: pgTime(START), requested_at: pgTime(old.requested_at) });

    expect(await reconcilePending(deps, false)).toEqual({ paid: 1, failed: 0, unresolved: 0 });
    expect(store.rows.payments[0].status).toBe("paid");
    expect(store.rows.subscriptions[0]).toMatchObject({ current_period_start: pgTime(START), current_period_end: pgTime(END) });
    expect(deps.mailer.sent).toHaveLength(0);
    expect(logged(deps)).toContain("needs review");
  });

  it("결제 승인 사이에 구독이 끝났으면 되살리지 않는다 — 결제는 paid, 운영자 확인 기록", async () => {
    const { deps, store, sub } = setup();
    deps.toss.script.chargeBillingKey.push((bk, req) => {
      // 결제 요청이 오가는 사이 다른 요청이 구독을 끝냈다
      Object.assign(store.rows.subscriptions[0], { status: "ended", ended_reason: "user_canceled", ended_at: pgTime(E - HOUR) });
      return done(bk, req);
    });
    expect(await chargeSubscription(deps, sub, "renewal")).toBe("paid");
    expect(store.rows.subscriptions[0]).toMatchObject({ status: "ended", current_period_end: pgTime(END) });
    expect(store.rows.payments[0]).toMatchObject({ status: "paid", external_payment_id: `pk_${store.rows.payments[0].order_id}` });
    expect(logged(deps)).toContain("needs review");
    expect(logged(deps)).toContain(sub.id);
    expect(deps.mailer.sent).toHaveLength(0);
  });

  it("거절 정리 사이에 구독이 끝났으면 덮어쓰지 않고 실패 메일도 보내지 않는다", async () => {
    const { deps, store, sub } = setup();
    deps.toss.script.chargeBillingKey.push(() => {
      Object.assign(store.rows.subscriptions[0], { status: "ended", ended_reason: "user_canceled", ended_at: pgTime(E - HOUR) });
      throw reject("REJECT_CARD_PAYMENT");
    });
    expect(await chargeSubscription(deps, sub, "renewal")).toBe("failed");
    expect(store.rows.subscriptions[0]).toMatchObject({ status: "ended", dunning_attempts: 0, next_retry_at: null });
    expect(store.rows.payments[0]).toMatchObject({ status: "failed", failure_code: "REJECT_CARD_PAYMENT" });
    expect(deps.mailer.sent).toHaveLength(0);
  });

  it("거절이 확정된 뒤 정리 중 오류가 나면 던지고(돈은 움직이지 않음) 결제 행은 대사가 실패로 확정한다", async () => {
    const { deps, store, sub } = setup({ toss: { chargeBillingKey: [reject("REJECT_CARD_PAYMENT")] } });
    store.updateSubscriptionIf = async () => {
      throw new Error("billing store updateSubscriptionIf: connection reset");
    };
    await expect(chargeSubscription(deps, sub, "renewal")).rejects.toThrow("connection reset");
    expect(store.rows.payments[0].status).toBe("pending");
  });

  it("재시도 결제가 토스에서 취소됐으면 기록에 결제 종류(retry)를 적는다", async () => {
    const { deps, store, sub } = setup({
      sub: { status: "past_due", dunning_attempts: 1, next_retry_at: iso(E + DAY), grace_until: iso(E + 7 * DAY) },
      at: E + 2 * DAY,
      toss: { getPaymentByOrderId: [lookup("CANCELED", { totalAmount: 1234, balanceAmount: 0 })] },
    });
    const p = paymentRow({ user_id: USER, kind: "retry", attempt: 2, period_start: END, period_end: END2, requested_at: iso(E + DAY) });
    store.rows.payments.push({ ...p, subscription_id: sub.id, period_start: pgTime(END), period_end: pgTime(END2), requested_at: pgTime(p.requested_at) });
    await reconcilePending(deps, false);
    expect(logged(deps)).toContain("manual check: retry canceled at Toss");
    expect(store.rows.subscriptions[0]).toMatchObject({ status: "past_due", dunning_attempts: 2, next_retry_at: null });
  });

  it("갱신 결제가 토스에서 취소(CANCELED)됐으면 환불로 적고 재시도 없는 미납으로 넘기며 운영자 확인을 남긴다", async () => {
    const { deps, store, clock } = setup({
      toss: { chargeBillingKey: [new TossError("NETWORK", "x", 0)], getPaymentByOrderId: [lookup("CANCELED", { totalAmount: 1234, balanceAmount: 0 })] },
    });
    await runBillingCycle(deps, false);
    clock.t = E - HOUR + DAY;
    deps.log.mockClear();

    expect(await reconcilePending(deps, false)).toEqual({ paid: 0, failed: 1, unresolved: 0 });
    expect(store.rows.payments[0]).toMatchObject({ status: "refunded", refunded_amount: 1234, failure_code: "RECONCILED_CANCELED" });
    // 재시도 없이 미납 — 유예가 끝나면 저절로 끝난다
    expect(store.rows.subscriptions[0]).toMatchObject({
      status: "past_due",
      current_period_end: pgTime(END),
      dunning_attempts: 1,
      next_retry_at: null,
      grace_until: pgTime(E + 7 * DAY),
    });
    expect(deps.mailer.sent).toHaveLength(0);
    expect(logged(deps)).toContain("manual check: renewal canceled at Toss");
    expect(logged(deps)).toContain(store.rows.subscriptions[0].id);

    clock.t = E + 6 * DAY;
    expect(await runBillingCycle(deps, false)).toMatchObject({ none: 1 });
    expect(deps.toss.calls.chargeBillingKey).toHaveLength(1);
    clock.t = E + 7 * DAY;
    expect(await runBillingCycle(deps, false)).toMatchObject({ end_unpaid: 1 });
  });
});

describe("대사 — 첫 결제", () => {
  /** 결과 불명으로 남은 첫 결제(시도 processing)와 그 가격·고객 — 지금은 결제 1시간 뒤 */
  function initial(opts: { checkout?: Partial<CheckoutRow>; payment?: Partial<PaymentRow>; toss?: Partial<TossScript>; rows?: Partial<MemoryRows> } = {}) {
    const clock = { t: NOW + HOUR };
    const now = () => clock.t;
    const price = priceRow();
    const customer = customerRow({ user_id: USER, toss_customer_key: CUSTOMER_KEY, toss_billing_key_enc: "v1:a:b:c" });
    const checkout = checkoutRow({ user_id: USER, price_id: price.id, status: "processing", ...opts.checkout });
    const payment = paymentRow({
      user_id: USER,
      checkout_id: checkout.id,
      kind: "initial",
      period_start: START,
      period_end: END,
      requested_at: iso(NOW),
      ...opts.payment,
    });
    const store = createMemoryStore(
      { prices: [price], customers: [customer], checkouts: [checkout], payments: [payment], ...opts.rows },
      { now },
    );
    const deps = makeDeps({ store, toss: createFakeToss(opts.toss), now });
    return { deps, store, clock, price, checkout, payment };
  }

  it("pending + DONE → 구독 생성·시도 completed·결제 paid·영수증", async () => {
    const { deps, store, price, checkout, payment } = initial({ toss: { getPaymentByOrderId: [lookup("DONE")] } });

    expect(await reconcilePending(deps, false)).toEqual({ paid: 1, failed: 0, unresolved: 0 });

    expect(store.rows.subscriptions).toHaveLength(1);
    const sub = store.rows.subscriptions[0];
    expect(sub).toMatchObject({ user_id: USER, status: "active", price_id: price.id, current_period_start: pgTime(START), current_period_end: pgTime(END), billing_anchor_day: 31 });
    expect(store.rows.payments[0]).toMatchObject({ status: "paid", subscription_id: sub.id, external_payment_id: `pk_${payment.order_id}` });
    expect(store.rows.checkouts[0]).toMatchObject({ id: checkout.id, status: "completed", subscription_id: sub.id });
    expect(deps.mailer.sent.map((m) => m.kind)).toEqual(["receipt"]);
    expect(deps.toss.calls.getPaymentByOrderId).toEqual([[payment.order_id]]);
  });

  it("그 결제로 만든 구독이 이미 있으면 중복 생성·취소 없이 결제만 paid", async () => {
    const { deps, store, price } = initial({ toss: { getPaymentByOrderId: [lookup("DONE")] } });
    // 앞선 실행이 구독까지 만들고 결제 행을 고치기 전에 멈췄다(같은 가격·이 결제의 기간 시작)
    const existing = subscriptionRow({ user_id: USER, price_id: price.id, current_period_start: START, current_period_end: END, billing_anchor_day: 31 });
    store.rows.subscriptions.push({ ...existing, current_period_start: pgTime(START), current_period_end: pgTime(END) });

    expect(await reconcilePending(deps, false)).toEqual({ paid: 1, failed: 0, unresolved: 0 });
    expect(store.rows.subscriptions).toHaveLength(1);
    expect(deps.toss.calls.cancelPayment).toHaveLength(0);
    expect(store.rows.payments[0]).toMatchObject({ status: "paid", subscription_id: existing.id });
    expect(store.rows.checkouts[0]).toMatchObject({ status: "completed", subscription_id: existing.id });
  });

  it("시도가 이미 failed로 닫혔어도(거절 확정 뒤 정리 실패) 토스가 DONE이면 활성화하고 기록한다", async () => {
    const { deps, store, payment, checkout } = initial({ checkout: { status: "failed", failure_code: "error" }, toss: { getPaymentByOrderId: [lookup("DONE")] } });

    expect(await reconcilePending(deps, false)).toEqual({ paid: 1, failed: 0, unresolved: 0 });
    expect(store.rows.subscriptions).toHaveLength(1);
    expect(store.rows.subscriptions[0]).toMatchObject({ user_id: USER, status: "active" });
    expect(store.rows.payments[0]).toMatchObject({ status: "paid", subscription_id: store.rows.subscriptions[0].id });
    // 저장소는 끝난 시도를 다시 열지 않는다 — 운영자가 볼 수 있게 기록만
    expect(store.rows.checkouts[0].status).toBe("failed");
    expect(logged(deps)).toContain(payment.id);
    expect(logged(deps)).toContain(checkout.id);
  });

  it("시도가 failed인데 토스도 결제가 없다고 하면 결제만 failed", async () => {
    const { deps, store } = initial({ checkout: { status: "failed", failure_code: "REJECT_CARD_PAYMENT" }, toss: { getPaymentByOrderId: [null] } });
    expect(await reconcilePending(deps, false)).toEqual({ paid: 0, failed: 1, unresolved: 0 });
    expect(store.rows.payments[0]).toMatchObject({ status: "failed", failure_code: "RECONCILED_NOT_FOUND" });
    expect(store.rows.checkouts[0]).toMatchObject({ status: "failed", failure_code: "REJECT_CARD_PAYMENT" });
    expect(store.rows.subscriptions).toHaveLength(0);
  });

  it.each(["ABORTED", "EXPIRED"])("%s → 결제 failed·시도 failed, 구독 없음", async (status) => {
    const { deps, store } = initial({ toss: { getPaymentByOrderId: [lookup(status)] } });
    expect(await reconcilePending(deps, false)).toEqual({ paid: 0, failed: 1, unresolved: 0 });
    expect(store.rows.payments[0]).toMatchObject({ status: "failed", failure_code: `RECONCILED_${status}` });
    expect(store.rows.checkouts[0]).toMatchObject({ status: "failed", failure_code: `RECONCILED_${status}` });
    expect(store.rows.subscriptions).toHaveLength(0);
    expect(deps.mailer.sent).toHaveLength(0);
  });

  it("토스에 주문이 없으면(null) RECONCILED_NOT_FOUND", async () => {
    const { deps, store } = initial({ toss: { getPaymentByOrderId: [null] } });
    expect(await reconcilePending(deps, false)).toEqual({ paid: 0, failed: 1, unresolved: 0 });
    expect(store.rows.payments[0]).toMatchObject({ status: "failed", failure_code: "RECONCILED_NOT_FOUND" });
    expect(store.rows.checkouts[0]).toMatchObject({ status: "failed" });
  });

  it("CANCELED → refunded(응답의 취소액)·구독 없음·시도 failed", async () => {
    const { deps, store, payment } = initial({ toss: { getPaymentByOrderId: [lookup("CANCELED", { totalAmount: 1234, balanceAmount: 0 })] } });
    expect(await reconcilePending(deps, false)).toEqual({ paid: 0, failed: 1, unresolved: 0 });
    expect(store.rows.payments[0]).toMatchObject({
      status: "refunded",
      refunded_amount: 1234,
      failure_code: "RECONCILED_CANCELED",
      external_payment_id: `pk_${payment.order_id}`,
    });
    expect(store.rows.subscriptions).toHaveLength(0);
    expect(store.rows.checkouts[0]).toMatchObject({ status: "failed", failure_code: "RECONCILED_CANCELED" });
    expect(deps.mailer.sent).toHaveLength(0);
    expect(logged(deps)).toContain(payment.id);
  });

  it("PARTIAL_CANCELED → partially_refunded, 취소액 = 결제액 − 남은 금액", async () => {
    const { deps, store } = initial({ toss: { getPaymentByOrderId: [lookup("PARTIAL_CANCELED", { totalAmount: 1234, balanceAmount: 734 })] } });
    expect(await reconcilePending(deps, false)).toEqual({ paid: 0, failed: 1, unresolved: 0 });
    expect(store.rows.payments[0]).toMatchObject({ status: "partially_refunded", refunded_amount: 500 });
    expect(store.rows.subscriptions).toHaveLength(0);
  });

  it("CANCELED인데 응답에 남은 금액이 없으면 결제 금액 전액을 환불액으로 적는다", async () => {
    const { deps, store } = initial({ toss: { getPaymentByOrderId: [lookup("CANCELED", { balanceAmount: null })] } });
    await reconcilePending(deps, false);
    expect(store.rows.payments[0]).toMatchObject({ status: "refunded", refunded_amount: 1234 });
  });

  it("CANCELED인데 응답에 결제액이 없으면(0으로 읽힘) 0이 아니라 결제 금액 전액을 적는다", async () => {
    const { deps, store } = initial({ toss: { getPaymentByOrderId: [lookup("CANCELED", { totalAmount: 0, balanceAmount: 0 })] } });
    await reconcilePending(deps, false);
    expect(store.rows.payments[0]).toMatchObject({ status: "refunded", refunded_amount: 1234 });
  });

  it.each<[string, TossScript["getPaymentByOrderId"][number]]>([
    ["처음 보는 상태(constructor)", lookup("constructor")],
    ["진행 중(IN_PROGRESS)", lookup("IN_PROGRESS")],
    ["조회 연결 실패(NETWORK)", new TossError("NETWORK", "toss request failed (network)", 0)],
    ["조회 5xx", new TossError("HTTP_503", "toss error", 503)],
    ["조회 권한 오류(401)", new TossError("UNAUTHORIZED_KEY", "bad key", 401)],
  ])("확정할 수 없으면 그대로 둔다 — %s", async (_name, step) => {
    const { deps, store } = initial({ toss: { getPaymentByOrderId: [step] } });
    expect(await reconcilePending(deps, false)).toEqual({ paid: 0, failed: 0, unresolved: 1 });
    expect(store.rows.payments[0].status).toBe("pending");
    expect(store.rows.checkouts[0].status).toBe("processing");
    expect(store.rows.payments[0].failure_code).toBeNull();
    expect(store.rows.subscriptions).toHaveLength(0);
    // 일부러 남겨 둔 것 — 처리 중 예외로 남은 것과 구분된다
    expect(logged(deps)).toContain("left pending");
  });

  it("10분이 안 된 pending은 조회하지 않는다(결제 요청이 아직 진행 중일 수 있다)", async () => {
    const { deps, store, clock } = initial({ payment: { requested_at: iso(NOW) } });
    clock.t = NOW + 9 * MIN;
    expect(await reconcilePending(deps, false)).toEqual({ paid: 0, failed: 0, unresolved: 0 });
    expect(deps.toss.calls.getPaymentByOrderId).toHaveLength(0);
    expect(store.rows.payments[0].status).toBe("pending");
  });

  it("다른 모드의 pending은 건드리지 않는다", async () => {
    const { deps } = initial({ payment: { livemode: true } });
    expect(await reconcilePending(deps, false)).toEqual({ paid: 0, failed: 0, unresolved: 0 });
    expect(deps.toss.calls.getPaymentByOrderId).toHaveLength(0);
  });
});

describe("해지·종료", () => {
  it("해지 예약 만료 → ended(user_canceled)·빌링키 지움·종료 메일, 결제 없음", async () => {
    const { deps, store } = setup({ sub: { cancel_at_period_end: true, canceled_at: iso(NOW + DAY) }, at: E });
    expect(await runBillingCycle(deps, false)).toMatchObject({ end_canceled: 1 });
    expect(store.rows.subscriptions[0]).toMatchObject({ status: "ended", ended_reason: "user_canceled", ended_at: pgTime(E) });
    expect(store.rows.customers[0]).toMatchObject({ toss_billing_key_enc: null, toss_card_summary: null });
    expect(deps.mailer.sent).toEqual([{ userId: USER, kind: "ended", data: { planName: "Pro", reason: "canceled" } }]);
    expect(tossCalls(deps)).toBe(0);
    expect(store.rows.payments).toHaveLength(0);
  });

  it("해지 예약 중에는 갱신 시점에도 결제하지 않는다", async () => {
    const { deps, store } = setup({ sub: { cancel_at_period_end: true }, at: E - HOUR });
    expect(await runBillingCycle(deps, false)).toMatchObject({ none: 1 });
    expect(tossCalls(deps)).toBe(0);
    expect(store.rows.subscriptions[0].status).toBe("active");
  });

  it("끝내기 직전에 다시 읽어 그 사이 상태가 바뀌었으면(카드 변경 재결제 성공) 끝내지 않는다", async () => {
    const { deps, store, sub } = setup({
      sub: { status: "past_due", dunning_attempts: 4, next_retry_at: null, grace_until: iso(E + 7 * DAY) },
      at: E + 7 * DAY,
    });
    const stale = await store.listCycleCandidates(false, iso(E + 7 * DAY), 10);
    // 후보를 읽은 뒤 다른 요청이 결제에 성공해 기간이 전진했다
    await store.updateSubscription(sub.id, {
      status: "active",
      current_period_start: END,
      current_period_end: END2,
      dunning_attempts: 0,
      next_retry_at: null,
      grace_until: null,
    });
    store.listCycleCandidates = async () => stale;

    expect(await runBillingCycle(deps, false)).toMatchObject({ changed: 1 });
    expect(store.rows.subscriptions[0]).toMatchObject({ status: "active", current_period_end: pgTime(END2) });
    expect(store.rows.customers[0].toss_billing_key_enc).toMatch(/^v1:/);
    expect(deps.mailer.sent).toHaveLength(0);
  });

  it("다시 읽은 직후에 바뀌어도(경합) 조건부 종료가 막는다 — 빌링키도 남긴다", async () => {
    const { deps, store, sub } = setup({
      sub: { status: "past_due", dunning_attempts: 4, next_retry_at: null, grace_until: iso(E + 7 * DAY) },
      at: E + 7 * DAY,
    });
    const realGet = store.getSubscription.bind(store);
    store.getSubscription = async (id) => {
      const read = await realGet(id);
      // 다시 읽은 바로 뒤 카드 변경 재결제가 성공해 기간이 전진했다
      await store.updateSubscription(sub.id, { status: "active", current_period_start: END, current_period_end: END2, dunning_attempts: 0, grace_until: null });
      return read;
    };
    expect(await runBillingCycle(deps, false)).toMatchObject({ changed: 1 });
    expect(store.rows.subscriptions[0]).toMatchObject({ status: "active", current_period_end: pgTime(END2) });
    expect(store.rows.customers[0].toss_billing_key_enc).toMatch(/^v1:/);
    expect(deps.mailer.sent).toHaveLength(0);
  });

  it("해지 예약 만료를 판정한 뒤 사용자가 해지를 취소했으면(재개) 끝내지 않는다", async () => {
    const { deps, store, sub } = setup({ sub: { cancel_at_period_end: true, canceled_at: iso(NOW + DAY) }, at: E });
    const realGet = store.getSubscription.bind(store);
    store.getSubscription = async (id) => {
      const read = await realGet(id);
      // 다시 읽은 바로 뒤 해지 취소(재개)가 들어왔다
      await store.updateSubscription(sub.id, { cancel_at_period_end: false, canceled_at: null });
      return read;
    };
    expect(await runBillingCycle(deps, false)).toMatchObject({ changed: 1 });
    expect(store.rows.subscriptions[0]).toMatchObject({ status: "active", cancel_at_period_end: false });
    expect(store.rows.customers[0].toss_billing_key_enc).toMatch(/^v1:/);
    expect(deps.mailer.sent).toHaveLength(0);
  });

  it("종료 뒤 빌링키 정리가 실패하면 기록만 남기고 종료·메일은 그대로", async () => {
    const { deps, store, sub, enc } = setup({ sub: { cancel_at_period_end: true, canceled_at: iso(NOW + DAY) }, at: E });
    store.clearCustomerKeyIf = async () => {
      throw new Error("billing store clearCustomerKeyIf: connection reset");
    };
    expect(await runBillingCycle(deps, false)).toMatchObject({ end_canceled: 1, errors: 0 });
    expect(store.rows.subscriptions[0]).toMatchObject({ status: "ended", ended_reason: "user_canceled" });
    expect(deps.mailer.sent.map((m) => m.kind)).toEqual(["ended"]);
    const text = logged(deps);
    expect(text).toContain("needs review: key cleanup");
    expect(text).toContain(sub.id);
    expect(text).not.toContain(enc);
  });

  it("10분이 안 된 pending 결제(카드 변경 재결제 진행 중)가 있으면 유예가 끝나도 끝내지 않는다", async () => {
    const { deps, store, sub } = setup({
      sub: { status: "past_due", dunning_attempts: 4, next_retry_at: null, grace_until: iso(E + 7 * DAY) },
      at: E + 7 * DAY,
    });
    const fresh = paymentRow({ user_id: USER, kind: "retry", attempt: 5, period_start: END, period_end: END2, requested_at: iso(E + 7 * DAY - 2 * MIN) });
    store.rows.payments.push({ ...fresh, subscription_id: sub.id, period_start: pgTime(END), period_end: pgTime(END2), requested_at: pgTime(fresh.requested_at) });

    expect(await runBillingCycle(deps, false)).toMatchObject({ reconciled_unresolved: 0, held: 1 });
    expect(deps.toss.calls.getPaymentByOrderId).toHaveLength(0);
    expect(store.rows.subscriptions[0].status).toBe("past_due");
    expect(store.rows.customers[0].toss_billing_key_enc).toMatch(/^v1:/);
    expect(deps.mailer.sent).toHaveLength(0);
  });

  it("결과를 모르는 결제가 남은 구독은 유예가 끝나도 끝내지 않고 다음 날로 미룬다", async () => {
    const pendingRetry = paymentRow({
      user_id: USER,
      kind: "retry",
      attempt: 5,
      period_start: END,
      period_end: END2,
      requested_at: iso(E + 6 * DAY),
    });
    const { deps, store, sub } = setup({
      sub: { status: "past_due", dunning_attempts: 4, next_retry_at: null, grace_until: iso(E + 7 * DAY) },
      at: E + 7 * DAY,
      toss: { getPaymentByOrderId: [new TossError("NETWORK", "toss request failed (network)", 0)] },
    });
    store.rows.payments.push({ ...pendingRetry, subscription_id: sub.id, requested_at: pgTime(pendingRetry.requested_at) });

    expect(await runBillingCycle(deps, false)).toMatchObject({ reconciled_unresolved: 1, held: 1 });
    expect(store.rows.subscriptions[0].status).toBe("past_due");
    expect(store.rows.customers[0].toss_billing_key_enc).toMatch(/^v1:/);
  });
});

describe("결제 예정 안내", () => {
  it("월간 D-7에 한 번만 보낸다 — 두 번째 실행은 none", async () => {
    const { deps, store, clock } = setup({ at: E - 7 * DAY });
    store.rows.prices[0].amount = 9900;

    expect(await runBillingCycle(deps, false)).toMatchObject({ remind: 1 });
    // 결제는 기간 끝 하루 전부터 시도한다 — 안내한 날보다 먼저 청구되지 않게 가장 이른 시각을 적는다
    expect(deps.mailer.sent).toEqual([
      { userId: USER, kind: "reminder", data: { planName: "Pro", amount: 1234, currency: "KRW", chargeAt: iso(E - DAY) } },
    ]);
    // 저장소는 +00:00으로, 흐름은 Z로 쓴다 — 시각 비교라 같은 값이다
    expect(store.rows.subscriptions[0].reminder_sent_for).toBe(pgTime(END));

    expect(await runBillingCycle(deps, false)).toMatchObject({ none: 1 });
    clock.t = E - 2 * DAY;
    expect(await runBillingCycle(deps, false)).toMatchObject({ none: 1 });
    expect(deps.mailer.sent).toHaveLength(1);
    expect(tossCalls(deps)).toBe(0);
  });

  it("두 크론이 겹쳐도 안내는 한 번 — 먼저 기록(선점)한 쪽만 보낸다", async () => {
    const { deps, store } = setup({ at: E - 7 * DAY });
    const [a, b] = await Promise.all([runBillingCycle(deps, false), runBillingCycle(deps, false)]);
    expect(deps.mailer.sent).toHaveLength(1);
    expect([a.remind ?? 0, b.remind ?? 0].sort()).toEqual([0, 1]);
    expect(store.rows.subscriptions[0].reminder_sent_for).toBe(pgTime(END));
  });

  it("연간은 D-30에 보낸다", async () => {
    const { deps } = setup({ sub: { interval: "year", current_period_end: YEAR_END }, at: YE - 30 * DAY });
    expect(await runBillingCycle(deps, false)).toMatchObject({ remind: 1 });
    expect(deps.mailer.sent[0]).toMatchObject({ kind: "reminder", data: { chargeAt: iso(YE - DAY) } });
  });

  it("갱신 뒤에는 다음 기간 안내를 다시 보낸다", async () => {
    const { deps, store, clock } = setup({ at: E - 7 * DAY, toss: { chargeBillingKey: [done] } });
    await runBillingCycle(deps, false);
    clock.t = E - HOUR;
    await runBillingCycle(deps, false);
    expect(store.rows.subscriptions[0].reminder_sent_for).toBeNull();
    clock.t = Date.parse(END2) - 7 * DAY;
    expect(await runBillingCycle(deps, false)).toMatchObject({ remind: 1 });
    expect(deps.mailer.sent.map((m) => m.kind)).toEqual(["reminder", "receipt", "reminder"]);
  });
});

describe("runBillingCycle — 예산·오류 격리", () => {
  /** 기간 끝이 다른 두 구독(먼저 끝나는 쪽이 먼저 처리된다) */
  const twoDue = (toss: Partial<TossScript>) => withMore(toss);

  it("예산을 넘기면 멈추고 남은 후보는 다음 날로 미룬다", async () => {
    const holder: { clock?: { t: number } } = {};
    const slow = (bk: string, req: { orderId: string; amount: number }) => {
      // 결제 한 건이 250초 걸린다
      holder.clock!.t += 250_000;
      return done(bk, req);
    };
    const { deps, store, clock, second } = twoDue({ chargeBillingKey: [slow, slow] });
    holder.clock = clock;

    expect(await runBillingCycle(deps, false)).toMatchObject({ candidates: 2, charge_paid: 1, deferred: 1 });
    expect(deps.toss.calls.chargeBillingKey).toHaveLength(1);
    expect(store.rows.subscriptions.find((s) => s.id === second.id)).toMatchObject({ status: "active", current_period_end: pgTime(E + 10 * MIN) });
  });

  it("budgetMs·limit 옵션을 따른다", async () => {
    const { deps } = twoDue({ chargeBillingKey: [done, done] });
    expect(await runBillingCycle(deps, false, { limit: 1 })).toMatchObject({ candidates: 1, charge_paid: 1 });
    expect(await runBillingCycle(deps, false, { budgetMs: 0 })).toMatchObject({ candidates: 1, deferred: 1 });
  });

  it("한 건의 예외는 기록하고 다음 건으로 넘어간다 — 남은 결제 행은 다음 날 대사가 정리한다", async () => {
    const { deps, store, clock, sub } = twoDue({ chargeBillingKey: [done], getPaymentByOrderId: [null] });
    const realGetCustomer = store.getCustomer.bind(store);
    store.getCustomer = async (userId, livemode) => {
      if (userId === USER) throw new Error("billing store getCustomer: connection reset");
      return realGetCustomer(userId, livemode);
    };

    expect(await runBillingCycle(deps, false)).toMatchObject({ candidates: 2, errors: 1, charge_paid: 1 });
    expect(logged(deps)).toContain(sub.id);
    expect(logged(deps)).toContain("connection reset");
    const stuck = store.rows.payments.find((p) => p.subscription_id === sub.id)!;
    expect(stuck.status).toBe("pending");

    // 다음 날: 토스에 주문이 없으니 실패로 확정하고 미납으로 넘긴다(같은 시도에 영영 막히지 않는다)
    store.getCustomer = realGetCustomer;
    clock.t += DAY;
    expect(await runBillingCycle(deps, false)).toMatchObject({ reconciled_failed: 1 });
    expect(store.rows.payments.find((p) => p.id === stuck.id)).toMatchObject({ status: "failed", failure_code: "RECONCILED_NOT_FOUND" });
    expect(store.rows.subscriptions.find((s) => s.id === sub.id)).toMatchObject({ status: "past_due", dunning_attempts: 1 });
  });

  it("다른 모드(livemode)의 구독은 건드리지 않는다", async () => {
    const { deps, store } = setup({ sub: { livemode: true } });
    expect(await runBillingCycle(deps, false)).toMatchObject({ candidates: 0 });
    expect(tossCalls(deps)).toBe(0);
    expect(store.rows.payments).toHaveLength(0);
  });
});

describe("결제 크론 라우트", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    createBillingDeps.mockReset();
    withCronRun.mockClear();
  });
  const call = (authorization?: string) =>
    GET(new Request("https://www.a11ychk.com/api/cron/billing", { headers: authorization ? { authorization } : {} }));

  it("CRON_SECRET이 틀리면 401이고 실행 기록도 남기지 않는다", async () => {
    vi.stubEnv("CRON_SECRET", "cron-secret-value");
    expect((await call("Bearer wrong")).status).toBe(401);
    expect((await call()).status).toBe(401);
    expect(withCronRun).not.toHaveBeenCalled();
  });

  it("모드가 off면 처리 없이 기록만 남긴다", async () => {
    vi.stubEnv("CRON_SECRET", "cron-secret-value");
    vi.stubEnv("BILLING_MODE", "off");
    const res = await call("Bearer cron-secret-value");
    expect(await res.json()).toEqual({ skipped: "off" });
    expect(withCronRun).toHaveBeenCalledWith("billing", expect.any(Function));
    expect(createBillingDeps).not.toHaveBeenCalled();
  });

  it("모드가 켜졌는데 키가 없으면 실패로 기록한다(상호 감시가 알리게)", async () => {
    vi.stubEnv("CRON_SECRET", "cron-secret-value");
    vi.stubEnv("BILLING_MODE", "test");
    vi.stubEnv("TOSS_SECRET_KEY", "test_sk_x");
    createBillingDeps.mockReturnValue(null);
    await expect(call("Bearer cron-secret-value")).rejects.toThrow("billing cron not configured");
    // 예외가 withCronRun 안에서 나야 cron_runs에 ok=false로 남는다
    expect(withCronRun).toHaveBeenCalledWith("billing", expect.any(Function));
    await expect(withCronRun.mock.results[0].value).rejects.toThrow("billing cron not configured");
  });

  it("test 모드는 테스트 결제 행(livemode=false)만 돈다", async () => {
    vi.stubEnv("CRON_SECRET", "cron-secret-value");
    vi.stubEnv("BILLING_MODE", "test");
    vi.stubEnv("TOSS_SECRET_KEY", "test_sk_x");
    const { deps, store } = setup({ toss: { chargeBillingKey: [done] } });
    store.rows.subscriptions.push(subscriptionRow({ user_id: USER2, livemode: true, current_period_start: START, current_period_end: pgTime(E) }));
    createBillingDeps.mockReturnValue(deps);

    const body = await (await call("Bearer cron-secret-value")).json();
    expect(body).toMatchObject({ candidates: 1, charge_paid: 1 });
    expect(store.rows.subscriptions.find((s) => s.livemode)).toMatchObject({ status: "active", current_period_end: pgTime(E) });
  });
});
