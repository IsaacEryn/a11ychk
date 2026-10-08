import { describe, expect, it, vi } from "vitest";
import { TossError, classifyTossError, createTossClient } from "../src/lib/billing/toss";

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

  it("주문 조회가 404면 null", async () => {
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
