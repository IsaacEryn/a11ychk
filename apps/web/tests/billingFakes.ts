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
 * Postgres처럼 마이크로초까지 지킨다(Polar 시각은 소수 6자리) — external_updated_at 비교는 마이크로초 단위다.
 * 판매 대행(MoR) 메서드는 FK(profiles·billing_checkouts·subscriptions·billing_payments)도 흉내낸다 — 흐름이 탈퇴한 사용자 id를
 * 그대로 쓰는 실수를 잡게. 토스 메서드는 기존 테스트가 profiles를 심지 않으므로 FK를 보지 않는다.
 */
import { randomBytes, randomUUID } from "node:crypto";
import { vi, type Mock } from "vitest";
import { PolarError, type PolarCheckout, type PolarClient, type PolarOrder, type PolarRefund, type PolarSubscription } from "../src/lib/billing/polar";
import { TossError, type TossBillingAuth, type TossClient, type TossPayment } from "../src/lib/billing/toss";
import type {
  BillingDeps,
  BillingEmailKind,
  BillingMailer,
  BillingStore,
  CheckoutRow,
  CustomerRow,
  MorDeps,
  MorSubscriptionFields,
  MorSubscriptionRow,
  PaymentRow,
  PriceRow,
  RefundRow,
  SubscriptionRow,
  TossCustomerRow,
  WebhookEventPayload,
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

/** billing_webhook_events 행 — 시각은 PostgREST 표기 */
export interface WebhookEventRow {
  provider: string;
  event_id: string;
  event_type: string;
  received_at: string;
  processed_at: string | null;
  attempts: number;
  last_error: string | null;
  payload: WebhookEventPayload | null;
}

/** 토스 행은 외부 열을 비워 둔다(없으면 null로 읽는다) */
export type MemorySubscription = SubscriptionRow & Partial<MorSubscriptionFields>;

export interface MemoryRows {
  prices: PriceRow[];
  customers: CustomerRow[];
  checkouts: CheckoutRow[];
  subscriptions: MemorySubscription[];
  payments: PaymentRow[];
  consents: ConsentRow[];
  /** profiles 행이 있는 사용자 id — MoR 흐름의 사용자 확인·FK용 */
  profiles: string[];
  refunds: RefundRow[];
  webhookEvents: WebhookEventRow[];
}

export type MemoryStore = BillingStore & { rows: MemoryRows };

const LIVE = new Set<SubscriptionRow["status"]>(["active", "past_due"]);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ATTEMPT_KINDS = new Set<PaymentRow["kind"]>(["renewal", "retry"]);
const CLAIMABLE_END = new Set<CheckoutRow["status"]>(["open", "processing"]);

const clone = <T>(v: T): T => structuredClone(v);

const ISO_TIME_RE = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d+))?(Z|[+-]\d{2}:\d{2})$/;

/** ISO 시각의 마이크로초(Unix epoch 기준) — 모양이 다르면 NaN. Date.parse는 밀리초에서 자른다 */
export function micros(v: string): number {
  const m = ISO_TIME_RE.exec(v);
  if (!m) return NaN;
  const base = Date.parse(`${m[1]}${m[3]}`);
  if (Number.isNaN(base)) return NaN;
  return base * 1000 + Number((m[2] ?? "").padEnd(6, "0").slice(0, 6));
}

/**
 * PostgREST(UTC 세션)의 timestamptz 표기 — 초 아래가 0이면 생략하고, 있으면 뒤 0을 뺀다(마이크로초까지).
 * 예: 2026-01-30T16:00:00+00:00, 2026-01-30T16:00:05.12+00:00, 2026-01-02T00:00:00.123456+00:00
 */
export function pgTime(v: string | number): string {
  const us = typeof v === "number" ? v * 1000 : micros(v);
  if (Number.isNaN(us)) {
    const t = typeof v === "number" ? v : Date.parse(v);
    if (Number.isNaN(t)) return String(v);
    return pgTime(t);
  }
  const head = new Date(Math.floor(us / 1e6) * 1000).toISOString().slice(0, 19);
  const frac = String(((us % 1e6) + 1e6) % 1e6).padStart(6, "0").replace(/0+$/, "");
  return `${head}${frac ? `.${frac}` : ""}+00:00`;
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
  "external_updated_at",
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
/** MoR 열까지 — 비어 있으면 null(DB 기본값) */
const outMorSubscription = (s: MemorySubscription): MorSubscriptionRow =>
  withPgTimes(
    {
      ...clone(s),
      mor_provider: s.mor_provider ?? null,
      external_id: s.external_id ?? null,
      external_customer_id: s.external_customer_id ?? null,
      external_updated_at: s.external_updated_at ?? null,
    },
    SUBSCRIPTION_TIMES,
  );
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

/** unique (provider, external_id) — NULL끼리는 충돌하지 않는다 */
function externalConflict(rows: MemorySubscription[], s: MemorySubscription): boolean {
  return s.external_id != null && rows.some((o) => o.id !== s.id && o.provider === s.provider && o.external_id === s.external_id);
}

const SUB_STATUSES = new Set(["active", "past_due", "ended"]);
const ENDED_REASONS = new Set(["user_canceled", "payment_failed", "admin", "refunded", "contract_expired"]);
const SUB_INTERVALS = new Set(["month", "year", "contract"]);
const CURRENCIES = new Set(["KRW", "USD"]);

function checkSubscription(method: string, s: MemorySubscription) {
  if (!(Date.parse(s.current_period_end) > Date.parse(s.current_period_start))) throw storeError(method, "period check violation");
  if (!SUB_STATUSES.has(s.status)) throw storeError(method, "status check violation");
  if (s.ended_reason !== null && !ENDED_REASONS.has(s.ended_reason)) throw storeError(method, "ended_reason check violation");
  if (!SUB_INTERVALS.has(s.interval)) throw storeError(method, "interval check violation");
  if (!CURRENCIES.has(s.currency)) throw storeError(method, "currency check violation");
  if (s.mor_provider != null && s.mor_provider !== "paddle" && s.mor_provider !== "polar") throw storeError(method, "mor_provider check violation");
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

const PAYMENT_STATUSES = new Set(["pending", "paid", "failed", "refunded", "partially_refunded"]);
const PAYMENT_KINDS = new Set(["initial", "renewal", "retry", "manual"]);

function checkPayment(method: string, p: PaymentRow) {
  if (!PAYMENT_STATUSES.has(p.status)) throw storeError(method, "status check violation");
  if (!PAYMENT_KINDS.has(p.kind)) throw storeError(method, "kind check violation");
  if (!CURRENCIES.has(p.currency)) throw storeError(method, "currency check violation");
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
    profiles: clone(seed.profiles ?? []),
    refunds: clone(seed.refunds ?? []),
    webhookEvents: clone(seed.webhookEvents ?? []),
  };
  /** FK 흉내(MoR 메서드만) — 23503 대신 저장소 오류로 */
  const fk = (method: string, ok: boolean, what: string) => {
    if (!ok) throw storeError(method, `insert or update violates foreign key constraint (${what})`);
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

    async deletePendingPayment(id) {
      const i = rows.payments.findIndex((p) => p.id === id && p.status === "pending" && p.external_payment_id === null);
      if (i === -1) return false;
      rows.payments.splice(i, 1);
      return true;
    },

    async getSubscription(id) {
      const s = found(rows.subscriptions, id);
      return s ? outSubscription(s) : null;
    },

    async getLiveSubscription(userId, livemode) {
      const s = rows.subscriptions.find((r) => r.user_id === userId && r.livemode === livemode && LIVE.has(r.status));
      return s ? outSubscription(s) : null;
    },

    async listLiveSubscriptions(userId) {
      return rows.subscriptions.filter((r) => r.user_id === userId && LIVE.has(r.status)).map(outSubscription);
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
      // store.ts CYCLE_WINDOW_MS와 같은 창(연간 D-30 안내까지)
      const horizon = Date.parse(nowIso) + 33 * DAY;
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

    async findPaidRenewal(subscriptionId, periodStart) {
      // Supabase 저장소와 같게 가장 늦게 요청한 것 하나
      const [latest] = rows.payments
        .filter((p) => p.subscription_id === subscriptionId && ATTEMPT_KINDS.has(p.kind) && p.status === "paid" && sameInstant(p.period_start, periodStart))
        .sort((a, b) => Date.parse(b.requested_at) - Date.parse(a.requested_at));
      return latest ? outPayment(latest) : null;
    },

    // ── 판매 대행(MoR) ──

    async findPriceByExternal(provider, externalPriceId, livemode) {
      const p = rows.prices.find((r) => r.provider === provider && r.external_price_id === externalPriceId && r.livemode === livemode);
      return p ? clone(p) : null;
    },

    async profileExists(userId) {
      return UUID_RE.test(userId) && rows.profiles.includes(userId);
    },

    async getSubscriptionByExternal(provider, externalId, livemode) {
      const s = rows.subscriptions.find((r) => r.provider === provider && r.external_id === externalId && r.livemode === livemode);
      return s ? outMorSubscription(s) : null;
    },

    async insertMorSubscription(row) {
      const s: MemorySubscription = {
        ...clone(row),
        id: randomUUID(),
        ended_reason: null,
        ended_at: null,
        dunning_attempts: 0,
        next_retry_at: null,
        reminder_sent_for: null,
      };
      withPgTimes(s, SUBSCRIPTION_TIMES);
      checkSubscription("insertMorSubscription", s);
      fk("insertMorSubscription", s.user_id === null || rows.profiles.includes(s.user_id), "user_id");
      fk("insertMorSubscription", s.price_id === null || rows.prices.some((p) => p.id === s.price_id), "price_id");
      if (liveConflict(rows.subscriptions, s) || externalConflict(rows.subscriptions, s)) return "conflict";
      rows.subscriptions.push(s);
      return outMorSubscription(s);
    },

    async updateMorSubscriptionIf(id, expected, patch) {
      const bound = micros(expected.notAfter);
      if (Number.isNaN(bound)) throw storeError("updateMorSubscriptionIf", "notAfter must be an ISO time");
      const s = found(rows.subscriptions, id);
      if (!s || s.status !== expected.status) return "skipped";
      if (s.external_updated_at != null && micros(s.external_updated_at) > bound) return "skipped";
      const next: MemorySubscription = withPgTimes({ ...s, ...defined(clone(patch)) }, SUBSCRIPTION_TIMES);
      checkSubscription("updateMorSubscriptionIf", next);
      fk("updateMorSubscriptionIf", next.user_id === null || rows.profiles.includes(next.user_id), "user_id");
      fk("updateMorSubscriptionIf", next.price_id === null || rows.prices.some((p) => p.id === next.price_id), "price_id");
      // Supabase 저장소처럼 23505는 모두 "conflict"
      if (externalConflict(rows.subscriptions, next) || liveConflict(rows.subscriptions, next)) return "conflict";
      Object.assign(s, next);
      return "updated";
    },

    async getPaymentByExternal(provider, externalPaymentId, livemode) {
      const p = rows.payments.find((r) => r.provider === provider && r.external_payment_id === externalPaymentId && r.livemode === livemode);
      return p ? outPayment(p) : null;
    },

    async insertExternalPayment(row) {
      const p: PaymentRow = {
        ...clone(row),
        id: randomUUID(),
        requested_at: iso(now()),
        failure_code: null,
        failure_message: null,
        receipt_url: null,
        card_summary: null,
      };
      withPgTimes(p, PAYMENT_TIMES);
      checkPayment("insertExternalPayment", p);
      fk("insertExternalPayment", p.user_id === null || rows.profiles.includes(p.user_id), "user_id");
      fk("insertExternalPayment", p.checkout_id === null || rows.checkouts.some((c) => c.id === p.checkout_id), "checkout_id");
      fk("insertExternalPayment", p.subscription_id === null || rows.subscriptions.some((x) => x.id === p.subscription_id), "subscription_id");
      if (paymentConflict(rows.payments, p)) return "duplicate";
      rows.payments.push(p);
      return outPayment(p);
    },

    async updatePaymentIf(id, expected, patch) {
      const p = found(rows.payments, id);
      if (!p || p.status !== expected.status || p.refunded_amount !== expected.refundedAmount) return false;
      const next: PaymentRow = withPgTimes({ ...p, ...defined(clone(patch)) }, PAYMENT_TIMES);
      checkPayment("updatePaymentIf", next);
      fk("updatePaymentIf", next.user_id === null || rows.profiles.includes(next.user_id), "user_id");
      fk("updatePaymentIf", next.subscription_id === null || rows.subscriptions.some((x) => x.id === next.subscription_id), "subscription_id");
      if (paymentConflict(rows.payments, next)) throw storeError("updatePaymentIf", "duplicate key value violates unique constraint");
      Object.assign(p, next);
      return true;
    },

    async findInitialPaymentByCheckout(checkoutId, provider, livemode) {
      const [first] = rows.payments
        .filter((p) => p.checkout_id === checkoutId && p.provider === provider && p.livemode === livemode && p.kind === "initial")
        .sort((a, b) => Date.parse(a.requested_at) - Date.parse(b.requested_at));
      return first ? outPayment(first) : null;
    },

    async hasRefundFor(paymentId, refundId) {
      return rows.refunds.some((r) => r.id === refundId && r.payment_id === paymentId);
    },

    async insertRefund(row) {
      if (!(row.amount > 0)) throw storeError("insertRefund", "amount check violation");
      if (!["pending", "succeeded", "failed"].includes(row.status)) throw storeError("insertRefund", "status check violation");
      fk("insertRefund", rows.payments.some((p) => p.id === row.payment_id), "payment_id");
      const r: RefundRow = { ...clone(row), id: row.id ?? randomUUID() };
      // 기본 키 — 자동 환불의 결정적 id가 동시 요청 중 하나만 통과시킨다
      if (rows.refunds.some((o) => o.id === r.id)) return "duplicate";
      rows.refunds.push(r);
      return clone(r);
    },

    async updateRefund(id, patch) {
      const r = found(rows.refunds, id);
      if (!r) return;
      if (patch.status !== undefined && !["pending", "succeeded", "failed"].includes(patch.status)) throw storeError("updateRefund", "status check violation");
      Object.assign(r, defined(clone(patch)));
    },

    async findRefundByExternal(externalRefundId) {
      const r = rows.refunds.find((x) => x.external_refund_id === externalRefundId);
      return r ? clone(r) : null;
    },

    async getRefund(id) {
      const r = found(rows.refunds, id);
      return r ? clone(r) : null;
    },

    async updateRefundIf(id, expected, patch) {
      const r = found(rows.refunds, id);
      if (!r || r.status !== expected.status || r.external_refund_id !== expected.externalRefundId) return false;
      if (patch.status !== undefined && !["pending", "succeeded", "failed"].includes(patch.status)) throw storeError("updateRefundIf", "status check violation");
      Object.assign(r, defined(clone(patch)));
      return true;
    },

    async recordWebhookEvent(provider, eventId, type, payload) {
      const e = rows.webhookEvents.find((x) => x.provider === provider && x.event_id === eventId);
      if (!e) {
        rows.webhookEvents.push({
          provider,
          event_id: eventId,
          event_type: type,
          received_at: pgTime(now()),
          processed_at: null,
          attempts: 1,
          last_error: null,
          payload: clone(payload),
        });
        return "new";
      }
      if (e.processed_at !== null) return "done";
      e.attempts = Math.min(e.attempts + 1, 32767);
      return "retry";
    },

    async finishWebhookEvent(provider, eventId, outcome) {
      const e = rows.webhookEvents.find((x) => x.provider === provider && x.event_id === eventId);
      if (!e || e.processed_at !== null) return;
      if (outcome.error === undefined) e.processed_at = pgTime(now());
      else e.last_error = outcome.error.slice(0, 500);
    },
  };
}

/**
 * 계정 삭제(auth.users → profiles)가 0041에서 일으키는 일 — 고객 행·결제 시도는 cascade로 지워지고, 구독·결제·동의는
 * user_id(와 지워진 시도를 가리키던 checkout_id)만 비워 남는다. 탈퇴 흐름 테스트가 deleteUser 대역에서 부른다.
 */
export function deleteUserCascade(store: MemoryStore, userId: string): void {
  const { rows } = store;
  const goneCheckouts = new Set(rows.checkouts.filter((c) => c.user_id === userId).map((c) => c.id));
  rows.customers = rows.customers.filter((c) => c.user_id !== userId);
  rows.profiles = rows.profiles.filter((id) => id !== userId);
  rows.checkouts = rows.checkouts.filter((c) => c.user_id !== userId);
  for (const s of rows.subscriptions) if (s.user_id === userId) s.user_id = null;
  for (const p of rows.payments) {
    if (p.user_id === userId) p.user_id = null;
    if (p.checkout_id && goneCheckouts.has(p.checkout_id)) p.checkout_id = null;
  }
  for (const c of rows.consents) {
    if (c.user_id === userId) c.user_id = null;
    if (c.checkout_id && goneCheckouts.has(c.checkout_id)) c.checkout_id = null;
  }
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

// ── 가짜 Polar ──

type PolarMethods =
  | "createCheckout"
  | "getCheckout"
  | "getSubscription"
  | "updateSubscription"
  | "getOrder"
  | "getRefund"
  | "createRefund"
  | "createCustomerSession";
type PolarResult<M extends PolarMethods> = Awaited<ReturnType<PolarClient[M]>>;
/** 성공 값, 던질 PolarError, 또는 호출 시점에 실행할 함수(인자에 맞춘 응답·경합 흉내) */
export type PolarStep<M extends PolarMethods> =
  | PolarResult<M>
  | PolarError
  | ((...args: Parameters<PolarClient[M]>) => PolarResult<M> | Promise<PolarResult<M>>);
export type PolarScript = { [M in PolarMethods]: PolarStep<M>[] };
export type PolarCalls = { [M in PolarMethods]: Parameters<PolarClient[M]>[] };
export type FakePolar = PolarClient & { calls: PolarCalls; script: PolarScript };

/** 정해 둔 응답을 차례로 준다 — 응답이 없는 호출은 던진다(부르면 안 되는 호출을 테스트가 잡게) */
export function createFakePolar(script: Partial<PolarScript> = {}): FakePolar {
  const methods: PolarMethods[] = [
    "createCheckout",
    "getCheckout",
    "getSubscription",
    "updateSubscription",
    "getOrder",
    "getRefund",
    "createRefund",
    "createCustomerSession",
  ];
  const queues = Object.fromEntries(methods.map((m) => [m, [...(script[m] ?? [])]])) as PolarScript;
  const calls = Object.fromEntries(methods.map((m) => [m, []])) as unknown as PolarCalls;

  async function run<M extends PolarMethods>(method: M, args: Parameters<PolarClient[M]>): Promise<PolarResult<M>> {
    (calls[method] as Parameters<PolarClient[M]>[]).push(clone(args));
    const queue = queues[method] as PolarStep<M>[];
    if (queue.length === 0) throw new Error(`fake polar: no scripted response for ${method}`);
    const step = queue.shift() as PolarStep<M>;
    if (step instanceof PolarError) throw step;
    if (typeof step === "function") {
      return clone(await (step as (...a: Parameters<PolarClient[M]>) => PolarResult<M> | Promise<PolarResult<M>>)(...args));
    }
    return clone(step);
  }

  return {
    calls,
    script: queues,
    createCheckout: (...args) => run("createCheckout", args),
    getCheckout: (...args) => run("getCheckout", args),
    getSubscription: (...args) => run("getSubscription", args),
    updateSubscription: (...args) => run("updateSubscription", args),
    getOrder: (...args) => run("getOrder", args),
    getRefund: (...args) => run("getRefund", args),
    createRefund: (...args) => run("createRefund", args),
    createCustomerSession: (...args) => run("createCustomerSession", args),
  };
}

export interface FakeMorDeps extends MorDeps {
  store: MemoryStore;
  polar: FakePolar;
  log: Mock<(message: string) => Promise<void>>;
}

export function makeMorDeps(over: Partial<FakeMorDeps> = {}): FakeMorDeps {
  const now = over.now ?? (() => NOW);
  return {
    store: over.store ?? createMemoryStore({}, { now }),
    polar: over.polar ?? createFakePolar(),
    now,
    log: over.log ?? vi.fn(async () => undefined),
  };
}

/** Polar 구독(정본) — 기본은 sandbox의 월간 active, 금액은 가짜 값 */
export function polarSubscription(over: Partial<PolarSubscription> = {}): PolarSubscription {
  return {
    id: randomUUID(),
    created_at: "2026-01-20T16:00:00.000000Z",
    modified_at: "2026-01-20T16:00:05.123456Z",
    status: "active",
    amount: 1234,
    currency: "usd",
    recurring_interval: "month",
    recurring_interval_count: 1,
    current_period_start: "2026-01-20T16:00:00.000000Z",
    current_period_end: "2026-02-20T16:00:00.000000Z",
    cancel_at_period_end: false,
    canceled_at: null,
    started_at: "2026-01-20T16:00:00.000000Z",
    ends_at: null,
    ended_at: null,
    customer: { id: randomUUID(), external_id: null },
    product_id: randomUUID(),
    checkout_id: randomUUID(),
    metadata: {},
    ...over,
  };
}

/** Polar 주문(정본) — 기본은 첫 구독 결제, paid. 금액은 가짜 값(cent) */
export function polarOrder(over: Partial<PolarOrder> = {}): PolarOrder {
  return {
    id: randomUUID(),
    created_at: "2026-01-20T16:00:01.000000Z",
    modified_at: "2026-01-20T16:00:02.000000Z",
    status: "paid",
    paid: true,
    subtotal_amount: 1234,
    discount_amount: 0,
    net_amount: 1234,
    tax_amount: 100,
    total_amount: 1334,
    refunded_amount: 0,
    refunded_tax_amount: 0,
    refundable_amount: 1234,
    currency: "usd",
    billing_reason: "subscription_create",
    subscription_id: null,
    customer: { external_id: null },
    product_id: null,
    checkout_id: null,
    metadata: {},
    ...over,
  };
}

/**
 * Polar 결제창(정본) — 기본은 열린 결제창, 우리 시도·사용자 id는 비어 있다. 금액·통화·주기는 priceRow 기본값(1234 cent·월간)과
 * 맞춰 둔다 — 결제 시작의 가격 대조가 기본으로 돈다
 */
export function polarCheckout(over: Partial<PolarCheckout> = {}): PolarCheckout {
  return {
    id: randomUUID(),
    status: "open",
    url: "https://sandbox.polar.sh/checkout/fake",
    expires_at: "2026-01-20T17:00:00.000000Z",
    external_customer_id: null,
    product_id: null,
    subscription_id: null,
    amount: 1234,
    currency: "usd",
    locale: null,
    recurring_interval: "month",
    metadata: {},
    ...over,
  };
}

/** Polar 환불(정본) — 기본은 succeeded, 금액은 가짜 값(cent) */
export function polarRefund(over: Partial<PolarRefund> = {}): PolarRefund {
  return { id: randomUUID(), status: "succeeded", amount: 1234, order_id: randomUUID(), metadata: {}, ...over };
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
    external_price_id: null,
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
