import type { CardSummary, TossClient } from "./toss";

/**
 * 결제 흐름(flows/*)이 주입받는 의존성의 모양. 행 타입은 0041의 열 이름을 그대로 쓴다.
 * 실제 구현은 store.ts(Supabase)·toss.ts·server.ts(메일러 조립), 테스트는 메모리 구현이다.
 */

export interface PriceRow { id: string; plan_code: string; provider: "toss" | "mor" | "manual"; currency: "KRW" | "USD"; interval: "month" | "year"; amount: number; livemode: boolean; active: boolean }
export interface CustomerRow { id: string; user_id: string; livemode: boolean; toss_customer_key: string | null; toss_billing_key_enc: string | null; toss_card_summary: CardSummary | null }
export interface CheckoutRow { id: string; user_id: string; provider: "toss" | "mor"; livemode: boolean; price_id: string; purpose: "subscribe" | "card_change"; status: "open" | "processing" | "completed" | "failed" | "expired"; failure_code: string | null; subscription_id: string | null; expires_at: string }
export interface SubscriptionRow { id: string; user_id: string | null; provider: "toss" | "mor" | "manual"; livemode: boolean; plan_code: string; status: "active" | "past_due" | "ended"; ended_reason: string | null; price_id: string | null; amount: number; currency: "KRW" | "USD"; interval: "month" | "year" | "contract"; current_period_start: string; current_period_end: string; billing_anchor_day: number | null; cancel_at_period_end: boolean; canceled_at: string | null; ended_at: string | null; dunning_attempts: number; next_retry_at: string | null; grace_until: string | null; reminder_sent_for: string | null }
export interface PaymentRow { id: string; user_id: string | null; subscription_id: string | null; checkout_id: string | null; provider: "toss" | "mor" | "manual"; livemode: boolean; kind: "initial" | "renewal" | "retry" | "manual"; order_id: string; external_payment_id: string | null; amount: number; currency: "KRW" | "USD"; period_start: string | null; period_end: string | null; attempt: number; status: "pending" | "paid" | "failed" | "refunded" | "partially_refunded"; failure_code: string | null; failure_message: string | null; receipt_url: string | null; card_summary: CardSummary | null; refunded_amount: number; requested_at: string; approved_at: string | null }

/** refunded_amount는 DB 기본값 0으로 시작한다 */
export type NewPayment = Omit<PaymentRow, "id" | "requested_at" | "external_payment_id" | "failure_code" | "failure_message" | "receipt_url" | "card_summary" | "refunded_amount" | "approved_at">;
export type NewSubscription = Pick<SubscriptionRow, "user_id" | "provider" | "livemode" | "plan_code" | "price_id" | "amount" | "currency" | "interval" | "current_period_start" | "current_period_end" | "billing_anchor_day">;

/** 조건부 구독 갱신의 기대값 — 읽은 뒤 다른 요청이 바꿨으면 덮어쓰지 않는다 */
export interface SubscriptionExpectation {
  statuses: Array<"active" | "past_due">;
  /** 행에서 읽은 값 그대로 — 표기가 달라도 같은 시각이면 같다 */
  currentPeriodEnd?: string;
  /** 안내 선점: reminder_sent_for가 비었거나 이 시각이 아닐 때만 */
  reminderNotSentFor?: string;
}

export interface BillingStore {
  /** open이고 만료 전이며 그 사용자 것이면 processing으로 바꿔 돌려준다(원자적 선점) */
  claimCheckout(id: string, userId: string, nowIso: string): Promise<CheckoutRow | null>;
  getCheckout(id: string): Promise<CheckoutRow | null>;
  /** 끝나지 않은(open·processing) 시도만 바꾼다 — 늦게 도착한 실패가 completed를 덮지 않게 */
  finishCheckout(id: string, patch: { status: "completed" | "failed"; failure_code?: string | null; subscription_id?: string | null }): Promise<void>;
  getPrice(id: string): Promise<PriceRow | null>;
  getCustomer(userId: string, livemode: boolean): Promise<CustomerRow | null>;
  updateCustomer(id: string, patch: { toss_billing_key_enc: string | null; toss_card_summary: CardSummary | null }): Promise<void>;
  /**
   * 이 실행이 쓴 암호문일 때만 빌링키·카드 요약을 지운다(지웠으면 true). 그 사이 다른 시도가
   * 새 빌링키를 썼다면 그대로 둔다 — 남의 빌링키를 지우면 진행 중 구독이 갱신할 카드를 잃는다.
   */
  clearCustomerKeyIf(customerId: string, expectedEnc: string): Promise<boolean>;
  /** 유니크 위반(같은 시도·같은 주문번호)이면 "duplicate" */
  insertPayment(row: NewPayment): Promise<PaymentRow | "duplicate">;
  updatePayment(id: string, patch: Partial<Omit<PaymentRow, "id">>): Promise<void>;
  getSubscription(id: string): Promise<SubscriptionRow | null>;
  /** 진행 중(active·past_due) 구독 */
  getLiveSubscription(userId: string, livemode: boolean): Promise<SubscriptionRow | null>;
  /** 진행 중 구독 1건 유니크 위반이면 "hasActive". 새 행은 status active */
  insertSubscription(row: NewSubscription): Promise<SubscriptionRow | "hasActive">;
  updateSubscription(id: string, patch: Partial<Omit<SubscriptionRow, "id">>): Promise<void>;
  /** 기대값과 맞을 때만 바꾼다(바꿨으면 true) — 크론과 카드 변경·해지가 엇갈려도 서로 덮어쓰지 않게 */
  updateSubscriptionIf(id: string, expected: SubscriptionExpectation, patch: Partial<Omit<SubscriptionRow, "id">>): Promise<boolean>;
  linkConsents(checkoutId: string, subscriptionId: string): Promise<void>;
  /** 크론 후보: toss, livemode, active·past_due, 기간 끝이 now+31일 이내 — 오래된 것부터 limit건 */
  listCycleCandidates(livemode: boolean, nowIso: string, limit: number): Promise<SubscriptionRow[]>;
  /** 대사 후보: toss, livemode, pending, requested_at < olderThanIso */
  listPendingPayments(livemode: boolean, olderThanIso: string, limit: number): Promise<PaymentRow[]>;
  /** 이 구독에 결과를 모르는(pending) 결제가 있는지 — 나이·개수 제한 없이 */
  hasPendingPayment(subscriptionId: string): Promise<boolean>;
}

export type BillingEmailKind = "receipt" | "failed" | "reminder" | "cancelScheduled" | "ended";
export interface BillingMailer {
  /** 수신자 조회·발송 모두 best-effort — 실패해도 결제 흐름을 멈추지 않는다 */
  send(userId: string | null, kind: BillingEmailKind, data: Record<string, unknown>): Promise<void>;
}

export interface BillingDeps {
  store: BillingStore;
  toss: TossClient;
  encKey: Buffer;
  mailer: BillingMailer;
  now: () => number;
  /** 비밀 값(빌링키·authKey·키)을 넣지 않는다 — app_errors에 남는다 */
  log: (message: string) => Promise<void>;
}
