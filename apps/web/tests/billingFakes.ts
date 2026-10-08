/**
 * 결제 흐름 테스트용 가짜 구현 — 메모리 저장소·가짜 토스·가짜 메일러.
 * vitest include가 *.test.ts라 이 파일 자체는 실행되지 않는다.
 *
 * 메모리 저장소는 0041의 유니크·check 제약을 흉내낸다. 위반 시 Supabase 저장소(store.ts)와 같게
 * insert는 표지값("duplicate"·"hasActive")을, update는 "billing store <메서드>: ..." 오류를 낸다.
 * 모든 읽기·쓰기는 structuredClone 사본을 주고받는다 — 호출부가 돌려받은 객체를 고쳐도
 * 저장소가 바뀌지 않는다(실제 DB와 같다). 상태 검사는 store.rows로 한다.
 * timestamptz 열은 PostgREST가 돌려주는 모양(2026-01-30T16:00:00+00:00)으로 저장·반환한다 —
 * 흐름이 시각을 문자열로 비교하는 실수를 테스트가 잡게. 저장소 안의 비교는 Date.parse로 한다.
 */
import { randomBytes, randomUUID } from "node:crypto";
import { vi, type Mock } from "vitest";
import { TossError, type TossBillingAuth, type TossClient, type TossPayment } from "../src/lib/billing/toss";
import type {
  BillingDeps,
  BillingEmailKind,
  BillingMailer,
  BillingStore,
  CheckoutRow,
  CustomerRow,
  PaymentRow,
  PriceRow,
  SubscriptionRow,
  TossCustomerRow,
} from "../src/lib/billing/types";

/** 2026-01-31 01:00 KST — 앵커 31일(짧은 달 말일로 당겨지는 경우)을 기본으로 시험한다 */
export const NOW = Date.parse("2026-01-30T16:00:00.000Z");
export const MIN = 60_000;
export const DAY = 86_400_000;
export const iso = (t: number) => new Date(t).toISOString();

export interface ConsentRow {
  id: string;
  user_id: string | null;
  checkout_id: string | null;
  subscription_id: string | null;
  kind: "recurring_payment" | "price_change" | "terms";
  /** 결제 시작 흐름이 쓰는 열 — 테스트가 직접 넣는 행은 비워도 된다 */
  disclosure_version?: string;
  snapshot?: Record<string, unknown>;
}

export interface MemoryRows {
  prices: PriceRow[];
  customers: CustomerRow[];
  checkouts: CheckoutRow[];
  subscriptions: SubscriptionRow[];
  payments: PaymentRow[];
  consents: ConsentRow[];
}

export type MemoryStore = BillingStore & { rows: MemoryRows };

const LIVE = new Set<SubscriptionRow["status"]>(["active", "past_due"]);
const ATTEMPT_KINDS = new Set<PaymentRow["kind"]>(["renewal", "retry"]);
const CLAIMABLE_END = new Set<CheckoutRow["status"]>(["open", "processing"]);

const clone = <T>(v: T): T => structuredClone(v);

/**
 * PostgREST(UTC 세션)의 timestamptz 표기 — 초 아래가 0이면 생략하고, 있으면 뒤 0을 뺀다.
 * 예: 2026-01-30T16:00:00+00:00, 2026-01-30T16:00:05.12+00:00
 */
export function pgTime(v: string | number): string {
  const t = typeof v === "number" ? v : Date.parse(v);
  if (Number.isNaN(t)) return String(v);
  const [base, frac] = new Date(t).toISOString().slice(0, -1).split(".");
  const trimmed = (frac ?? "").replace(/0+$/, "");
  return `${base}${trimmed ? `.${trimmed}` : ""}+00:00`;
}

const CHECKOUT_TIMES = ["expires_at"] as const;
const SUBSCRIPTION_TIMES = [
  "current_period_start",
  "current_period_end",
  "canceled_at",
  "ended_at",
  "next_retry_at",
  "grace_until",
  "reminder_sent_for",
] as const;
const PAYMENT_TIMES = ["period_start", "period_end", "requested_at", "approved_at"] as const;

function withPgTimes<T extends object>(row: T, fields: readonly string[]): T {
  const r = row as Record<string, unknown>;
  for (const f of fields) if (typeof r[f] === "string") r[f] = pgTime(r[f] as string);
  return row;
}
/** 반환용 사본 — 테스트가 store.rows에 직접 넣은 행도 DB 모양으로 나간다 */
const outCheckout = (c: CheckoutRow) => withPgTimes(clone(c), CHECKOUT_TIMES);
const outSubscription = (s: SubscriptionRow) => withPgTimes(clone(s), SUBSCRIPTION_TIMES);
const outPayment = (p: PaymentRow) => withPgTimes(clone(p), PAYMENT_TIMES);
/** timestamptz 비교 — 저장 형식(+00:00·Z)이 달라도 같은 시각이면 같다 */
const sameInstant = (a: string | null, b: string | null) => a !== null && b !== null && Date.parse(a) === Date.parse(b);
/** PostgREST는 undefined 키를 보내지 않는다 — 메모리에서도 덮어쓰지 않는다 */
function defined<T extends object>(patch: T): Partial<T> {
  return Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)) as Partial<T>;
}

function storeError(method: string, message: string): Error {
  return new Error(`billing store ${method}: ${message}`);
}

/** subscriptions_one_live_per_user — user_id NULL끼리는 충돌하지 않는다 */
function liveConflict(rows: SubscriptionRow[], s: SubscriptionRow): boolean {
  return (
    s.user_id !== null &&
    LIVE.has(s.status) &&
    rows.some((o) => o.id !== s.id && o.user_id === s.user_id && o.livemode === s.livemode && LIVE.has(o.status))
  );
}

function checkSubscription(method: string, s: SubscriptionRow) {
  if (!(Date.parse(s.current_period_end) > Date.parse(s.current_period_start))) throw storeError(method, "period check violation");
  if (s.billing_anchor_day !== null && (s.billing_anchor_day < 1 || s.billing_anchor_day > 31)) {
    throw storeError(method, "billing_anchor_day check violation");
  }
  if (s.amount < 0) throw storeError(method, "amount check violation");
}

/** order_id 유니크, (provider, external_payment_id) 유니크, billing_payments_one_per_attempt */
function paymentConflict(rows: PaymentRow[], p: PaymentRow): boolean {
  return rows.some(
    (o) =>
      o.id !== p.id &&
      (o.order_id === p.order_id ||
        (p.external_payment_id !== null && o.provider === p.provider && o.external_payment_id === p.external_payment_id) ||
        (ATTEMPT_KINDS.has(p.kind) &&
          ATTEMPT_KINDS.has(o.kind) &&
          o.subscription_id === p.subscription_id &&
          sameInstant(o.period_start, p.period_start) &&
          o.attempt === p.attempt)),
  );
}

function checkPayment(method: string, p: PaymentRow) {
  if (ATTEMPT_KINDS.has(p.kind) && (p.subscription_id === null || p.period_start === null)) {
    throw storeError(method, "renewal/retry payment needs subscription and period");
  }
  if (p.amount < 0) throw storeError(method, "amount check violation");
  if (p.refunded_amount < 0) throw storeError(method, "refunded_amount check violation");
}

export function createMemoryStore(seed: Partial<MemoryRows> = {}, opts: { now?: () => number } = {}): MemoryStore {
  const now = opts.now ?? Date.now;
  const rows: MemoryRows = {
    prices: clone(seed.prices ?? []),
    customers: clone(seed.customers ?? []),
    checkouts: clone(seed.checkouts ?? []).map((c) => withPgTimes(c, CHECKOUT_TIMES)),
    subscriptions: clone(seed.subscriptions ?? []).map((s) => withPgTimes(s, SUBSCRIPTION_TIMES)),
    payments: clone(seed.payments ?? []).map((p) => withPgTimes(p, PAYMENT_TIMES)),
    consents: clone(seed.consents ?? []),
  };
  const found = <T extends { id: string }>(list: T[], id: string) => list.find((r) => r.id === id);

  return {
    rows,

    async claimCheckout(id, userId, livemode, nowIso) {
      const c = rows.checkouts.find(
        (r) =>
          r.id === id && r.user_id === userId && r.livemode === livemode && r.status === "open" && Date.parse(r.expires_at) > Date.parse(nowIso),
      );
      if (!c) return null;
      c.status = "processing";
      return outCheckout(c);
    },

    async insertCheckout(row) {
      const c: CheckoutRow = withPgTimes({ ...clone(row), id: randomUUID(), status: "open", failure_code: null }, CHECKOUT_TIMES);
      rows.checkouts.push(c);
      return outCheckout(c);
    },

    async listUnfinishedCheckouts(userId, livemode) {
      return rows.checkouts.filter((c) => c.user_id === userId && c.livemode === livemode && CLAIMABLE_END.has(c.status)).map(outCheckout);
    },

    async expireCheckouts(ids, from, failureCode) {
      for (const c of rows.checkouts) {
        if (!ids.includes(c.id) || c.status !== from) continue;
        c.status = "expired";
        if (failureCode !== null) c.failure_code = failureCode;
      }
    },

    async insertConsent(row) {
      rows.consents.push({ ...clone(row), id: randomUUID(), subscription_id: null });
    },

    async getCheckout(id) {
      const c = found(rows.checkouts, id);
      return c ? outCheckout(c) : null;
    },

    async finishCheckout(id, patch) {
      const c = found(rows.checkouts, id);
      if (!c || !CLAIMABLE_END.has(c.status)) return;
      Object.assign(c, defined(clone(patch)));
    },

    async getPrice(id) {
      const p = found(rows.prices, id);
      return p ? clone(p) : null;
    },

    async getCustomer(userId, livemode) {
      const c = rows.customers.find((r) => r.user_id === userId && r.livemode === livemode);
      return c ? clone(c) : null;
    },

    async ensureCustomer(userId, livemode, newCustomerKey) {
      let c = rows.customers.find((r) => r.user_id === userId && r.livemode === livemode);
      // toss_customer_key 유니크 — 다른 행이 같은 키를 쓰면 DB처럼 거부한다
      const keyTaken = () => rows.customers.some((r) => r.toss_customer_key === newCustomerKey);
      if (!c) {
        if (keyTaken()) throw storeError("ensureCustomer", "duplicate key value violates unique constraint");
        c = { id: randomUUID(), user_id: userId, livemode, toss_customer_key: newCustomerKey, toss_billing_key_enc: null, toss_card_summary: null };
        rows.customers.push(c);
      } else if (!c.toss_customer_key) {
        if (keyTaken()) throw storeError("ensureCustomer", "duplicate key value violates unique constraint");
        c.toss_customer_key = newCustomerKey;
      }
      return clone(c) as TossCustomerRow;
    },

    async updateCustomer(id, patch) {
      // 0041 check: 암호문은 v1: 접두만 — 평문 빌링키가 들어오면 DB처럼 거부한다
      if (patch.toss_billing_key_enc !== null && !patch.toss_billing_key_enc.startsWith("v1:")) {
        throw storeError("updateCustomer", "toss_billing_key_enc check violation");
      }
      const c = found(rows.customers, id);
      if (c) Object.assign(c, clone(patch));
    },

    async clearCustomerKeyIf(customerId, expectedEnc) {
      const c = found(rows.customers, customerId);
      if (!c || c.toss_billing_key_enc !== expectedEnc) return false;
      c.toss_billing_key_enc = null;
      c.toss_card_summary = null;
      return true;
    },

    async insertPayment(row) {
      const p: PaymentRow = {
        ...clone(row),
        id: randomUUID(),
        requested_at: iso(now()),
        external_payment_id: null,
        failure_code: null,
        failure_message: null,
        receipt_url: null,
        card_summary: null,
        refunded_amount: 0,
        approved_at: null,
      };
      withPgTimes(p, PAYMENT_TIMES);
      checkPayment("insertPayment", p);
      if (paymentConflict(rows.payments, p)) return "duplicate";
      rows.payments.push(p);
      return outPayment(p);
    },

    async updatePayment(id, patch) {
      const p = found(rows.payments, id);
      if (!p) return;
      const next: PaymentRow = withPgTimes({ ...p, ...defined(clone(patch)) }, PAYMENT_TIMES);
      checkPayment("updatePayment", next);
      if (paymentConflict(rows.payments, next)) throw storeError("updatePayment", "duplicate key value violates unique constraint");
      Object.assign(p, next);
    },

    async getSubscription(id) {
      const s = found(rows.subscriptions, id);
      return s ? outSubscription(s) : null;
    },

    async getLiveSubscription(userId, livemode) {
      const s = rows.subscriptions.find((r) => r.user_id === userId && r.livemode === livemode && LIVE.has(r.status));
      return s ? outSubscription(s) : null;
    },

    async insertSubscription(row) {
      const s: SubscriptionRow = {
        ...clone(row),
        id: randomUUID(),
        status: "active",
        ended_reason: null,
        cancel_at_period_end: false,
        canceled_at: null,
        ended_at: null,
        dunning_attempts: 0,
        next_retry_at: null,
        grace_until: null,
        reminder_sent_for: null,
      };
      withPgTimes(s, SUBSCRIPTION_TIMES);
      checkSubscription("insertSubscription", s);
      if (liveConflict(rows.subscriptions, s)) return "hasActive";
      rows.subscriptions.push(s);
      return outSubscription(s);
    },

    async updateSubscription(id, patch) {
      const s = found(rows.subscriptions, id);
      if (!s) return;
      const next: SubscriptionRow = withPgTimes({ ...s, ...defined(clone(patch)) }, SUBSCRIPTION_TIMES);
      checkSubscription("updateSubscription", next);
      if (liveConflict(rows.subscriptions, next)) throw storeError("updateSubscription", "duplicate key value violates unique constraint");
      Object.assign(s, next);
    },

    async updateSubscriptionIf(id, expected, patch) {
      const s = found(rows.subscriptions, id);
      if (!s) return false;
      if (!(expected.statuses as string[]).includes(s.status)) return false;
      if (expected.currentPeriodEnd !== undefined && !sameInstant(s.current_period_end, expected.currentPeriodEnd)) return false;
      if (expected.reminderNotSentFor !== undefined && sameInstant(s.reminder_sent_for, expected.reminderNotSentFor)) return false;
      if (expected.cancelAtPeriodEnd !== undefined && s.cancel_at_period_end !== expected.cancelAtPeriodEnd) return false;
      const next: SubscriptionRow = withPgTimes({ ...s, ...defined(clone(patch)) }, SUBSCRIPTION_TIMES);
      checkSubscription("updateSubscriptionIf", next);
      if (liveConflict(rows.subscriptions, next)) throw storeError("updateSubscriptionIf", "duplicate key value violates unique constraint");
      Object.assign(s, next);
      return true;
    },

    async linkConsents(checkoutId, subscriptionId) {
      for (const c of rows.consents) if (c.checkout_id === checkoutId) c.subscription_id = subscriptionId;
    },

    async listCycleCandidates(livemode, nowIso, limit) {
      const horizon = Date.parse(nowIso) + 31 * DAY;
      return rows.subscriptions
        .filter((s) => s.provider === "toss" && s.livemode === livemode && LIVE.has(s.status) && Date.parse(s.current_period_end) <= horizon)
        .sort((a, b) => Date.parse(a.current_period_end) - Date.parse(b.current_period_end))
        .slice(0, limit)
        .map(outSubscription);
    },

    async listPendingPayments(livemode, olderThanIso, limit) {
      const before = Date.parse(olderThanIso);
      return rows.payments
        .filter((p) => p.provider === "toss" && p.livemode === livemode && p.status === "pending" && Date.parse(p.requested_at) < before)
        .sort((a, b) => Date.parse(a.requested_at) - Date.parse(b.requested_at))
        .slice(0, limit)
        .map(outPayment);
    },

    async hasPendingPayment(subscriptionId) {
      // 모든 kind — 첫 결제 pending도 종료를 미룬다(Supabase 저장소와 같음)
      return rows.payments.some((p) => p.subscription_id === subscriptionId && p.status === "pending");
    },

    async hasPendingInitialPayment(userId, livemode) {
      return rows.payments.some((p) => p.user_id === userId && p.livemode === livemode && p.kind === "initial" && p.status === "pending");
    },

    async hasUserFacingFailure(subscriptionId, periodStart, exclude) {
      return rows.payments.some(
        (p) =>
          p.subscription_id === subscriptionId &&
          ATTEMPT_KINDS.has(p.kind) &&
          sameInstant(p.period_start, periodStart) &&
          p.status === "failed" &&
          p.failure_code !== null &&
          !exclude.codes.includes(p.failure_code) &&
          !exclude.prefixes.some((prefix) => p.failure_code!.startsWith(prefix)),
      );
    },
  };
}

// ── 가짜 토스 ──

type Methods = "issueBillingKey" | "chargeBillingKey" | "getPaymentByOrderId" | "cancelPayment";
type Result<M extends Methods> = Awaited<ReturnType<TossClient[M]>>;
/** 성공 값, 던질 TossError, 또는 호출 시점에 실행할 함수(경합 흉내·인자에 맞춘 응답) */
export type TossStep<M extends Methods> =
  | Result<M>
  | TossError
  | ((...args: Parameters<TossClient[M]>) => Result<M> | Promise<Result<M>>);
export type TossScript = { [M in Methods]: TossStep<M>[] };
export type TossCalls = { [M in Methods]: Parameters<TossClient[M]>[] };
export type FakeToss = TossClient & { calls: TossCalls; script: TossScript };

export function createFakeToss(script: Partial<TossScript> = {}): FakeToss {
  const queues: TossScript = {
    issueBillingKey: [...(script.issueBillingKey ?? [])],
    chargeBillingKey: [...(script.chargeBillingKey ?? [])],
    getPaymentByOrderId: [...(script.getPaymentByOrderId ?? [])],
    cancelPayment: [...(script.cancelPayment ?? [])],
  };
  const calls: TossCalls = { issueBillingKey: [], chargeBillingKey: [], getPaymentByOrderId: [], cancelPayment: [] };

  async function run<M extends Methods>(method: M, args: Parameters<TossClient[M]>): Promise<Result<M>> {
    (calls[method] as Parameters<TossClient[M]>[]).push(clone(args));
    const queue = queues[method] as TossStep<M>[];
    if (queue.length === 0) throw new Error(`fake toss: no scripted response for ${method}`);
    const step = queue.shift() as TossStep<M>;
    if (step instanceof TossError) throw step;
    if (typeof step === "function") return clone(await (step as (...a: Parameters<TossClient[M]>) => Result<M> | Promise<Result<M>>)(...args));
    return clone(step);
  }

  return {
    calls,
    script: queues,
    issueBillingKey: (...args) => run("issueBillingKey", args),
    chargeBillingKey: (...args) => run("chargeBillingKey", args),
    getPaymentByOrderId: (...args) => run("getPaymentByOrderId", args),
    cancelPayment: (...args) => run("cancelPayment", args),
  };
}

// ── 가짜 메일러 ──

export interface SentMail {
  userId: string | null;
  kind: BillingEmailKind;
  data: Record<string, unknown>;
}
export type FakeMailer = BillingMailer & { sent: SentMail[] };

export function createFakeMailer(): FakeMailer {
  const sent: SentMail[] = [];
  return {
    sent,
    async send(userId, kind, data) {
      sent.push({ userId, kind, data: clone(data) });
    },
  };
}

// ── 조립 ──

export interface FakeDeps extends BillingDeps {
  store: MemoryStore;
  toss: FakeToss;
  mailer: FakeMailer;
  log: Mock<(message: string) => Promise<void>>;
}

export function makeDeps(over: Partial<FakeDeps> = {}): FakeDeps {
  const now = over.now ?? (() => NOW);
  return {
    store: over.store ?? createMemoryStore({}, { now }),
    toss: over.toss ?? createFakeToss(),
    encKey: over.encKey ?? randomBytes(32),
    mailer: over.mailer ?? createFakeMailer(),
    now,
    log: over.log ?? vi.fn(async () => undefined),
  };
}

// ── 행 만들기 ──

export function priceRow(over: Partial<PriceRow> = {}): PriceRow {
  return {
    id: randomUUID(),
    plan_code: "pro",
    provider: "toss",
    currency: "KRW",
    interval: "month",
    amount: 1234,
    livemode: false,
    active: true,
    ...over,
  };
}

export function customerRow(over: Partial<CustomerRow> & Pick<CustomerRow, "user_id">): CustomerRow {
  return {
    id: randomUUID(),
    livemode: false,
    toss_customer_key: randomUUID(),
    toss_billing_key_enc: null,
    toss_card_summary: null,
    ...over,
  };
}

export function checkoutRow(over: Partial<CheckoutRow> & Pick<CheckoutRow, "user_id" | "price_id">): CheckoutRow {
  return {
    id: randomUUID(),
    provider: "toss",
    livemode: false,
    purpose: "subscribe",
    status: "open",
    failure_code: null,
    subscription_id: null,
    expires_at: iso(NOW + 30 * MIN),
    ...over,
  };
}

export function subscriptionRow(over: Partial<SubscriptionRow> & Pick<SubscriptionRow, "user_id">): SubscriptionRow {
  return {
    id: randomUUID(),
    provider: "toss",
    livemode: false,
    plan_code: "pro",
    status: "active",
    ended_reason: null,
    price_id: null,
    amount: 1234,
    currency: "KRW",
    interval: "month",
    current_period_start: iso(NOW - 10 * DAY),
    current_period_end: iso(NOW + 20 * DAY),
    billing_anchor_day: 21,
    cancel_at_period_end: false,
    canceled_at: null,
    ended_at: null,
    dunning_attempts: 0,
    next_retry_at: null,
    grace_until: null,
    reminder_sent_for: null,
    ...over,
  };
}

/** 이미 있는 결제 행(대사 대상 등) — 기본은 10분보다 오래된 pending 첫 결제 */
export function paymentRow(over: Partial<PaymentRow> & Pick<PaymentRow, "user_id">): PaymentRow {
  return {
    id: randomUUID(),
    subscription_id: null,
    checkout_id: null,
    provider: "toss",
    livemode: false,
    kind: "initial",
    order_id: `pay_${randomUUID()}`,
    external_payment_id: null,
    amount: 1234,
    currency: "KRW",
    period_start: iso(NOW),
    period_end: iso(NOW + 28 * DAY),
    attempt: 1,
    status: "pending",
    failure_code: null,
    failure_message: null,
    receipt_url: null,
    card_summary: null,
    refunded_amount: 0,
    requested_at: iso(NOW - 60 * MIN),
    approved_at: null,
    ...over,
  };
}

export function billingAuth(over: Partial<TossBillingAuth> = {}): TossBillingAuth {
  return { billingKey: "bk_plain_secret_0001", card: { issuerCode: "61", number: "1234****", cardType: "신용" }, ...over };
}

export function tossPayment(over: Partial<TossPayment> = {}): TossPayment {
  return {
    paymentKey: "pk_0001",
    orderId: "pay_x",
    status: "DONE",
    approvedAt: "2026-01-31T01:00:05+09:00",
    receiptUrl: "https://dashboard.tosspayments.com/receipt/0001",
    card: { issuerCode: "61", number: "1234****", cardType: "신용" },
    totalAmount: 1234,
    balanceAmount: null,
    ...over,
  };
}
