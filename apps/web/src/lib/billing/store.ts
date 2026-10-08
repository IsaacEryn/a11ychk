import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  BillingStore,
  CheckoutRow,
  CustomerRow,
  PaymentRow,
  PriceRow,
  SubscriptionRow,
} from "@/lib/billing/types";

/**
 * Supabase(service role) BillingStore — 메서드마다 PostgREST 한 번.
 * 유니크 위반(23505)은 인터페이스의 표지값으로 바꾸고, 그 밖의 오류는
 * "billing store <메서드>: <메시지>"로 던진다. 메시지에는 PostgREST의 message만 넣는다
 * (details에는 행 값이 들어갈 수 있다). 흐름이 잡아 log로 남긴다.
 * 0041은 RLS 위의 service role 전용 쓰기라, 이 모듈은 권한 검증을 마친 서버 경로에서만 쓴다.
 */

const PRICE_COLS = "id, plan_code, provider, currency, interval, amount, livemode, active";
const CUSTOMER_COLS = "id, user_id, livemode, toss_customer_key, toss_billing_key_enc, toss_card_summary";
const CHECKOUT_COLS = "id, user_id, provider, livemode, price_id, purpose, status, failure_code, subscription_id, expires_at";
const SUBSCRIPTION_COLS =
  "id, user_id, provider, livemode, plan_code, status, ended_reason, price_id, amount, currency, interval, current_period_start, current_period_end, billing_anchor_day, cancel_at_period_end, canceled_at, ended_at, dunning_attempts, next_retry_at, grace_until, reminder_sent_for";
const PAYMENT_COLS =
  "id, user_id, subscription_id, checkout_id, provider, livemode, kind, order_id, external_payment_id, amount, currency, period_start, period_end, attempt, status, failure_code, failure_message, receipt_url, card_summary, refunded_amount, requested_at, approved_at";

const LIVE_STATUSES = ["active", "past_due"];
const DAY_MS = 86_400_000;
/** 크론 후보 창 — 연간 구독의 D-30 안내까지 들어오게 31일 */
const CYCLE_WINDOW_MS = 31 * DAY_MS;

interface PgError {
  code?: string;
  message: string;
}

const UNIQUE_VIOLATION = "23505";

function fail(method: string, error: PgError): Error {
  return new Error(`billing store ${method}: ${error.message}`);
}

/** PostgREST는 undefined 키를 보내지 않지만, 의도를 분명히 하려고 미리 뺀다 */
function defined<T extends object>(patch: T): Partial<T> {
  return Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)) as Partial<T>;
}

export function createSupabaseBillingStore(admin: SupabaseClient): BillingStore {
  return {
    async claimCheckout(id, userId, nowIso) {
      const { data, error } = await admin
        .from("billing_checkouts")
        .update({ status: "processing" })
        .eq("id", id)
        .eq("user_id", userId)
        .eq("status", "open")
        .gt("expires_at", nowIso)
        .select(CHECKOUT_COLS)
        .maybeSingle();
      if (error) throw fail("claimCheckout", error);
      return (data as CheckoutRow | null) ?? null;
    },

    async getCheckout(id) {
      const { data, error } = await admin.from("billing_checkouts").select(CHECKOUT_COLS).eq("id", id).maybeSingle();
      if (error) throw fail("getCheckout", error);
      return (data as CheckoutRow | null) ?? null;
    },

    async finishCheckout(id, patch) {
      const { error } = await admin
        .from("billing_checkouts")
        .update(defined(patch))
        .eq("id", id)
        .in("status", ["open", "processing"]);
      if (error) throw fail("finishCheckout", error);
    },

    async getPrice(id) {
      const { data, error } = await admin.from("billing_prices").select(PRICE_COLS).eq("id", id).maybeSingle();
      if (error) throw fail("getPrice", error);
      return (data as PriceRow | null) ?? null;
    },

    async getCustomer(userId, livemode) {
      const { data, error } = await admin
        .from("billing_customers")
        .select(CUSTOMER_COLS)
        .eq("user_id", userId)
        .eq("livemode", livemode)
        .maybeSingle();
      if (error) throw fail("getCustomer", error);
      return (data as CustomerRow | null) ?? null;
    },

    async updateCustomer(id, patch) {
      const { error } = await admin
        .from("billing_customers")
        .update({ ...patch, updated_at: new Date().toISOString() })
        .eq("id", id);
      if (error) throw fail("updateCustomer", error);
    },

    async clearCustomerKeyIf(customerId, expectedEnc) {
      // 조건부 update — 다른 시도가 그 사이 쓴 암호문이면 0행이 바뀌고 false
      const { data, error } = await admin
        .from("billing_customers")
        .update({ toss_billing_key_enc: null, toss_card_summary: null, updated_at: new Date().toISOString() })
        .eq("id", customerId)
        .eq("toss_billing_key_enc", expectedEnc)
        .select("id");
      if (error) throw fail("clearCustomerKeyIf", error);
      return Array.isArray(data) && data.length > 0;
    },

    async insertPayment(row) {
      const { data, error } = await admin.from("billing_payments").insert(row).select(PAYMENT_COLS).single();
      if (error) {
        if (error.code === UNIQUE_VIOLATION) return "duplicate";
        throw fail("insertPayment", error);
      }
      return data as PaymentRow;
    },

    async updatePayment(id, patch) {
      const { error } = await admin.from("billing_payments").update(defined(patch)).eq("id", id);
      if (error) throw fail("updatePayment", error);
    },

    async getSubscription(id) {
      const { data, error } = await admin.from("subscriptions").select(SUBSCRIPTION_COLS).eq("id", id).maybeSingle();
      if (error) throw fail("getSubscription", error);
      return (data as SubscriptionRow | null) ?? null;
    },

    async getLiveSubscription(userId, livemode) {
      // subscriptions_one_live_per_user가 (user_id, livemode)당 1건을 보장한다
      const { data, error } = await admin
        .from("subscriptions")
        .select(SUBSCRIPTION_COLS)
        .eq("user_id", userId)
        .eq("livemode", livemode)
        .in("status", LIVE_STATUSES)
        .maybeSingle();
      if (error) throw fail("getLiveSubscription", error);
      return (data as SubscriptionRow | null) ?? null;
    },

    async insertSubscription(row) {
      // status는 DB 기본값이 없다 — 새 구독은 active로 시작한다
      const { data, error } = await admin
        .from("subscriptions")
        .insert({ ...row, status: "active" })
        .select(SUBSCRIPTION_COLS)
        .single();
      if (error) {
        if (error.code === UNIQUE_VIOLATION) return "hasActive";
        throw fail("insertSubscription", error);
      }
      return data as SubscriptionRow;
    },

    async updateSubscription(id, patch) {
      const { error } = await admin
        .from("subscriptions")
        .update({ ...defined(patch), updated_at: new Date().toISOString() })
        .eq("id", id);
      if (error) throw fail("updateSubscription", error);
    },

    async linkConsents(checkoutId, subscriptionId) {
      const { error } = await admin
        .from("billing_consents")
        .update({ subscription_id: subscriptionId })
        .eq("checkout_id", checkoutId);
      if (error) throw fail("linkConsents", error);
    },

    async listCycleCandidates(livemode, nowIso, limit) {
      const horizon = new Date(Date.parse(nowIso) + CYCLE_WINDOW_MS).toISOString();
      const { data, error } = await admin
        .from("subscriptions")
        .select(SUBSCRIPTION_COLS)
        .eq("provider", "toss")
        .eq("livemode", livemode)
        .in("status", LIVE_STATUSES)
        .lte("current_period_end", horizon)
        .order("current_period_end", { ascending: true })
        .limit(limit);
      if (error) throw fail("listCycleCandidates", error);
      return (data as SubscriptionRow[] | null) ?? [];
    },

    async listPendingPayments(livemode, olderThanIso, limit) {
      const { data, error } = await admin
        .from("billing_payments")
        .select(PAYMENT_COLS)
        .eq("provider", "toss")
        .eq("livemode", livemode)
        .eq("status", "pending")
        .lt("requested_at", olderThanIso)
        .order("requested_at", { ascending: true })
        .limit(limit);
      if (error) throw fail("listPendingPayments", error);
      return (data as PaymentRow[] | null) ?? [];
    },
  };
}
