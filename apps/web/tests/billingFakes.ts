/**
 * 결제 흐름 테스트용 가짜 구현 — 메모리 저장소·가짜 토스·가짜 메일러.
 * vitest include가 *.test.ts라 이 파일 자체는 실행되지 않는다.
 *
 * 메모리 저장소는 0041의 유니크·check 제약을 흉내낸다. 위반 시 Supabase 저장소(store.ts)와 같게
 * insert는 표지값("duplicate"·"hasActive")을, update는 "billing store <메서드>: ..." 오류를 낸다.
 * 모든 읽기·쓰기는 structuredClone 사본을 주고받는다 — 호출부가 돌려받은 객체를 고쳐도
 * 저장소가 바뀌지 않는다(실제 DB와 같다). 상태 검사는 store.rows로 한다.
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
}

export function createMemoryStore(seed: Partial<MemoryRows> = {}, opts: { now?: () => number } = {}): MemoryStore {
  const now = opts.now ?? Date.now;
  const rows: MemoryRows = {
    prices: clone(seed.prices ?? []),
    customers: clone(seed.customers ?? []),
    checkouts: clone(seed.checkouts ?? []),
    subscriptions: clone(seed.subscriptions ?? []),
    payments: clone(seed.payments ?? []),
    consents: clone(seed.consents ?? []),
  };
  const found = <T extends { id: string }>(list: T[], id: string) => list.find((r) => r.id === id);

  return {
    rows,

    async claimCheckout(id, userId, nowIso) {
      const c = rows.checkouts.find(
        (r) => r.id === id && r.user_id === userId && r.status === "open" && Date.parse(r.expires_at) > Date.parse(nowIso),
      );
      if (!c) return null;
      c.status = "processing";
      return clone(c);
    },

    async getCheckout(id) {
      const c = found(rows.checkouts, id);
      return c ? clone(c) : null;
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

    async updateCustomer(id, patch) {
      // 0041 check: 암호문은 v1: 접두만 — 평문 빌링키가 들어오면 DB처럼 거부한다
      if (patch.toss_billing_key_enc !== null && !patch.toss_billing_key_enc.startsWith("v1:")) {
        throw storeError("updateCustomer", "toss_billing_key_enc check violation");
      }
      const c = found(rows.customers, id);
      if (c) Object.assign(c, clone(patch));
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
        approved_at: null,
      };
      checkPayment("insertPayment", p);
      if (paymentConflict(rows.payments, p)) return "duplicate";
      rows.payments.push(p);
      return clone(p);
    },

    async updatePayment(id, patch) {
      const p = found(rows.payments, id);
      if (!p) return;
      const next: PaymentRow = { ...p, ...defined(clone(patch)) };
      checkPayment("updatePayment", next);
      if (paymentConflict(rows.payments, next)) throw storeError("updatePayment", "duplicate key value violates unique constraint");
      Object.assign(p, next);
    },

    async getSubscription(id) {
      const s = found(rows.subscriptions, id);
      return s ? clone(s) : null;
    },

    async getLiveSubscription(userId, livemode) {
      const s = rows.subscriptions.find((r) => r.user_id === userId && r.livemode === livemode && LIVE.has(r.status));
      return s ? clone(s) : null;
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
      checkSubscription("insertSubscription", s);
      if (liveConflict(rows.subscriptions, s)) return "hasActive";
      rows.subscriptions.push(s);
      return clone(s);
    },

    async updateSubscription(id, patch) {
      const s = found(rows.subscriptions, id);
      if (!s) return;
      const next: SubscriptionRow = { ...s, ...defined(clone(patch)) };
      checkSubscription("updateSubscription", next);
      if (liveConflict(rows.subscriptions, next)) throw storeError("updateSubscription", "duplicate key value violates unique constraint");
      Object.assign(s, next);
    },

    async linkConsents(checkoutId, subscriptionId) {
      for (const c of rows.consents) if (c.checkout_id === checkoutId) c.subscription_id = subscriptionId;
    },

    async listCycleCandidates(livemode, nowIso, limit) {
      const horizon = Date.parse(nowIso) + 31 * DAY;
      return clone(
        rows.subscriptions
          .filter((s) => s.provider === "toss" && s.livemode === livemode && LIVE.has(s.status) && Date.parse(s.current_period_end) <= horizon)
          .sort((a, b) => Date.parse(a.current_period_end) - Date.parse(b.current_period_end))
          .slice(0, limit),
      );
    },

    async listPendingPayments(livemode, olderThanIso, limit) {
      const before = Date.parse(olderThanIso);
      return clone(
        rows.payments
          .filter((p) => p.provider === "toss" && p.livemode === livemode && p.status === "pending" && Date.parse(p.requested_at) < before)
          .sort((a, b) => Date.parse(a.requested_at) - Date.parse(b.requested_at))
          .slice(0, limit),
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
    ...over,
  };
}
