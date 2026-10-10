import "server-only";
import { z } from "zod";
import type { PolarKeys } from "./config";

/**
 * Polar(MoR) REST 클라이언트 — 결제창·구독·주문·환불·고객 포털에 필요한 것만.
 * 액세스 토큰·요청 본문·응답 전문은 오류 메시지에 넣지 않는다 — 호출부가 메시지를 app_errors에 남기고,
 * 응답에는 이메일·주소 같은 개인정보가 있다. 응답도 필요한 필드만 읽고 나머지는 버린다.
 */
const TIMEOUT_MS = 15_000;

export class PolarError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
    /** 보낸 요청이 쓰기(POST·PATCH)였는지 — 요청을 보내기 전에 난 오류(INVALID_ID)는 false */
    public readonly mutating: boolean = false,
  ) {
    super(message);
    this.name = "PolarError";
  }
}

/**
 * 결과 불명 — Polar가 요청을 실제로 처리했을 수 있는 실패.
 * - NETWORK: 연결 실패·시간 초과·리다이렉트, 또는 2xx인데 본문을 읽지 못함
 * - Polar 쪽 5xx·408
 * - 쓰기 요청(결제창·구독 변경·환불·포털 세션)이 2xx를 받았는데 응답 모양이 틀림(BAD_RESPONSE) — 2xx면 Polar는 이미 처리했다
 * 호출부는 실패로 확정하지 않고 조회로 다시 확인한다(같은 주문을 두 번 환불하지 않도록).
 * 읽기 요청의 BAD_RESPONSE는 아무것도 바뀌지 않았으니 결과 불명이 아니다.
 */
export function isPolarOutcomeUnknown(err: unknown): boolean {
  if (!(err instanceof PolarError)) return false;
  // 상태를 먼저 본다 — 5xx·408이면 코드가 무엇이든 결과 불명이다
  if (err.code === "NETWORK" || err.status >= 500 || err.status === 408) return true;
  return err.code === "BAD_RESPONSE" && err.mutating;
}

/** 알려진 값 + 처음 보는 문자열 — Polar가 값을 늘려도 BAD_RESPONSE로 막히지 않고, 매핑은 호출부가 판단한다 */
type Open<T extends string> = T | (string & {});

export type PolarSubscriptionStatus =
  | "incomplete"
  | "incomplete_expired"
  | "trialing"
  | "active"
  | "past_due"
  | "canceled"
  | "unpaid"
  | "paused";
export type PolarRecurringInterval = "day" | "week" | "month" | "year";
export type PolarOrderStatus = "draft" | "pending" | "paid" | "refunded" | "partially_refunded" | "void";
export type PolarBillingReason =
  | "purchase"
  | "subscription_create"
  | "subscription_cycle"
  | "subscription_update"
  | "subscription_meter_cycle";
export type PolarCheckoutStatus = "open" | "expired" | "confirmed" | "succeeded" | "failed";
export type PolarRefundStatus = "pending" | "succeeded" | "failed" | "canceled";
export type PolarRefundReason =
  | "duplicate"
  | "fraudulent"
  | "customer_request"
  | "service_disruption"
  | "satisfaction_guarantee"
  | "other";

/** Polar metadata 값(문자열·숫자·불리언) — 형식을 믿지 않고 unknown으로 둔다 */
export type PolarMetadata = Record<string, unknown>;

/** 날짜는 ISO 문자열 그대로(Date.parse로 읽힌다는 것만 확인). 금액은 cent */
export interface PolarSubscription {
  id: string;
  created_at: string;
  /** 한 번도 바뀌지 않았으면 null */
  modified_at: string | null;
  status: Open<PolarSubscriptionStatus>;
  amount: number;
  currency: string;
  recurring_interval: Open<PolarRecurringInterval>;
  /** 응답에 없으면 1(이 필드가 생기기 전 구독) */
  recurring_interval_count: number;
  current_period_start: string;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  canceled_at: string | null;
  started_at: string | null;
  ends_at: string | null;
  ended_at: string | null;
  /** 이메일·이름은 읽지 않는다(쓰지 않는 개인정보) */
  customer: { id: string; external_id: string | null };
  product_id: string;
  checkout_id: string | null;
  metadata: PolarMetadata;
}

export interface PolarOrder {
  id: string;
  created_at: string;
  modified_at: string | null;
  status: Open<PolarOrderStatus>;
  paid: boolean;
  subtotal_amount: number | null;
  discount_amount: number | null;
  net_amount: number | null;
  tax_amount: number | null;
  total_amount: number;
  /**
   * 세금을 뺀 금액이다(Polar 환불 금액도 세금 제외 — 세금은 Polar가 비율대로 함께 돌려준다). 결제 행(billing_payments)에는
   * refunded_tax_amount를 더해 세금 포함 금액(total_amount)과 같은 기준으로 적는다(flows/mor.ts)
   */
  refunded_amount: number;
  refunded_tax_amount: number | null;
  /** 아직 환불할 수 있는 금액(세금 제외, 고객 잔액·이전 환불 반영). 응답에 없으면 null */
  refundable_amount: number | null;
  currency: string;
  billing_reason: Open<PolarBillingReason>;
  subscription_id: string | null;
  customer: { external_id: string | null } | null;
  product_id: string | null;
  checkout_id: string | null;
  metadata: PolarMetadata;
}

/** client_secret 같은 나머지 필드는 읽지 않는다 */
export interface PolarCheckout {
  id: string;
  status: Open<PolarCheckoutStatus>;
  /** 결제창 주소 — 이동 전에 호출부가 호스트 허용 목록으로 검사한다 */
  url: string;
  expires_at: string;
  external_customer_id: string | null;
  product_id: string | null;
  /** 결제가 끝나 만들어진 구독 — 그 전에는 null */
  subscription_id: string | null;
  /**
   * 할인·세금 전 금액(cent)과 통화 — 결제 시작이 확인 화면에 보인 가격 행과 맞는지 본다(관리자가 넣은 금액과 Polar 상품 가격이
   * 어긋나면 결제창을 열지 않는다). 응답에 없으면 null
   */
  amount: number | null;
  currency: string | null;
  /** 결제창 로케일 — 복귀 라우트가 metadata.locale이 없을 때 쓴다. 응답에 없으면 null */
  locale: string | null;
  /**
   * 결제 주기 — 상품(product)의 recurring_interval, 없으면 상품 가격(product_price, 이전 형식)의 값. 결제 시작이 가격 행의 주기와
   * 맞는지 본다. 처음 보는 값도 문자열 그대로 둔다(호출부가 판정). 응답에 없으면 null
   */
  recurring_interval: Open<PolarRecurringInterval> | null;
  metadata: PolarMetadata;
}

export interface PolarRefund {
  id: string;
  status: Open<PolarRefundStatus>;
  amount: number;
  order_id: string;
  /**
   * 조회(getRefund)에서만 읽는다 — 자동 환불이면 우리 결제 id(payment_id)가 있다(flows/mor.ts가 createRefund에 넣는다).
   * createRefund 응답에서는 읽지 않는다
   */
  metadata?: PolarMetadata;
}

/** 세션 토큰은 따로 읽지 않는다(포털 주소에만 담겨 있다) */
export interface PolarCustomerSession {
  customer_portal_url: string;
  expires_at: string | null;
}

export interface PolarCheckoutInput {
  products: string[];
  /** a11ychk 사용자 id — Polar 고객의 external_id가 된다 */
  external_customer_id: string;
  customer_email?: string;
  /** `checkout_id={CHECKOUT_ID}`를 넣으면 Polar가 채운다 */
  success_url: string;
  return_url?: string;
  metadata?: Record<string, string | number | boolean>;
  locale?: string;
}

export interface PolarRefundInput {
  order_id: string;
  reason: PolarRefundReason;
  /** cent, 1 이상 */
  amount: number;
  comment?: string;
  metadata?: Record<string, string | number | boolean>;
}

export interface PolarCustomerSessionInput {
  external_customer_id: string;
  return_url?: string;
}

/** 끝 기간 해지 예약·예약 취소, 또는 즉시 해지 — 둘을 한 번에 보내지 않는다 */
export type PolarSubscriptionChange =
  | { cancel_at_period_end: boolean; revoke?: never }
  | { revoke: true; cancel_at_period_end?: never };

export interface PolarClient {
  createCheckout(input: PolarCheckoutInput): Promise<PolarCheckout>;
  getCheckout(id: string): Promise<PolarCheckout>;
  getSubscription(id: string): Promise<PolarSubscription>;
  updateSubscription(id: string, change: PolarSubscriptionChange): Promise<PolarSubscription>;
  getOrder(id: string): Promise<PolarOrder>;
  /** Polar에는 환불 한 건 조회가 없어 목록(GET /v1/refunds/?id=)을 id로 거른다. 없으면 PolarError 404(ResourceNotFound) */
  getRefund(id: string): Promise<PolarRefund>;
  createRefund(input: PolarRefundInput): Promise<PolarRefund>;
  createCustomerSession(input: PolarCustomerSessionInput): Promise<PolarCustomerSession>;
}

// ── 응답 스키마 — z.object는 모르는 필드를 버린다 ──

const isoDate = z.string().refine((s) => Number.isFinite(Date.parse(s)), "not a date");
const nullableDate = isoDate.nullish().transform((v) => v ?? null);
const nullableString = z.string().nullish().transform((v) => v ?? null);
const cents = z.number().int().nonnegative();
const nullableCents = cents.nullish().transform((v) => v ?? null);
const metadata = z
  .record(z.unknown())
  .nullish()
  .transform((v): PolarMetadata => v ?? {});
const requiredId = z.string().min(1);
/** 사용자를 보내는 주소 — https만(javascript:·data:·http는 BAD_RESPONSE). 호스트 허용 목록 검사는 호출부 몫 */
const httpsUrl = z
  .string()
  .url()
  .refine((s) => s.startsWith("https://"), "not https");

const subscriptionSchema: z.ZodType<PolarSubscription, z.ZodTypeDef, unknown> = z.object({
  id: requiredId,
  created_at: isoDate,
  modified_at: nullableDate,
  status: z.string().min(1),
  amount: cents,
  currency: z.string().min(1),
  recurring_interval: z.string().min(1),
  recurring_interval_count: z
    .number()
    .int()
    .positive()
    .nullish()
    .transform((v) => v ?? 1),
  current_period_start: isoDate,
  current_period_end: nullableDate,
  cancel_at_period_end: z.boolean(),
  canceled_at: nullableDate,
  started_at: nullableDate,
  ends_at: nullableDate,
  ended_at: nullableDate,
  customer: z.object({ id: requiredId, external_id: nullableString }),
  product_id: requiredId,
  checkout_id: nullableString,
  metadata,
});

const orderSchema: z.ZodType<PolarOrder, z.ZodTypeDef, unknown> = z.object({
  id: requiredId,
  created_at: isoDate,
  modified_at: nullableDate,
  status: z.string().min(1),
  paid: z.boolean(),
  subtotal_amount: nullableCents,
  discount_amount: nullableCents,
  net_amount: nullableCents,
  tax_amount: nullableCents,
  total_amount: cents,
  refunded_amount: cents,
  refunded_tax_amount: nullableCents,
  refundable_amount: nullableCents,
  currency: z.string().min(1),
  billing_reason: z.string().min(1),
  subscription_id: nullableString,
  customer: z
    .object({ external_id: nullableString })
    .nullish()
    .transform((v) => v ?? null),
  product_id: nullableString,
  checkout_id: nullableString,
  metadata,
});

/** 결제창의 상품·상품 가격 — 결제 주기만 읽는다(이름·가격 목록 같은 나머지는 버린다) */
const intervalHolder = z
  .object({ recurring_interval: nullableString })
  .nullish()
  .transform((v) => v?.recurring_interval ?? null);

const checkoutSchema: z.ZodType<PolarCheckout, z.ZodTypeDef, unknown> = z
  .object({
    id: requiredId,
    status: z.string().min(1),
    url: httpsUrl,
    expires_at: isoDate,
    external_customer_id: nullableString,
    product_id: nullableString,
    subscription_id: nullableString,
    amount: nullableCents,
    currency: nullableString,
    locale: nullableString,
    product: intervalHolder,
    product_price: intervalHolder,
    metadata,
  })
  .transform(({ product, product_price, ...rest }) => ({ ...rest, recurring_interval: product ?? product_price }));

const refundFields = {
  id: requiredId,
  status: z.string().min(1),
  amount: cents,
  order_id: requiredId,
};
const refundSchema: z.ZodType<PolarRefund, z.ZodTypeDef, unknown> = z.object(refundFields);
/** 환불 목록 — 항목마다 metadata까지(자동 환불의 결제 id). pagination 같은 나머지는 버린다 */
const refundListSchema: z.ZodType<{ items: PolarRefund[] }, z.ZodTypeDef, unknown> = z.object({
  items: z.array(z.object({ ...refundFields, metadata })),
});

const customerSessionSchema: z.ZodType<PolarCustomerSession, z.ZodTypeDef, unknown> = z.object({
  customer_portal_url: httpsUrl,
  expires_at: nullableDate,
});

// ── 호출 ──

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** 오류 코드로 받아들일 모양 — 그 밖의 문자열은 본문 내용일 수 있어 HTTP_<상태>로 바꾼다 */
const CODE_RE = /^[A-Za-z][A-Za-z0-9_.-]{0,79}$/;
/** 이 모듈이 스스로 붙이는 코드 — 서버 본문이 같은 값을 보내도 HTTP_<상태>로 바꾼다(결과 불명 판정이 흔들리지 않게) */
const RESERVED_CODES = new Set(["NETWORK", "BAD_RESPONSE", "INVALID_ID"]);

/** 경로에 넣는 id는 UUID만 — 사용자 입력(return 주소의 checkout_id 등)이 경로를 바꾸지 못하게 */
function idPath(prefix: string, id: string): string {
  if (typeof id !== "string" || !UUID_RE.test(id)) throw new PolarError("INVALID_ID", "polar id is not a uuid", 0);
  return `${prefix}${encodeURIComponent(id)}`;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function errorCode(body: unknown, status: number): string {
  if (isPlainObject(body)) {
    for (const key of ["error", "type"] as const) {
      const v = body[key];
      if (typeof v === "string" && CODE_RE.test(v)) return RESERVED_CODES.has(v) ? `HTTP_${status}` : v;
    }
  }
  return `HTTP_${status}`;
}

interface PolarClientDeps {
  fetchImpl: typeof fetch;
  base: string;
  auth: string;
}

async function call<T>(
  deps: PolarClientDeps,
  op: string,
  init: { method: "GET" | "POST" | "PATCH"; path: string; body?: unknown },
  schema: z.ZodType<T, z.ZodTypeDef, unknown>,
): Promise<T> {
  let res: Response;
  const mutating = init.method !== "GET";
  // 지역 변수로 호출 — deps 객체가 this로 묶이면 일부 런타임의 fetch가 Illegal invocation을 낸다
  const doFetch = deps.fetchImpl;
  try {
    res = await doFetch(`${deps.base}${init.path}`, {
      method: init.method,
      cache: "no-store",
      // 리다이렉트를 따라가지 않는다 — Bearer 토큰이 다른 주소로 가지 않게. 실제 fetch는 3xx에서 예외를 던져 NETWORK가 된다
      redirect: "error",
      headers: {
        Authorization: deps.auth,
        Accept: "application/json",
        ...(init.body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    // 시간 초과·연결 실패·리다이렉트 — Polar가 처리했는지 알 수 없다. 원래 오류 문구는 싣지 않는다
    throw new PolarError("NETWORK", `polar ${op} failed (network)`, 0, mutating);
  }
  if (!res.ok) {
    const parsedError: unknown = await res.json().catch(() => null);
    const code = errorCode(parsedError, res.status);
    throw new PolarError(code, `polar ${op} failed: ${code} (${res.status})`, res.status, mutating);
  }
  // 본문을 읽다 시간 초과·끊김이 나도 Polar는 이미 처리했을 수 있다 — 결과 불명으로
  let parsed: unknown;
  try {
    parsed = await res.json();
  } catch {
    throw new PolarError("NETWORK", `polar ${op} response unreadable`, 0, mutating);
  }
  const result = schema.safeParse(parsed);
  if (!result.success) {
    // 필드 경로만 — zod 메시지에는 받은 값이 들어갈 수 있다
    const fields = [...new Set(result.error.issues.map((i) => i.path.join(".") || "(root)"))].slice(0, 10).join(", ");
    throw new PolarError("BAD_RESPONSE", `polar ${op} response invalid: ${fields}`, res.status, mutating);
  }
  return result.data;
}

export function createPolarClient(keys: Pick<PolarKeys, "accessToken" | "apiBase">, fetchImpl: typeof fetch = fetch): PolarClient {
  const deps: PolarClientDeps = { fetchImpl, base: keys.apiBase.replace(/\/+$/, ""), auth: `Bearer ${keys.accessToken}` };
  return {
    createCheckout(input) {
      // 무료 체험·할인 코드는 쓰지 않는다 — 호출부가 무엇을 넘기든 여기서 끈다
      const body = { ...input, allow_trial: false, allow_discount_codes: false };
      return call(deps, "createCheckout", { method: "POST", path: "/v1/checkouts/", body }, checkoutSchema);
    },
    async getCheckout(id) {
      return call(deps, "getCheckout", { method: "GET", path: idPath("/v1/checkouts/", id) }, checkoutSchema);
    },
    async getSubscription(id) {
      return call(deps, "getSubscription", { method: "GET", path: idPath("/v1/subscriptions/", id) }, subscriptionSchema);
    },
    async updateSubscription(id, change) {
      const body = change.revoke === true ? { revoke: true } : { cancel_at_period_end: change.cancel_at_period_end };
      return call(deps, "updateSubscription", { method: "PATCH", path: idPath("/v1/subscriptions/", id), body }, subscriptionSchema);
    },
    async getOrder(id) {
      return call(deps, "getOrder", { method: "GET", path: idPath("/v1/orders/", id) }, orderSchema);
    },
    async getRefund(id) {
      // 목록 조회는 refunds:read 또는 refunds:write 스코프로 된다(환불을 만드는 토큰이면 따로 스코프를 더하지 않아도 된다)
      const path = `${idPath("/v1/refunds/?id=", id)}&limit=1`;
      const { items } = await call(deps, "getRefund", { method: "GET", path }, refundListSchema);
      const found = items.find((r) => r.id.toLowerCase() === id.toLowerCase());
      if (!found) throw new PolarError("ResourceNotFound", "polar getRefund failed: ResourceNotFound (404)", 404);
      return found;
    },
    createRefund(input) {
      return call(deps, "createRefund", { method: "POST", path: "/v1/refunds/", body: input }, refundSchema);
    },
    createCustomerSession(input) {
      return call(deps, "createCustomerSession", { method: "POST", path: "/v1/customer-sessions/", body: input }, customerSessionSchema);
    },
  };
}
