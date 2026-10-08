import "server-only";

/**
 * 토스페이먼츠 REST 클라이언트(자동결제에 필요한 것만). 비밀 값(시크릿 키·빌링키·authKey)은
 * 오류 메시지에 넣지 않는다 — 호출부가 메시지를 app_errors에 남기기 때문이다.
 */
const API = "https://api.tosspayments.com";
const TIMEOUT_MS = 15_000;

export interface CardSummary {
  issuerCode: string | null;
  number: string | null;
  cardType: string | null;
}

export interface TossBillingAuth {
  billingKey: string;
  card: CardSummary;
}

export interface TossPayment {
  paymentKey: string;
  orderId: string;
  status: string;
  approvedAt: string | null;
  receiptUrl: string | null;
  card: CardSummary | null;
  totalAmount: number;
}

export class TossError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "TossError";
  }
}

export type TossErrorKind = "retryable" | "card_action_required" | "fatal";

/** 사용자가 카드를 바꿔야 풀리는 오류 — 자동 재시도하지 않는다 */
const CARD_ACTION = new Set([
  "INVALID_CARD_EXPIRATION",
  "INVALID_STOPPED_CARD",
  "INVALID_CARD_LOST_OR_STOLEN",
  "INVALID_CARD_NUMBER",
  "NOT_SUPPORTED_CARD_TYPE",
]);
/** 설정·코드 오류 — 재시도해도 같다. 관리자가 봐야 한다 */
const FATAL = new Set(["UNAUTHORIZED_KEY", "INVALID_API_KEY", "INVALID_REQUEST", "FORBIDDEN_REQUEST"]);

/** 모르는 코드는 재시도 쪽으로 — 재시도는 유예 기간 안에서만 일어나 손해가 작다 */
export function classifyTossError(code: string): TossErrorKind {
  if (CARD_ACTION.has(code)) return "card_action_required";
  if (FATAL.has(code)) return "fatal";
  return "retryable";
}

interface TossClientDeps {
  fetchImpl: typeof fetch;
  auth: string;
}

export interface TossClient {
  issueBillingKey(authKey: string, customerKey: string): Promise<TossBillingAuth>;
  chargeBillingKey(
    billingKey: string,
    input: { customerKey: string; amount: number; orderId: string; orderName: string; customerEmail?: string; customerName?: string },
    idempotencyKey: string,
  ): Promise<TossPayment>;
  getPaymentByOrderId(orderId: string): Promise<TossPayment | null>;
  cancelPayment(paymentKey: string, input: { cancelReason: string; cancelAmount?: number }, idempotencyKey: string): Promise<TossPayment>;
}

function cardOf(raw: unknown): CardSummary | null {
  if (!raw || typeof raw !== "object") return null;
  const c = raw as Record<string, unknown>;
  const s = (v: unknown) => (typeof v === "string" ? v : null);
  return { issuerCode: s(c.issuerCode), number: s(c.number), cardType: s(c.cardType) };
}

/** 응답을 읽지 못했거나 쓸 수 없는 모양이면 결과 불명 — 돈이 움직였을 수 있어 호출부가 대사로 확정한다 */
function unreadable(): TossError {
  return new TossError("NETWORK", "toss response unreadable", 0);
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function paymentOf(raw: Record<string, unknown>): TossPayment {
  const receipt = raw.receipt as { url?: unknown } | null | undefined;
  // 결제 식별자가 없는 200은 성공으로 읽을 수 없다 — 빈 결제를 돌려주면 호출부가 실패로 오판한다
  if (typeof raw.paymentKey !== "string" || !raw.paymentKey || typeof raw.orderId !== "string" || !raw.orderId) {
    throw unreadable();
  }
  return {
    paymentKey: raw.paymentKey,
    orderId: raw.orderId,
    status: String(raw.status ?? ""),
    approvedAt: typeof raw.approvedAt === "string" ? raw.approvedAt : null,
    receiptUrl: typeof receipt?.url === "string" ? receipt.url : null,
    card: cardOf(raw.card),
    totalAmount: typeof raw.totalAmount === "number" ? raw.totalAmount : 0,
  };
}

async function call(
  deps: TossClientDeps,
  path: string,
  init: { method: "GET" | "POST"; body?: unknown; idempotencyKey?: string },
): Promise<{ status: number; json: Record<string, unknown> }> {
  let res: Response;
  // 지역 변수로 호출 — deps 객체가 this로 묶이면 일부 런타임의 fetch가 Illegal invocation을 낸다
  const doFetch = deps.fetchImpl;
  try {
    res = await doFetch(`${API}${path}`, {
      method: init.method,
      cache: "no-store",
      headers: {
        Authorization: deps.auth,
        "Content-Type": "application/json",
        ...(init.idempotencyKey ? { "Idempotency-Key": init.idempotencyKey } : {}),
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    // 시간 초과·연결 실패 — 결제가 실제로 됐는지 알 수 없다. 호출부는 대사로 확정한다
    throw new TossError("NETWORK", "toss request failed (network)", 0);
  }
  if (res.ok) {
    // 본문을 읽다 시간 초과·끊김이 나도 서버는 이미 처리했을 수 있다 — 빈 값으로 넘기지 않는다
    let parsed: unknown;
    try {
      parsed = await res.json();
    } catch {
      throw unreadable();
    }
    if (!isPlainObject(parsed)) throw unreadable();
    return { status: res.status, json: parsed };
  }
  const parsedError: unknown = await res.json().catch(() => null);
  const json = isPlainObject(parsedError) ? parsedError : {};
  const code = typeof json.code === "string" ? json.code : `HTTP_${res.status}`;
  const message = typeof json.message === "string" ? json.message.slice(0, 300) : "toss error";
  throw new TossError(code, message, res.status);
}

export function createTossClient(secretKey: string, fetchImpl: typeof fetch = fetch): TossClient {
  const deps: TossClientDeps = { fetchImpl, auth: `Basic ${Buffer.from(`${secretKey}:`).toString("base64")}` };
  return {
    async issueBillingKey(authKey, customerKey) {
      const { json } = await call(deps, "/v1/billing/authorizations/issue", { method: "POST", body: { authKey, customerKey } });
      if (typeof json.billingKey !== "string") throw new TossError("INVALID_RESPONSE", "billing key missing", 200);
      return { billingKey: json.billingKey, card: cardOf(json.card) ?? { issuerCode: null, number: null, cardType: null } };
    },
    async chargeBillingKey(billingKey, input, idempotencyKey) {
      const { json } = await call(deps, `/v1/billing/${encodeURIComponent(billingKey)}`, {
        method: "POST",
        body: input,
        idempotencyKey,
      });
      return paymentOf(json);
    },
    async getPaymentByOrderId(orderId) {
      try {
        const { json } = await call(deps, `/v1/payments/orders/${encodeURIComponent(orderId)}`, { method: "GET" });
        return paymentOf(json);
      } catch (e) {
        // 주문이 없다는 토스의 답일 때만 null — 게이트웨이의 일반 404까지 "결제 없음"으로 읽으면 이중 청구가 난다
        if (e instanceof TossError && e.status === 404 && e.code === "NOT_FOUND_PAYMENT") return null;
        throw e;
      }
    },
    async cancelPayment(paymentKey, input, idempotencyKey) {
      const { json } = await call(deps, `/v1/payments/${encodeURIComponent(paymentKey)}/cancel`, {
        method: "POST",
        body: input,
        idempotencyKey,
      });
      return paymentOf(json);
    },
  };
}
