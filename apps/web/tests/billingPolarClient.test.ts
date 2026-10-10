import http from "node:http";
import type { AddressInfo } from "node:net";
import { describe, expect, it, vi } from "vitest";
import { PolarError, createPolarClient, isPolarOutcomeUnknown, type PolarClient } from "../src/lib/billing/polar";

// 가짜 값만 쓴다 — 실제 토큰·금액이 아니다
const KEYS = { accessToken: "polar_oat_fake_token", apiBase: "https://sandbox-api.polar.sh" };
const SUB_ID = "11111111-1111-4111-8111-111111111111";
const ORDER_ID = "22222222-2222-4222-8222-222222222222";
const CHECKOUT_ID = "33333333-3333-4333-8333-333333333333";
const PRODUCT_ID = "44444444-4444-4444-8444-444444444444";
const CUSTOMER_ID = "55555555-5555-4555-8555-555555555555";
const USER_ID = "66666666-6666-4666-8666-666666666666";
const REFUND_ID = "77777777-7777-4777-8777-777777777777";

// 호출마다 새 Response — 본문은 한 번만 읽힌다
function fakeFetch(status: number, body: unknown) {
  return vi.fn().mockImplementation(async () => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }));
}

const subscription = {
  id: SUB_ID,
  created_at: "2026-01-01T00:00:00Z",
  modified_at: "2026-01-02T00:00:00.123456Z",
  status: "active",
  amount: 1234,
  currency: "usd",
  recurring_interval: "month",
  recurring_interval_count: 1,
  current_period_start: "2026-01-01T00:00:00Z",
  current_period_end: "2026-02-01T00:00:00Z",
  cancel_at_period_end: false,
  canceled_at: null,
  started_at: "2026-01-01T00:00:00Z",
  ends_at: null,
  ended_at: null,
  customer_id: CUSTOMER_ID,
  customer: { id: CUSTOMER_ID, external_id: USER_ID, email: "fake@example.test", name: "Fake Name", billing_address: { country: "US" } },
  product_id: PRODUCT_ID,
  checkout_id: CHECKOUT_ID,
  metadata: { user_id: USER_ID },
  product: { id: PRODUCT_ID, name: "fake" },
  prices: [],
};

const order = {
  id: ORDER_ID,
  created_at: "2026-01-01T00:00:00Z",
  modified_at: null,
  status: "paid",
  paid: true,
  subtotal_amount: 1234,
  discount_amount: 0,
  net_amount: 1234,
  tax_amount: 100,
  total_amount: 1334,
  refunded_amount: 0,
  refunded_tax_amount: 0,
  currency: "usd",
  billing_reason: "subscription_create",
  billing_address: { country: "US", line1: "fake street" },
  subscription_id: SUB_ID,
  customer: { id: CUSTOMER_ID, external_id: USER_ID, email: "fake@example.test" },
  product_id: PRODUCT_ID,
  checkout_id: CHECKOUT_ID,
  metadata: { user_id: USER_ID },
  items: [],
};

const checkout = {
  id: CHECKOUT_ID,
  status: "open",
  url: "https://sandbox.polar.sh/checkout/fake",
  client_secret: "polar_c_fake_secret",
  expires_at: "2026-01-01T01:00:00Z",
  external_customer_id: USER_ID,
  product_id: PRODUCT_ID,
  metadata: { attempt: "a1" },
  customer_email: "fake@example.test",
};

describe("Polar 클라이언트 요청 모양", () => {
  it("결제창 생성 — POST /v1/checkouts/, Bearer 토큰, 체험·할인 코드는 항상 끈다", async () => {
    const f = fakeFetch(201, checkout);
    const c = await createPolarClient(KEYS, f).createCheckout({
      products: [PRODUCT_ID],
      external_customer_id: USER_ID,
      customer_email: "fake@example.test",
      success_url: "https://example.test/en/billing/return?checkout_id={CHECKOUT_ID}",
      return_url: "https://example.test/en/pricing",
      metadata: { attempt: "a1" },
      locale: "en",
    });
    const [url, init] = f.mock.calls[0]!;
    expect(url).toBe("https://sandbox-api.polar.sh/v1/checkouts/");
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toBe("Bearer polar_oat_fake_token");
    expect(init.headers["Content-Type"]).toBe("application/json");
    expect(JSON.parse(init.body)).toEqual({
      products: [PRODUCT_ID],
      external_customer_id: USER_ID,
      customer_email: "fake@example.test",
      success_url: "https://example.test/en/billing/return?checkout_id={CHECKOUT_ID}",
      return_url: "https://example.test/en/pricing",
      metadata: { attempt: "a1" },
      locale: "en",
      allow_trial: false,
      allow_discount_codes: false,
    });
    // 필요한 필드만 — client_secret·이메일 같은 나머지는 버린다
    expect(c).toEqual({
      id: CHECKOUT_ID,
      status: "open",
      url: "https://sandbox.polar.sh/checkout/fake",
      expires_at: "2026-01-01T01:00:00Z",
      external_customer_id: USER_ID,
      product_id: PRODUCT_ID,
      metadata: { attempt: "a1" },
    });
  });

  it("결제창 조회 — GET /v1/checkouts/{id}, 본문 없음", async () => {
    const f = fakeFetch(200, { ...checkout, status: "succeeded" });
    const c = await createPolarClient(KEYS, f).getCheckout(CHECKOUT_ID);
    expect(c.status).toBe("succeeded");
    const [url, init] = f.mock.calls[0]!;
    expect(url).toBe(`https://sandbox-api.polar.sh/v1/checkouts/${CHECKOUT_ID}`);
    expect(init.method).toBe("GET");
    expect(init.body).toBeUndefined();
    expect(init.headers.Authorization).toBe("Bearer polar_oat_fake_token");
  });

  it("구독 조회 — 필요한 필드만 읽는다", async () => {
    const f = fakeFetch(200, subscription);
    const s = await createPolarClient(KEYS, f).getSubscription(SUB_ID);
    expect(f.mock.calls[0]![0]).toBe(`https://sandbox-api.polar.sh/v1/subscriptions/${SUB_ID}`);
    expect(f.mock.calls[0]![1].method).toBe("GET");
    expect(s).toEqual({
      id: SUB_ID,
      created_at: "2026-01-01T00:00:00Z",
      modified_at: "2026-01-02T00:00:00.123456Z",
      status: "active",
      amount: 1234,
      currency: "usd",
      recurring_interval: "month",
      recurring_interval_count: 1,
      current_period_start: "2026-01-01T00:00:00Z",
      current_period_end: "2026-02-01T00:00:00Z",
      cancel_at_period_end: false,
      canceled_at: null,
      started_at: "2026-01-01T00:00:00Z",
      ends_at: null,
      ended_at: null,
      customer: { id: CUSTOMER_ID, external_id: USER_ID },
      product_id: PRODUCT_ID,
      checkout_id: CHECKOUT_ID,
      metadata: { user_id: USER_ID },
    });
    // 고객 이메일은 쓰지 않으므로 읽지도 않는다
    expect(s.customer).not.toHaveProperty("email");
  });

  it("구독의 nullable 필드는 빠져 있어도 null로, 주기 횟수는 1로, metadata는 {}로", async () => {
    const minimal = {
      id: SUB_ID,
      created_at: "2026-01-01T00:00:00Z",
      status: "canceled",
      amount: 1234,
      currency: "usd",
      recurring_interval: "year",
      current_period_start: "2026-01-01T00:00:00Z",
      cancel_at_period_end: true,
      customer: { id: CUSTOMER_ID },
      product_id: PRODUCT_ID,
    };
    const s = await createPolarClient(KEYS, fakeFetch(200, minimal)).getSubscription(SUB_ID);
    expect(s).toMatchObject({
      modified_at: null,
      recurring_interval_count: 1,
      current_period_end: null,
      canceled_at: null,
      started_at: null,
      ends_at: null,
      ended_at: null,
      customer: { id: CUSTOMER_ID, external_id: null },
      checkout_id: null,
      metadata: {},
    });
  });

  it("처음 보는 상태 값도 읽는다(매핑은 호출부가 판단)", async () => {
    const s = await createPolarClient(KEYS, fakeFetch(200, { ...subscription, status: "brand_new_status" })).getSubscription(SUB_ID);
    expect(s.status).toBe("brand_new_status");
  });

  it("끝 기간 해지 예약 — PATCH 본문은 cancel_at_period_end만", async () => {
    const f = fakeFetch(200, { ...subscription, cancel_at_period_end: true });
    const s = await createPolarClient(KEYS, f).updateSubscription(SUB_ID, { cancel_at_period_end: true });
    expect(s.cancel_at_period_end).toBe(true);
    const [url, init] = f.mock.calls[0]!;
    expect(url).toBe(`https://sandbox-api.polar.sh/v1/subscriptions/${SUB_ID}`);
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(init.body)).toEqual({ cancel_at_period_end: true });
  });

  it("해지 예약 취소와 즉시 해지(revoke)", async () => {
    const f = fakeFetch(200, subscription);
    const client = createPolarClient(KEYS, f);
    await client.updateSubscription(SUB_ID, { cancel_at_period_end: false });
    await client.updateSubscription(SUB_ID, { revoke: true });
    expect(JSON.parse(f.mock.calls[0]![1].body)).toEqual({ cancel_at_period_end: false });
    expect(JSON.parse(f.mock.calls[1]![1].body)).toEqual({ revoke: true });
  });

  it("주문 조회 — GET /v1/orders/{id}, 금액은 cent 그대로", async () => {
    const f = fakeFetch(200, order);
    const o = await createPolarClient(KEYS, f).getOrder(ORDER_ID);
    expect(f.mock.calls[0]![0]).toBe(`https://sandbox-api.polar.sh/v1/orders/${ORDER_ID}`);
    expect(o).toEqual({
      id: ORDER_ID,
      created_at: "2026-01-01T00:00:00Z",
      modified_at: null,
      status: "paid",
      paid: true,
      subtotal_amount: 1234,
      discount_amount: 0,
      net_amount: 1234,
      tax_amount: 100,
      total_amount: 1334,
      refunded_amount: 0,
      refunded_tax_amount: 0,
      refundable_amount: null,
      currency: "usd",
      billing_reason: "subscription_create",
      subscription_id: SUB_ID,
      customer: { external_id: USER_ID },
      product_id: PRODUCT_ID,
      checkout_id: CHECKOUT_ID,
      metadata: { user_id: USER_ID },
    });
  });

  it("주문의 환불 가능 금액(refundable_amount, 세금 제외 cent)을 읽는다", async () => {
    const o = await createPolarClient(KEYS, fakeFetch(200, { ...order, refundable_amount: 1234 })).getOrder(ORDER_ID);
    expect(o.refundable_amount).toBe(1234);
    await expect(createPolarClient(KEYS, fakeFetch(200, { ...order, refundable_amount: -1 })).getOrder(ORDER_ID)).rejects.toMatchObject({
      code: "BAD_RESPONSE",
    });
  });

  it("환불 — POST /v1/refunds/", async () => {
    const f = fakeFetch(201, { id: REFUND_ID, status: "pending", amount: 1334, order_id: ORDER_ID, reason: "other", currency: "usd" });
    const r = await createPolarClient(KEYS, f).createRefund({ order_id: ORDER_ID, reason: "other", amount: 1334, comment: "fake" });
    expect(r).toEqual({ id: REFUND_ID, status: "pending", amount: 1334, order_id: ORDER_ID });
    const [url, init] = f.mock.calls[0]!;
    expect(url).toBe("https://sandbox-api.polar.sh/v1/refunds/");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({ order_id: ORDER_ID, reason: "other", amount: 1334, comment: "fake" });
  });

  it("고객 포털 세션 — POST /v1/customer-sessions/, 토큰은 버린다", async () => {
    const f = fakeFetch(201, {
      id: "88888888-8888-4888-8888-888888888888",
      token: "polar_cst_fake",
      customer_portal_url: "https://sandbox.polar.sh/fake-org/portal?customer_session_token=polar_cst_fake",
      expires_at: "2026-01-01T01:00:00Z",
    });
    const s = await createPolarClient(KEYS, f).createCustomerSession({ external_customer_id: USER_ID, return_url: "https://example.test/en/mypage" });
    expect(s).toEqual({
      customer_portal_url: "https://sandbox.polar.sh/fake-org/portal?customer_session_token=polar_cst_fake",
      expires_at: "2026-01-01T01:00:00Z",
    });
    const [url, init] = f.mock.calls[0]!;
    expect(url).toBe("https://sandbox-api.polar.sh/v1/customer-sessions/");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({ external_customer_id: USER_ID, return_url: "https://example.test/en/mypage" });
  });

  it("live 키의 apiBase를 그대로 쓴다", async () => {
    const f = fakeFetch(200, order);
    await createPolarClient({ accessToken: "polar_oat_fake", apiBase: "https://api.polar.sh" }, f).getOrder(ORDER_ID);
    expect(f.mock.calls[0]![0]).toBe(`https://api.polar.sh/v1/orders/${ORDER_ID}`);
  });

  it("모든 요청은 캐시하지 않고 시간 제한 신호를 단다", async () => {
    const f = fakeFetch(200, order);
    await createPolarClient(KEYS, f).getOrder(ORDER_ID);
    const [, init] = f.mock.calls[0]!;
    expect(init.cache).toBe("no-store");
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("리다이렉트를 따라가지 않는다(redirect: error) — 토큰이 다른 주소로 가지 않게", async () => {
    const f = fakeFetch(200, order);
    await createPolarClient(KEYS, f).getOrder(ORDER_ID);
    expect(f.mock.calls[0]![1].redirect).toBe("error");
  });

  it("fetch는 클라이언트 객체에 묶이지 않은 채 호출된다", async () => {
    const receivers: unknown[] = [];
    const f = function (this: unknown) {
      receivers.push(this);
      return Promise.resolve(new Response(JSON.stringify(order), { status: 200 }));
    } as unknown as typeof fetch;
    await createPolarClient(KEYS, f).getOrder(ORDER_ID);
    expect(receivers).toEqual([undefined]);
  });
});

describe("경로 id 검사 — UUID가 아니면 호출 전에 INVALID_ID", () => {
  it.each(["", "abc", "../orders", `${ORDER_ID}/refunds`, `${ORDER_ID} `, "11111111-1111-4111-8111-11111111111g"])("%j", async (bad) => {
    const f = fakeFetch(200, order);
    const client = createPolarClient(KEYS, f);
    for (const call of [
      () => client.getOrder(bad),
      () => client.getSubscription(bad),
      () => client.getCheckout(bad),
      () => client.updateSubscription(bad, { revoke: true }),
    ]) {
      await expect(call()).rejects.toMatchObject({ name: "PolarError", code: "INVALID_ID", status: 0 });
    }
    expect(f).not.toHaveBeenCalled();
  });

  it("대문자 UUID는 받는다", async () => {
    const f = fakeFetch(200, order);
    await createPolarClient(KEYS, f).getOrder(ORDER_ID.toUpperCase());
    expect(f).toHaveBeenCalledOnce();
  });
});

describe("오류 분류", () => {
  it("본문의 error 문자열을 코드로", async () => {
    const f = fakeFetch(403, { error: "AlreadyCanceledSubscription", detail: "This subscription is already canceled." });
    await expect(createPolarClient(KEYS, f).updateSubscription(SUB_ID, { revoke: true })).rejects.toMatchObject({
      code: "AlreadyCanceledSubscription",
      status: 403,
    });
  });

  it("error가 없으면 type 문자열을 코드로", async () => {
    const f = fakeFetch(404, { type: "ResourceNotFound", detail: "Not found" });
    await expect(createPolarClient(KEYS, f).getOrder(ORDER_ID)).rejects.toMatchObject({ code: "ResourceNotFound", status: 404 });
  });

  it("error가 type보다 먼저", async () => {
    const f = fakeFetch(403, { error: "RefundedAlready", type: "Other" });
    await expect(createPolarClient(KEYS, f).createRefund({ order_id: ORDER_ID, reason: "other", amount: 1 })).rejects.toMatchObject({
      code: "RefundedAlready",
    });
  });

  it("코드가 없거나 식별자 모양이 아니면 HTTP_<상태>", async () => {
    await expect(createPolarClient(KEYS, fakeFetch(422, { detail: [{ loc: ["body", "amount"], msg: "bad" }] })).getOrder(ORDER_ID)).rejects.toMatchObject({
      code: "HTTP_422",
      status: 422,
    });
    await expect(createPolarClient(KEYS, fakeFetch(400, { error: "has spaces and fake@example.test" })).getOrder(ORDER_ID)).rejects.toMatchObject({
      code: "HTTP_400",
    });
    await expect(createPolarClient(KEYS, fakeFetch(400, { error: 42 })).getOrder(ORDER_ID)).rejects.toMatchObject({ code: "HTTP_400" });
  });

  it.each(["NETWORK", "BAD_RESPONSE", "INVALID_ID"])("서버 본문의 코드가 내부 코드(%s)와 같으면 HTTP_<상태>로 바꾼다", async (reserved) => {
    await expect(createPolarClient(KEYS, fakeFetch(503, { error: reserved })).getOrder(ORDER_ID)).rejects.toMatchObject({
      code: "HTTP_503",
      status: 503,
    });
    await expect(createPolarClient(KEYS, fakeFetch(400, { type: reserved })).getOrder(ORDER_ID)).rejects.toMatchObject({ code: "HTTP_400" });
    // 5xx는 본문 코드와 관계없이 결과 불명이다(읽기 요청이어도)
    const err = await createPolarClient(KEYS, fakeFetch(500, { error: reserved })).getOrder(ORDER_ID).catch((e) => e);
    expect(isPolarOutcomeUnknown(err)).toBe(true);
  });

  it("오류 본문을 읽지 못하거나 JSON null이면 HTTP_<상태>", async () => {
    const html = vi.fn().mockResolvedValue(new Response("<html>bad gateway</html>", { status: 502 }));
    await expect(createPolarClient(KEYS, html).getOrder(ORDER_ID)).rejects.toMatchObject({ code: "HTTP_502", status: 502 });
    await expect(createPolarClient(KEYS, fakeFetch(500, null)).getOrder(ORDER_ID)).rejects.toMatchObject({ code: "HTTP_500", status: 500 });
  });

  it("연결 실패·시간 초과는 NETWORK", async () => {
    const f = vi.fn().mockRejectedValue(new TypeError("fetch failed"));
    await expect(createPolarClient(KEYS, f).getOrder(ORDER_ID)).rejects.toMatchObject({ code: "NETWORK", status: 0 });
    const t = vi.fn().mockRejectedValue(new DOMException("timed out", "TimeoutError"));
    await expect(createPolarClient(KEYS, t).getOrder(ORDER_ID)).rejects.toMatchObject({ code: "NETWORK", status: 0 });
  });

  it("2xx인데 본문이 비었거나 읽다 실패하면 NETWORK", async () => {
    const empty = vi.fn().mockResolvedValue(new Response("", { status: 200 }));
    await expect(createPolarClient(KEYS, empty).getOrder(ORDER_ID)).rejects.toMatchObject({ code: "NETWORK", status: 0 });
    const res = { ok: true, status: 201, json: () => Promise.reject(new DOMException("aborted", "AbortError")) } as unknown as Response;
    const broken = vi.fn().mockResolvedValue(res);
    await expect(createPolarClient(KEYS, broken).createRefund({ order_id: ORDER_ID, reason: "other", amount: 1 })).rejects.toMatchObject({
      code: "NETWORK",
      status: 0,
    });
  });

  it.each([
    ["id 없음", { ...subscription, id: undefined }],
    ["id 빈 값", { ...subscription, id: "" }],
    ["금액이 문자열", { ...subscription, amount: "1234" }],
    ["금액이 소수", { ...subscription, amount: 12.5 }],
    ["고객 없음", { ...subscription, customer: undefined }],
    ["상품 없음", { ...subscription, product_id: null }],
    ["기간 시작이 날짜가 아님", { ...subscription, current_period_start: "not a date" }],
    ["기간 끝이 날짜가 아님", { ...subscription, current_period_end: "soon" }],
    ["해지 예약이 문자열", { ...subscription, cancel_at_period_end: "false" }],
    ["JSON null", null],
    ["배열", [subscription]],
  ])("2xx인데 필수 필드가 맞지 않으면 BAD_RESPONSE — %s", async (_, body) => {
    await expect(createPolarClient(KEYS, fakeFetch(200, body)).getSubscription(SUB_ID)).rejects.toMatchObject({
      name: "PolarError",
      code: "BAD_RESPONSE",
      status: 200,
    });
  });

  it.each([
    ["주문 총액 없음", () => createPolarClient(KEYS, fakeFetch(200, { ...order, total_amount: undefined })).getOrder(ORDER_ID)],
    ["주문 상태 없음", () => createPolarClient(KEYS, fakeFetch(200, { ...order, status: undefined })).getOrder(ORDER_ID)],
    ["결제창 url이 URL이 아님", () => createPolarClient(KEYS, fakeFetch(200, { ...checkout, url: "nope" })).getCheckout(CHECKOUT_ID)],
    ["결제창 url이 javascript:", () => createPolarClient(KEYS, fakeFetch(200, { ...checkout, url: "javascript:alert(1)" })).getCheckout(CHECKOUT_ID)],
    ["결제창 url이 http", () => createPolarClient(KEYS, fakeFetch(200, { ...checkout, url: "http://sandbox.polar.sh/checkout/fake" })).getCheckout(CHECKOUT_ID)],
    ["포털 url이 https가 아님", () =>
      createPolarClient(KEYS, fakeFetch(201, { customer_portal_url: "data:text/html,x", expires_at: null })).createCustomerSession({ external_customer_id: USER_ID })],
    ["환불 주문 id 없음", () =>
      createPolarClient(KEYS, fakeFetch(201, { id: REFUND_ID, status: "pending", amount: 1 })).createRefund({ order_id: ORDER_ID, reason: "other", amount: 1 })],
    ["포털 url 없음", () =>
      createPolarClient(KEYS, fakeFetch(201, { expires_at: "2026-01-01T00:00:00Z" })).createCustomerSession({ external_customer_id: USER_ID })],
  ])("다른 응답도 필수 필드가 없으면 BAD_RESPONSE — %s", async (_, run) => {
    await expect(run()).rejects.toMatchObject({ code: "BAD_RESPONSE" });
  });
});

describe("오류 메시지에 비밀·본문을 넣지 않는다", () => {
  it("오류 응답의 detail·요청 본문·토큰이 메시지에 없다", async () => {
    const f = fakeFetch(422, { error: "RequestValidationError", detail: [{ input: "fake@example.test", msg: "fake-detail-text" }] });
    const err = await createPolarClient(KEYS, f)
      .createCheckout({ products: [PRODUCT_ID], external_customer_id: USER_ID, customer_email: "fake@example.test", success_url: "https://example.test/ok" })
      .catch((e) => e);
    expect(err).toBeInstanceOf(PolarError);
    expect(String(err.message)).not.toMatch(/polar_oat_fake_token|fake@example\.test|fake-detail-text/);
    expect(String(err.stack)).not.toMatch(/polar_oat_fake_token|fake@example\.test/);
  });

  it("BAD_RESPONSE 메시지에는 필드 이름만 있고 값은 없다", async () => {
    const f = fakeFetch(200, { ...subscription, amount: "fake@example.test", customer: { id: CUSTOMER_ID, external_id: 7 } });
    const err = await createPolarClient(KEYS, f).getSubscription(SUB_ID).catch((e) => e);
    expect(err).toMatchObject({ code: "BAD_RESPONSE" });
    expect(String(err.message)).toContain("amount");
    expect(String(err.message)).not.toMatch(/fake@example\.test|polar_oat_fake_token/);
  });

  it("NETWORK 메시지에 원래 오류 문구를 싣지 않는다", async () => {
    const f = vi.fn().mockRejectedValue(new TypeError("connect failed Bearer polar_oat_fake_token"));
    const err = await createPolarClient(KEYS, f).getOrder(ORDER_ID).catch((e) => e);
    expect(String(err.message)).not.toMatch(/polar_oat_fake_token/);
  });
});

describe("isPolarOutcomeUnknown — Polar가 처리했는지 알 수 없는 실패", () => {
  it.each([
    ["NETWORK", 0, true],
    ["HTTP_502", 502, true],
    ["InternalServerError", 500, true],
    ["HTTP_408", 408, true],
    ["AlreadyCanceledSubscription", 403, false],
    ["ResourceNotFound", 404, false],
    ["HTTP_422", 422, false],
    ["INVALID_ID", 0, false],
    ["BAD_RESPONSE", 200, false],
  ] as const)("%s (%i) → %s", (code, status, unknown) => {
    expect(isPolarOutcomeUnknown(new PolarError(code, "x", status))).toBe(unknown);
  });

  it("상태가 먼저 — 5xx·408은 코드가 무엇이든 결과 불명, BAD_RESPONSE는 2xx일 때 쓰기 요청만", () => {
    expect(isPolarOutcomeUnknown(new PolarError("BAD_RESPONSE", "x", 500, false))).toBe(true);
    expect(isPolarOutcomeUnknown(new PolarError("BAD_RESPONSE", "x", 408, false))).toBe(true);
    expect(isPolarOutcomeUnknown(new PolarError("INVALID_ID", "x", 502))).toBe(true);
    expect(isPolarOutcomeUnknown(new PolarError("BAD_RESPONSE", "x", 200, false))).toBe(false);
    expect(isPolarOutcomeUnknown(new PolarError("BAD_RESPONSE", "x", 201, true))).toBe(true);
    expect(isPolarOutcomeUnknown(new PolarError("NETWORK", "x", 0, false))).toBe(true);
  });

  it("PolarError가 아닌 값은 false", () => {
    expect(isPolarOutcomeUnknown(new Error("boom"))).toBe(false);
    expect(isPolarOutcomeUnknown(undefined)).toBe(false);
  });
});

describe("리다이렉트 — 실제 fetch로 확인", () => {
  it("3xx를 받으면 따라가지 않고 NETWORK(결과 불명)로, 다른 주소에는 아무 요청도 가지 않는다", async () => {
    const seen: { url: string | undefined; auth: string | undefined }[] = [];
    const server = http.createServer((req, res) => {
      seen.push({ url: req.url, auth: req.headers.authorization });
      if (req.url?.startsWith("/v1/")) {
        res.writeHead(307, { Location: "/elsewhere" }).end();
      } else {
        res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(order));
      }
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const { port } = server.address() as AddressInfo;
      const client = createPolarClient({ accessToken: "polar_oat_fake_token", apiBase: `http://127.0.0.1:${port}` });
      const err = await client.getOrder(ORDER_ID).catch((e) => e);
      expect(err).toMatchObject({ name: "PolarError", code: "NETWORK", status: 0 });
      expect(isPolarOutcomeUnknown(err)).toBe(true);
      expect(seen).toEqual([{ url: `/v1/orders/${ORDER_ID}`, auth: "Bearer polar_oat_fake_token" }]);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("fetchImpl이 3xx 응답을 그대로 돌려주면 보통 오류(HTTP_<상태>)로", async () => {
    const f = vi.fn().mockImplementation(async () => new Response(null, { status: 307, headers: { location: "https://elsewhere.example.test/" } }));
    const err = await createPolarClient(KEYS, f).getOrder(ORDER_ID).catch((e) => e);
    expect(err).toMatchObject({ code: "HTTP_307", status: 307 });
  });
});

describe("쓰기 요청의 2xx BAD_RESPONSE는 결과 불명 — Polar가 이미 처리했을 수 있다", () => {
  const invalid = { unexpected: true };
  it.each<[string, (c: PolarClient) => Promise<unknown>]>([
    [
      "createCheckout",
      (c) => c.createCheckout({ products: [PRODUCT_ID], external_customer_id: USER_ID, success_url: "https://example.test/ok" }),
    ],
    ["updateSubscription", (c) => c.updateSubscription(SUB_ID, { revoke: true })],
    ["createRefund", (c) => c.createRefund({ order_id: ORDER_ID, reason: "other", amount: 1 })],
    ["createCustomerSession", (c) => c.createCustomerSession({ external_customer_id: USER_ID })],
  ])("%s → true", async (_, run) => {
    const err = await run(createPolarClient(KEYS, fakeFetch(200, invalid))).catch((e) => e);
    expect(err).toMatchObject({ name: "PolarError", code: "BAD_RESPONSE", status: 200, mutating: true });
    expect(isPolarOutcomeUnknown(err)).toBe(true);
  });

  it.each<[string, (c: PolarClient) => Promise<unknown>]>([
    ["getSubscription", (c) => c.getSubscription(SUB_ID)],
    ["getOrder", (c) => c.getOrder(ORDER_ID)],
    ["getCheckout", (c) => c.getCheckout(CHECKOUT_ID)],
  ])("읽기 요청 %s → false", async (_, run) => {
    const err = await run(createPolarClient(KEYS, fakeFetch(200, invalid))).catch((e) => e);
    expect(err).toMatchObject({ name: "PolarError", code: "BAD_RESPONSE", status: 200, mutating: false });
    expect(isPolarOutcomeUnknown(err)).toBe(false);
  });

  it("직접 만든 PolarError의 mutating 기본값은 false", () => {
    expect(new PolarError("BAD_RESPONSE", "x", 200).mutating).toBe(false);
    expect(isPolarOutcomeUnknown(new PolarError("BAD_RESPONSE", "x", 200, true))).toBe(true);
  });
});
