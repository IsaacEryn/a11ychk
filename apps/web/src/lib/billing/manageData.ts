import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isMissingTable } from "@/lib/billing/dbErrors";
import type { CardSummary } from "@/lib/billing/toss";
import type { PaymentRow, SubscriptionRow } from "@/lib/billing/types";

/**
 * 결제 관리 화면·마이페이지가 읽는 값. 구독·결제 내역은 사용자 세션 클라이언트로 읽는다(RLS가 자기 행만 준다).
 * 카드 요약만 고객 행(service role 전용)에서 읽고, 마스킹된 표시 값만 돌려준다 — 빌링키 암호문·토스 고객 키는
 * 고르지도 않는다. 0041 미적용(테이블 없음)이면 빈 값, 그 밖의 오류는 던진다(호출부가 오류 화면 또는 관용 처리).
 */

export type ManagedSubscription = Pick<
  SubscriptionRow,
  | "id"
  | "provider"
  | "livemode"
  | "plan_code"
  | "status"
  | "amount"
  | "currency"
  | "interval"
  | "current_period_start"
  | "current_period_end"
  | "cancel_at_period_end"
  | "grace_until"
>;

const SUBSCRIPTION_COLS =
  "id, provider, livemode, plan_code, status, amount, currency, interval, current_period_start, current_period_end, cancel_at_period_end, grace_until";
/** 결제 관리에서 다루는 결제사 — 토스 정기결제와 기관 수동 계약 */
const PROVIDERS = ["toss", "manual"];

function fail(what: string, error: { message: string }): Error {
  return new Error(`billing manage ${what} lookup failed: ${error.message}`);
}

/** 진행 중(active·past_due) 토스 구독·기관 계약 — 권한 계산과 같은 livemode 범위 안의 행만 */
export async function loadLiveSubscriptions(db: SupabaseClient, userId: string, livemodes: boolean[]): Promise<ManagedSubscription[]> {
  const { data, error } = await db
    .from("subscriptions")
    .select(SUBSCRIPTION_COLS)
    .eq("user_id", userId)
    .in("status", ["active", "past_due"])
    .in("provider", PROVIDERS)
    .in("livemode", livemodes)
    .order("current_period_end", { ascending: true });
  if (error) {
    if (isMissingTable(error)) return [];
    throw fail("subscription", error);
  }
  return (data as ManagedSubscription[] | null) ?? [];
}

/** 토스 구독·기관 계약 행이 하나라도 있는지(끝난 것 포함) — 결제 관리로 가는 길을 보여 줄지 정한다 */
export async function hasBillingRecord(db: SupabaseClient, userId: string, livemodes: boolean[]): Promise<boolean> {
  const { data, error } = await db
    .from("subscriptions")
    .select("id")
    .eq("user_id", userId)
    .in("provider", PROVIDERS)
    .in("livemode", livemodes)
    .limit(1);
  if (error) {
    if (isMissingTable(error)) return false;
    throw fail("subscription", error);
  }
  return Array.isArray(data) && data.length > 0;
}

export type PaymentHistoryRow = Pick<
  PaymentRow,
  "id" | "livemode" | "kind" | "amount" | "currency" | "status" | "receipt_url" | "requested_at" | "approved_at"
>;

const PAYMENT_COLS = "id, livemode, kind, amount, currency, status, receipt_url, requested_at, approved_at";

/** 본인 결제 내역 — 최근 것부터 limit건 */
export async function loadPaymentHistory(db: SupabaseClient, userId: string, livemodes: boolean[], limit = 24): Promise<PaymentHistoryRow[]> {
  const { data, error } = await db
    .from("billing_payments")
    .select(PAYMENT_COLS)
    .eq("user_id", userId)
    .in("livemode", livemodes)
    .order("requested_at", { ascending: false })
    .limit(limit);
  if (error) {
    if (isMissingTable(error)) return [];
    throw fail("payment", error);
  }
  return (data as PaymentHistoryRow[] | null) ?? [];
}

/** jsonb에서 표시 값만 — 문자열이 아니거나 64자를 넘는 값은 버리고, 마스킹 번호가 없으면 요약이 없는 것으로 본다 */
export function cardSummaryOf(raw: unknown): CardSummary | null {
  if (!raw || typeof raw !== "object") return null;
  const c = raw as Record<string, unknown>;
  const s = (v: unknown) => (typeof v === "string" && v.length <= 64 ? v : null);
  const card = { issuerCode: s(c.issuerCode), number: s(c.number), cardType: s(c.cardType) };
  return card.number ? card : null;
}

/**
 * 모드별 등록 카드 요약 — 고객 행은 service role 전용이라 admin으로 읽는다. 호출부는 로그인 사용자를 확인한 뒤
 * 그 사용자의 id로만 부른다. 카드 요약 열만 고른다(암호문·고객 키는 이 함수 밖으로 나가지 않고, 읽지도 않는다).
 */
export async function loadCardSummaries(admin: SupabaseClient, userId: string, livemodes: boolean[]): Promise<Map<boolean, CardSummary>> {
  const cards = new Map<boolean, CardSummary>();
  if (livemodes.length === 0) return cards;
  const { data, error } = await admin
    .from("billing_customers")
    .select("livemode, toss_card_summary")
    .eq("user_id", userId)
    .in("livemode", livemodes);
  if (error) {
    if (isMissingTable(error)) return cards;
    throw fail("card", error);
  }
  for (const row of (data ?? []) as Array<{ livemode: boolean; toss_card_summary: unknown }>) {
    const card = cardSummaryOf(row.toss_card_summary);
    if (card) cards.set(row.livemode, card);
  }
  return cards;
}
