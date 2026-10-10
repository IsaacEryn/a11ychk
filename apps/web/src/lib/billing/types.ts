import type { PolarClient } from "./polar";
import type { CardSummary, TossClient } from "./toss";

/**
 * 결제 흐름(flows/*)이 주입받는 의존성의 모양. 행 타입은 0041의 열 이름을 그대로 쓴다.
 * 실제 구현은 store.ts(Supabase)·toss.ts·server.ts(메일러 조립), 테스트는 메모리 구현이다.
 */

export interface PriceRow { id: string; plan_code: string; provider: "toss" | "mor" | "manual"; currency: "KRW" | "USD"; interval: "month" | "year"; amount: number; livemode: boolean; active: boolean; external_price_id: string | null }
export interface CustomerRow { id: string; user_id: string; livemode: boolean; toss_customer_key: string | null; toss_billing_key_enc: string | null; toss_card_summary: CardSummary | null }
export interface CheckoutRow { id: string; user_id: string; provider: "toss" | "mor"; livemode: boolean; price_id: string; purpose: "subscribe" | "card_change"; status: "open" | "processing" | "completed" | "failed" | "expired"; failure_code: string | null; subscription_id: string | null; expires_at: string }
export interface SubscriptionRow { id: string; user_id: string | null; provider: "toss" | "mor" | "manual"; livemode: boolean; plan_code: string; status: "active" | "past_due" | "ended"; ended_reason: string | null; price_id: string | null; amount: number; currency: "KRW" | "USD"; interval: "month" | "year" | "contract"; current_period_start: string; current_period_end: string; billing_anchor_day: number | null; cancel_at_period_end: boolean; canceled_at: string | null; ended_at: string | null; dunning_attempts: number; next_retry_at: string | null; grace_until: string | null; reminder_sent_for: string | null }
export interface PaymentRow { id: string; user_id: string | null; subscription_id: string | null; checkout_id: string | null; provider: "toss" | "mor" | "manual"; livemode: boolean; kind: "initial" | "renewal" | "retry" | "manual"; order_id: string; external_payment_id: string | null; amount: number; currency: "KRW" | "USD"; period_start: string | null; period_end: string | null; attempt: number; status: "pending" | "paid" | "failed" | "refunded" | "partially_refunded"; failure_code: string | null; failure_message: string | null; receipt_url: string | null; card_summary: CardSummary | null; refunded_amount: number; requested_at: string; approved_at: string | null }

/** 판매 대행(MoR) 구독의 외부 열 — 토스 흐름은 읽지 않는다 */
export interface MorSubscriptionFields { mor_provider: "paddle" | "polar" | null; external_id: string | null; external_customer_id: string | null; external_updated_at: string | null }
export type MorSubscriptionRow = SubscriptionRow & MorSubscriptionFields;
/** 새 MoR 구독 — 상태는 결제사 값으로 정한다(토스의 insertSubscription과 달리 active로 고정하지 않는다) */
export type NewMorSubscription = Pick<
  SubscriptionRow,
  "user_id" | "livemode" | "plan_code" | "price_id" | "amount" | "currency" | "interval" | "current_period_start" | "current_period_end" | "status" | "cancel_at_period_end" | "canceled_at" | "grace_until"
> & { provider: "mor"; mor_provider: "polar"; billing_anchor_day: null; external_id: string; external_customer_id: string | null; external_updated_at: string };
export type MorSubscriptionPatch = Partial<Omit<MorSubscriptionRow, "id">>;
/** amount는 결제사에 요청한 환불 금액 — MoR(Polar)은 세금 제외(결제 행의 amount·refunded_amount는 세금 포함이라 기준이 다르다) */
export interface RefundRow { id: string; payment_id: string; amount: number; reason: string; external_refund_id: string | null; status: "pending" | "succeeded" | "failed"; requested_by: string | null }
/** id를 주면 그 id로 넣는다(자동 환불의 결정적 id — 기본 키가 선점이 된다). 없으면 DB 기본값(무작위) */
export type NewRefund = Omit<RefundRow, "id"> & { id?: string };

/** refunded_amount는 DB 기본값 0으로 시작한다 */
export type NewPayment = Omit<PaymentRow, "id" | "requested_at" | "external_payment_id" | "failure_code" | "failure_message" | "receipt_url" | "card_summary" | "refunded_amount" | "approved_at">;
/** 결제사가 정한 결제(MoR 주문) — 결제사 id·환불액·승인 시각을 처음부터 채운다 */
export type NewExternalPayment = NewPayment & { external_payment_id: string; refunded_amount: number; approved_at: string | null };
export type NewSubscription = Pick<SubscriptionRow, "user_id" | "provider" | "livemode" | "plan_code" | "price_id" | "amount" | "currency" | "interval" | "current_period_start" | "current_period_end" | "billing_anchor_day">;
/** 새 결제 시도 — status는 open, failure_code는 비어 시작한다 */
export type NewCheckout = Pick<CheckoutRow, "user_id" | "provider" | "livemode" | "price_id" | "purpose" | "subscription_id" | "expires_at">;
/** 정기결제 동의 기록 — 화면에 보여 준 조건의 스냅샷(accepted는 DB 기본값 true) */
export interface NewConsent {
  user_id: string;
  checkout_id: string;
  kind: "recurring_payment";
  disclosure_version: string;
  snapshot: Record<string, unknown>;
}
/** 웹훅을 보내는 결제사(billing_webhook_events.provider) */
export type WebhookProvider = "polar";
/** billing_webhook_events.payload — 본문 전문에는 개인정보(이메일·주소)가 있어 종류와 대상 id만 남긴다 */
export interface WebhookEventPayload {
  type: string;
  data_id: string | null;
}
/** new: 처음 받음 / retry: 처리 전 행이 있었다(attempts를 올렸다) / done: 이미 처리했다 */
export type WebhookEventRecord = "new" | "retry" | "done";

/** 토스 고객 키가 채워진 고객 행 */
export type TossCustomerRow = CustomerRow & { toss_customer_key: string };

/** 조건부 구독 갱신의 기대값 — 읽은 뒤 다른 요청이 바꿨으면 덮어쓰지 않는다 */
export interface SubscriptionExpectation {
  statuses: Array<"active" | "past_due">;
  /** 행에서 읽은 값 그대로 — 표기가 달라도 같은 시각이면 같다 */
  currentPeriodEnd?: string;
  /** 안내 선점: reminder_sent_for가 비었거나 이 시각이 아닐 때만 */
  reminderNotSentFor?: string;
  /** 해지 예약 여부가 이 값일 때만(예약 만료 종료 — 그 사이 해지를 취소했으면 끝내지 않는다) */
  cancelAtPeriodEnd?: boolean;
}

export interface BillingStore {
  /** open이고 만료 전이며 그 사용자·그 모드의 것이면 processing으로 바꿔 돌려준다(원자적 선점) */
  claimCheckout(id: string, userId: string, livemode: boolean, nowIso: string): Promise<CheckoutRow | null>;
  getCheckout(id: string): Promise<CheckoutRow | null>;
  /** 끝나지 않은(open·processing) 시도만 바꾼다 — 늦게 도착한 실패가 completed를 덮지 않게 */
  finishCheckout(id: string, patch: { status: "completed" | "failed"; failure_code?: string | null; subscription_id?: string | null }): Promise<void>;
  /** 결제 시도 생성(open) */
  insertCheckout(row: NewCheckout): Promise<CheckoutRow>;
  /** 그 사용자·모드의 끝나지 않은(open·processing) 시도 — 만료 여부와 무관하게 */
  listUnfinishedCheckouts(userId: string, livemode: boolean): Promise<CheckoutRow[]>;
  /**
   * 시도들을 expired로 닫는다 — 지금 상태가 from일 때만(그 사이 선점·완료된 시도는 덮지 않는다).
   * failureCode가 null이면 실패 코드는 그대로 둔다
   */
  expireCheckouts(ids: string[], from: "open" | "processing", failureCode: string | null): Promise<void>;
  insertConsent(row: NewConsent): Promise<void>;
  getPrice(id: string): Promise<PriceRow | null>;
  getCustomer(userId: string, livemode: boolean): Promise<CustomerRow | null>;
  /**
   * 토스 고객 행을 돌려준다 — 없으면 newCustomerKey로 만들고, 행은 있는데 토스 고객 키가 비었으면 채운다.
   * (user_id, livemode) 유니크라 동시에 만들면 한쪽이 지고, 진 쪽은 다시 읽어 이긴 쪽의 행을 쓴다
   */
  ensureCustomer(userId: string, livemode: boolean, newCustomerKey: string): Promise<TossCustomerRow>;
  updateCustomer(id: string, patch: { toss_billing_key_enc: string | null; toss_card_summary: CardSummary | null }): Promise<void>;
  /**
   * 이 실행이 쓴 암호문일 때만 빌링키·카드 요약을 지운다(지웠으면 true). 그 사이 다른 시도가
   * 새 빌링키를 썼다면 그대로 둔다 — 남의 빌링키를 지우면 진행 중 구독이 갱신할 카드를 잃는다.
   */
  clearCustomerKeyIf(customerId: string, expectedEnc: string): Promise<boolean>;
  /** 유니크 위반(같은 시도·같은 주문번호)이면 "duplicate" */
  insertPayment(row: NewPayment): Promise<PaymentRow | "duplicate">;
  updatePayment(id: string, patch: Partial<Omit<PaymentRow, "id">>): Promise<void>;
  /**
   * 토스에 보내지 않은 결제 행을 지운다(지웠으면 true) — pending이고 결제사 결제 id가 없을 때만.
   * 결제 직전 다시 읽은 구독이 판정과 달라 결제하지 않을 때 쓴다(실패로 닫으면 그 시도 칸이 막힌다)
   */
  deletePendingPayment(id: string): Promise<boolean>;
  getSubscription(id: string): Promise<SubscriptionRow | null>;
  /** 진행 중(active·past_due) 구독 */
  getLiveSubscription(userId: string, livemode: boolean): Promise<SubscriptionRow | null>;
  /** 그 사용자의 진행 중(active·past_due) 구독 — 두 livemode·모든 결제사(탈퇴 정리용, 모드당 1건이라 많아야 둘) */
  listLiveSubscriptions(userId: string): Promise<SubscriptionRow[]>;
  /** 진행 중 구독 1건 유니크 위반이면 "hasActive". 새 행은 status active */
  insertSubscription(row: NewSubscription): Promise<SubscriptionRow | "hasActive">;
  updateSubscription(id: string, patch: Partial<Omit<SubscriptionRow, "id">>): Promise<void>;
  /** 기대값과 맞을 때만 바꾼다(바꿨으면 true) — 크론과 카드 변경·해지가 엇갈려도 서로 덮어쓰지 않게 */
  updateSubscriptionIf(id: string, expected: SubscriptionExpectation, patch: Partial<Omit<SubscriptionRow, "id">>): Promise<boolean>;
  linkConsents(checkoutId: string, subscriptionId: string): Promise<void>;
  /** 크론 후보: toss, livemode, active·past_due, 기간 끝이 now+33일 이내(연간 D-30 안내까지) — 오래된 것부터 limit건 */
  listCycleCandidates(livemode: boolean, nowIso: string, limit: number): Promise<SubscriptionRow[]>;
  /** 대사 후보: toss, livemode, pending, requested_at < olderThanIso */
  listPendingPayments(livemode: boolean, olderThanIso: string, limit: number): Promise<PaymentRow[]>;
  /** 이 구독에 결과를 모르는(pending) 결제가 있는지 — 나이·개수 제한 없이 */
  hasPendingPayment(subscriptionId: string): Promise<boolean>;
  /**
   * 그 사용자·모드에 결과를 모르는(pending) 첫 결제가 있는지 — 결제를 확인하는 동안 새 시도를 막는다.
   * 결제사(provider)는 일부러 보지 않는다: 진행 중 구독 1건 규칙이 토스·MoR를 합쳐서라, 결과를 모르는 MoR 첫 결제도 토스 결제 시작을 막는다
   */
  hasPendingInitialPayment(userId: string, livemode: boolean): Promise<boolean>;
  /**
   * 같은 구독·같은 기간 시작의 failed 결제 중 실패 코드가 제외 목록(코드·접두)에 없는 것이 있는지.
   * 실패 코드가 없는 행은 세지 않는다
   */
  hasUserFacingFailure(subscriptionId: string, periodStart: string, exclude: { codes: readonly string[]; prefixes: readonly string[] }): Promise<boolean>;
  /**
   * 이 구독에서 그 기간 시작(periodStart)으로 확정된(paid) 갱신·재시도 결제 — 여럿이면 가장 늦게 요청한 것, 없으면 null.
   * 탈퇴 정리가 모은 뒤 끼어든 갱신을 찾을 때 쓴다
   */
  findPaidRenewal(subscriptionId: string, periodStart: string): Promise<PaymentRow | null>;

  // ── 판매 대행(MoR) — flows/mor.ts ──

  /** 그 결제사 가격 id(Polar product id)에 묶인 가격 행 — 비활성 행도 돌려준다(기존 구독 매핑) */
  findPriceByExternal(provider: PriceRow["provider"], externalPriceId: string, livemode: boolean): Promise<PriceRow | null>;
  /** profiles 행이 있는지 — UUID 모양이 아니면 조회 없이 false */
  profileExists(userId: string): Promise<boolean>;
  /** (provider, external_id) 유니크 — 그 모드의 행만 */
  getSubscriptionByExternal(provider: SubscriptionRow["provider"], externalId: string, livemode: boolean): Promise<MorSubscriptionRow | null>;
  /**
   * 유니크 위반이면 "conflict" — 같은 외부 id가 먼저 들어갔거나(동시 동기화) 그 사용자에게 진행 중 구독이 이미 있다.
   * 어느 쪽인지는 호출부가 다시 읽어 가른다(제약 이름에 기대지 않는다)
   */
  insertMorSubscription(row: NewMorSubscription): Promise<MorSubscriptionRow | "conflict">;
  /**
   * 조건부 갱신 — 상태가 expected.status이고 external_updated_at이 비었거나 expected.notAfter 이하일 때만(같으면 재전송이라 다시 적는다).
   * 바꿨으면 "updated", 조건이 안 맞으면 "skipped", 진행 중 1건 유니크 위반(되살리기)이면 "conflict".
   * notAfter는 마이크로초까지의 ISO 시각이어야 한다(PostgREST 필터에 들어간다)
   */
  updateMorSubscriptionIf(id: string, expected: { status: SubscriptionRow["status"]; notAfter: string }, patch: MorSubscriptionPatch): Promise<"updated" | "skipped" | "conflict">;
  /** (provider, external_payment_id) 유니크 — 그 모드의 행만 */
  getPaymentByExternal(provider: PaymentRow["provider"], externalPaymentId: string, livemode: boolean): Promise<PaymentRow | null>;
  /** 유니크 위반(같은 주문·주문번호, 같은 구독·기간·시도의 갱신)이면 "duplicate" */
  insertExternalPayment(row: NewExternalPayment): Promise<PaymentRow | "duplicate">;
  /** 상태·환불액이 읽은 값 그대로일 때만 바꾼다(바꿨으면 true) — 늦게 읽은 주문이 앞선 환불 기록을 되돌리지 않게 */
  updatePaymentIf(id: string, expected: { status: PaymentRow["status"]; refundedAmount: number }, patch: Partial<Omit<PaymentRow, "id">>): Promise<boolean>;
  /** 그 결제 시도(billing_checkouts id)에 묶인 첫 결제 — 여럿이면 가장 먼저 요청한 것 */
  findInitialPaymentByCheckout(checkoutId: string, provider: PaymentRow["provider"], livemode: boolean): Promise<PaymentRow | null>;
  /**
   * 이 결제에 그 id의 환불 기록이 있는지(상태 무관) — 자동 환불의 결정적 id(flows/mor.ts morAutoRefundId)로 묻는다.
   * 관리자 부분 환불(무작위 id)은 세지 않는다
   */
  hasRefundFor(paymentId: string, refundId: string): Promise<boolean>;
  /** 기본 키 위반(같은 id가 이미 있음)이면 "duplicate" — 자동 환불의 선점이 진 쪽 */
  insertRefund(row: NewRefund): Promise<RefundRow | "duplicate">;
  updateRefund(id: string, patch: Partial<Pick<RefundRow, "status" | "external_refund_id">>): Promise<void>;
  /** 결제사 환불 id로 찾은 환불 기록 — 같은 id가 여럿이면(만들지 않지만) 먼저 만든 것 */
  findRefundByExternal(externalRefundId: string): Promise<RefundRow | null>;
  getRefund(id: string): Promise<RefundRow | null>;
  /**
   * 상태와 결제사 환불 id가 읽은 값 그대로일 때만 바꾼다(바꿨으면 true) — 환불 웹훅이 엇갈려 와도 앞선 결과를 덮지 않게.
   * externalRefundId가 null이면 "아직 비어 있음"이 조건이다
   */
  updateRefundIf(
    id: string,
    expected: { status: RefundRow["status"]; externalRefundId: string | null },
    patch: Partial<Pick<RefundRow, "status" | "external_refund_id">>,
  ): Promise<boolean>;

  // ── 웹훅 이벤트(billing_webhook_events) — flows/morWebhook.ts ──

  /**
   * 받은 이벤트를 적는다 — (provider, event_id) 기본 키가 재전송을 가른다. 처음이면 "new", 처리 전 행이 있으면 attempts를 하나
   * 올리고 "retry", 이미 처리했으면 "done". attempts는 읽고 쓰는 두 단계라 같은 이벤트가 동시에 오면 하나가 덜 셀 수 있다(횟수 기록일 뿐이다).
   * payload는 {type, data_id}만 — 본문을 넣지 않는다
   */
  recordWebhookEvent(provider: WebhookProvider, eventId: string, type: string, payload: WebhookEventPayload): Promise<WebhookEventRecord>;
  /**
   * 처리 결과 — error가 없으면 processed_at, 있으면 last_error만 적는다(처리 전 행만 바꾼다 — 먼저 끝난 재전송의 완료를 덮지 않게).
   * error는 짧은 코드·문구다(비밀·본문 없음, 저장소가 500자에서 자른다)
   */
  finishWebhookEvent(provider: WebhookProvider, eventId: string, outcome: { error?: string }): Promise<void>;
}

export type BillingEmailKind = "receipt" | "failed" | "reminder" | "cancelScheduled" | "ended";
export interface BillingMailer {
  /** 수신자 조회·발송 모두 best-effort — 실패해도 결제 흐름을 멈추지 않는다 */
  send(userId: string | null, kind: BillingEmailKind, data: Record<string, unknown>): Promise<void>;
}

/**
 * 판매 대행(Polar) 흐름의 의존성 — 토스 키·암호화 키·메일러가 없다(MoR 영수증·실패 안내는 Polar가 보낸다).
 * 토스 없이 Polar만 설정한 배포에서도 동작한다.
 */
export interface MorDeps {
  store: BillingStore;
  polar: PolarClient;
  now: () => number;
  /** 비밀 값·이메일을 넣지 않는다(id만) — app_errors에 남는다 */
  log: (message: string) => Promise<void>;
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
