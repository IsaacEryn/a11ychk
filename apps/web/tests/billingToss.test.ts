import { describe, expect, it, vi } from "vitest";
import { TossError, classifyTossError, createTossClient, isOutcomeUnknown } from "../src/lib/billing/toss";

function fakeFetch(status: number, body: unknown) {
  return vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }));
}

describe("토스 클라이언트", () => {
  it("Basic 인증·JSON 본문으로 빌링키를 발급하고 카드 요약만 꺼낸다", async () => {
    const f = fakeFetch(200, { billingKey: "bk", customerKey: "c", card: { issuerCode: "61", number: "1234****", cardType: "신용", ownerType: "개인" } });
    const r = await createTossClient("test_sk_x", f).issueBillingKey("auth", "cust-1");
    expect(r).toEqual({ billingKey: "bk", card: { issuerCode: "61", number: "1234****", cardType: "신용" } });
    const [url, init] = f.mock.calls[0];
    expect(url).toBe("https://api.tosspayments.com/v1/billing/authorizations/issue");
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toBe(`Basic ${Buffer.from("test_sk_x:").toString("base64")}`);
    expect(JSON.parse(init.body)).toEqual({ authKey: "auth", customerKey: "cust-1" });
  });

  it("빌링 결제는 빌링키를 경로에, 멱등 키를 헤더에 넣는다", async () => {
    const f = fakeFetch(200, { paymentKey: "pk", orderId: "pay_1", status: "DONE", approvedAt: "2026-10-08T10:00:00+09:00", receipt: { url: "https://r" }, card: { number: "1234****" }, totalAmount: 1234 });
    const p = await createTossClient("test_sk_x", f).chargeBillingKey(
      "bk/1",
      { customerKey: "c", amount: 1234, orderId: "pay_1", orderName: "A11y Check Pro" },
      "idem-1",
    );
    expect(p).toMatchObject({ paymentKey: "pk", status: "DONE", receiptUrl: "https://r", totalAmount: 1234 });
    const [url, init] = f.mock.calls[0];
    expect(url).toBe("https://api.tosspayments.com/v1/billing/bk%2F1");
    expect(init.headers["Idempotency-Key"]).toBe("idem-1");
  });

  it("오류 응답은 TossError(code, status)로", async () => {
    const f = fakeFetch(400, { code: "REJECT_CARD_PAYMENT", message: "한도 초과" });
    await expect(
      createTossClient("test_sk_x", f).chargeBillingKey("bk", { customerKey: "c", amount: 1, orderId: "pay_1", orderName: "x" }, "i"),
    ).rejects.toMatchObject({ code: "REJECT_CARD_PAYMENT", status: 400 });
  });

  it("네트워크 오류는 NETWORK", async () => {
    const f = vi.fn().mockRejectedValue(new TypeError("fetch failed"));
    await expect(createTossClient("test_sk_x", f).getPaymentByOrderId("pay_1")).rejects.toMatchObject({ code: "NETWORK", status: 0 });
  });

  it("주문 조회가 404 NOT_FOUND_PAYMENT면 null", async () => {
    const f = fakeFetch(404, { code: "NOT_FOUND_PAYMENT", message: "없음" });
    expect(await createTossClient("test_sk_x", f).getPaymentByOrderId("pay_1")).toBeNull();
  });

  it("TossError 메시지에는 비밀 값이 들어가지 않는다", async () => {
    const f = fakeFetch(401, { code: "UNAUTHORIZED_KEY", message: "인증 실패" });
    const err = await createTossClient("test_sk_secret", f).issueBillingKey("authKey-secret", "c").catch((e) => e);
    expect(err).toBeInstanceOf(TossError);
    expect(String(err.message)).not.toMatch(/test_sk_secret|authKey-secret/);
  });
});

describe("토스 응답을 믿을 수 있는지 — 결과 불명은 NETWORK", () => {
  const payment = { paymentKey: "pk", orderId: "pay_1", status: "DONE", totalAmount: 1234 };
  const charge = (f: typeof fetch) =>
    createTossClient("test_sk_x", f).chargeBillingKey("bk", { customerKey: "c", amount: 1234, orderId: "pay_1", orderName: "x" }, "i");

  it("200인데 본문이 비어 있으면 NETWORK", async () => {
    const f = vi.fn().mockResolvedValue(new Response("", { status: 200 }));
    await expect(charge(f)).rejects.toMatchObject({ code: "NETWORK", status: 0 });
  });

  it("200인데 본문을 읽다 실패(시간 초과 등)하면 NETWORK", async () => {
    const res = { ok: true, status: 200, json: () => Promise.reject(new DOMException("aborted", "AbortError")) } as unknown as Response;
    const f = vi.fn().mockResolvedValue(res);
    await expect(charge(f)).rejects.toMatchObject({ code: "NETWORK", status: 0 });
  });

  it("200인데 본문이 JSON null이면 NETWORK", async () => {
    await expect(charge(fakeFetch(200, null))).rejects.toMatchObject({ code: "NETWORK", status: 0 });
  });

  it("200인데 본문이 배열이면 NETWORK", async () => {
    await expect(charge(fakeFetch(200, []))).rejects.toMatchObject({ code: "NETWORK", status: 0 });
  });

  it("결제 승인 200인데 paymentKey가 없으면 NETWORK", async () => {
    await expect(charge(fakeFetch(200, { orderId: "pay_1", status: "DONE" }))).rejects.toMatchObject({ code: "NETWORK", status: 0 });
  });

  it("결제 승인 200인데 orderId가 비어 있으면 NETWORK", async () => {
    await expect(charge(fakeFetch(200, { paymentKey: "pk", orderId: "", status: "DONE" }))).rejects.toMatchObject({ code: "NETWORK", status: 0 });
  });

  it("주문 조회 200인데 식별자가 없으면 null이 아니라 NETWORK", async () => {
    const t = createTossClient("test_sk_x", fakeFetch(200, { status: "DONE" }));
    await expect(t.getPaymentByOrderId("pay_1")).rejects.toMatchObject({ code: "NETWORK", status: 0 });
  });

  it("오류 응답의 본문을 읽지 못하면 HTTP_<상태>로", async () => {
    const f = vi.fn().mockResolvedValue(new Response("<html>bad gateway</html>", { status: 502 }));
    await expect(charge(f)).rejects.toMatchObject({ code: "HTTP_502", status: 502 });
  });

  it("오류 응답 본문이 JSON null이어도 HTTP_<상태>로", async () => {
    await expect(charge(fakeFetch(500, null))).rejects.toMatchObject({ code: "HTTP_500", status: 500 });
  });

  it("게이트웨이의 일반 404(HTTP_404)는 null이 아니라 재던진다", async () => {
    const f = vi.fn().mockResolvedValue(new Response("<html>not found</html>", { status: 404 }));
    await expect(createTossClient("test_sk_x", f).getPaymentByOrderId("pay_1")).rejects.toMatchObject({ code: "HTTP_404", status: 404 });
  });

  it("다른 코드의 404도 null이 아니라 재던진다", async () => {
    const f = fakeFetch(404, { code: "NOT_FOUND", message: "경로 없음" });
    await expect(createTossClient("test_sk_x", f).getPaymentByOrderId("pay_1")).rejects.toMatchObject({ code: "NOT_FOUND", status: 404 });
  });

  it("정상 응답은 그대로 읽는다", async () => {
    expect(await charge(fakeFetch(200, payment))).toMatchObject({ paymentKey: "pk", orderId: "pay_1", status: "DONE", totalAmount: 1234 });
  });
});

describe("토스 클라이언트 요청 모양과 응답 요약", () => {
  it("카드 정보가 없는 빌링키 응답은 빈 요약으로", async () => {
    const f = fakeFetch(200, { billingKey: "bk" });
    expect(await createTossClient("test_sk_x", f).issueBillingKey("auth", "cust")).toEqual({
      billingKey: "bk",
      card: { issuerCode: null, number: null, cardType: null },
    });
  });

  it("빌링키가 없는 200은 INVALID_RESPONSE", async () => {
    const f = fakeFetch(200, { customerKey: "c" });
    await expect(createTossClient("test_sk_x", f).issueBillingKey("auth", "cust")).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });

  it("카드가 없는 결제 응답은 card: null, 영수증이 없으면 receiptUrl: null", async () => {
    const f = fakeFetch(200, { paymentKey: "pk", orderId: "pay_1", status: "DONE", totalAmount: 10 });
    const p = await createTossClient("test_sk_x", f).getPaymentByOrderId("pay_1");
    expect(p).toMatchObject({ card: null, receiptUrl: null, approvedAt: null, totalAmount: 10 });
  });

  it("주문 조회는 GET이고 주문 번호를 경로에 인코딩하며 본문이 없다", async () => {
    const f = fakeFetch(200, { paymentKey: "pk", orderId: "pay/1", status: "DONE", totalAmount: 1 });
    await createTossClient("test_sk_x", f).getPaymentByOrderId("pay/1");
    const [url, init] = f.mock.calls[0];
    expect(url).toBe("https://api.tosspayments.com/v1/payments/orders/pay%2F1");
    expect(init.method).toBe("GET");
    expect(init.body).toBeUndefined();
    expect(init.headers["Idempotency-Key"]).toBeUndefined();
  });

  it("취소는 결제 키를 경로에 인코딩하고 멱등 키·취소 사유를 보낸다", async () => {
    const f = fakeFetch(200, { paymentKey: "pk/1 x", orderId: "pay_1", status: "CANCELED", totalAmount: 1234 });
    const p = await createTossClient("test_sk_x", f).cancelPayment("pk/1 x", { cancelReason: "사용자 요청", cancelAmount: 500 }, "idem-2");
    expect(p).toMatchObject({ status: "CANCELED" });
    const [url, init] = f.mock.calls[0];
    expect(url).toBe("https://api.tosspayments.com/v1/payments/pk%2F1%20x/cancel");
    expect(init.method).toBe("POST");
    expect(init.headers["Idempotency-Key"]).toBe("idem-2");
    expect(JSON.parse(init.body)).toEqual({ cancelReason: "사용자 요청", cancelAmount: 500 });
  });

  it("모든 요청은 캐시하지 않고 시간 제한 신호를 단다", async () => {
    const f = fakeFetch(200, { billingKey: "bk" });
    await createTossClient("test_sk_x", f).issueBillingKey("auth", "cust");
    const [, init] = f.mock.calls[0];
    expect(init.cache).toBe("no-store");
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("fetch는 클라이언트 객체에 묶이지 않은 채 호출된다", async () => {
    const receivers: unknown[] = [];
    const f = function (this: unknown) {
      receivers.push(this);
      return Promise.resolve(new Response(JSON.stringify({ billingKey: "bk" }), { status: 200 }));
    } as unknown as typeof fetch;
    await createTossClient("test_sk_x", f).issueBillingKey("auth", "cust");
    expect(receivers).toEqual([undefined]);
  });
});

describe("classifyTossError", () => {
  it.each([
    ["NETWORK", "retryable"],
    ["REJECT_CARD_PAYMENT", "retryable"],
    ["PROVIDER_ERROR", "retryable"],
    ["FAILED_INTERNAL_SYSTEM_PROCESSING", "retryable"],
    ["처음 보는 코드", "retryable"],
    ["INVALID_CARD_EXPIRATION", "card_action_required"],
    ["INVALID_STOPPED_CARD", "card_action_required"],
    ["INVALID_CARD_LOST_OR_STOLEN", "card_action_required"],
    ["INVALID_CARD_NUMBER", "card_action_required"],
    ["NOT_SUPPORTED_CARD_TYPE", "card_action_required"],
    ["UNAUTHORIZED_KEY", "fatal"],
    ["INVALID_API_KEY", "fatal"],
    ["INVALID_REQUEST", "fatal"],
  ])("%s → %s", (code, kind) => {
    expect(classifyTossError(code)).toBe(kind);
  });
});

describe("isOutcomeUnknown — 돈이 움직였는지 알 수 없는 실패", () => {
  it.each([
    [new TossError("NETWORK", "toss request failed (network)", 0), true],
    [new TossError("HTTP_502", "toss error", 502), true],
    [new TossError("FAILED_INTERNAL_SYSTEM_PROCESSING", "내부 오류", 500), true],
    [new TossError("HTTP_408", "toss error", 408), true],
    [new TossError("REJECT_CARD_PAYMENT", "한도 초과", 400), false],
    [new TossError("INVALID_CARD_EXPIRATION", "유효기간 오류", 400), false],
    [new TossError("UNAUTHORIZED_KEY", "인증 실패", 401), false],
    [new TossError("INVALID_RESPONSE", "billing key missing", 200), false],
  ])("%s → %s", (err, unknown) => {
    expect(isOutcomeUnknown(err)).toBe(unknown);
  });

  it("TossError가 아닌 값은 false(호출부가 따로 판단한다)", () => {
    expect(isOutcomeUnknown(new Error("boom"))).toBe(false);
    expect(isOutcomeUnknown(null)).toBe(false);
  });
});
