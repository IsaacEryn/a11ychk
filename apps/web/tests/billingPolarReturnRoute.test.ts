import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FakeMorDeps } from "./billingFakes";

// Polar 복귀 라우트의 바깥 의존성 — 세션·Polar 의존성·관리자 클라이언트·기록. 결제 모드 판정(config)과 흐름은 진짜를 쓴다.
const m = vi.hoisted(() => ({
  user: { id: "11111111-1111-4111-8111-111111111111", email: "user@example.test" } as { id: string; email: string | null } | null,
  createClient: vi.fn(),
  createMorDeps: vi.fn(),
  logAppError: vi.fn(),
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: m.createClient }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));
vi.mock("@/lib/logs", () => ({ logAppError: m.logAppError }));
vi.mock("@/lib/billing/server", () => ({ createMorDeps: m.createMorDeps }));

import { GET, maxDuration } from "../src/app/api/billing/polar/return/route";
import { morAutoRefundId } from "../src/lib/billing/flows/mor";
import { PolarError } from "../src/lib/billing/polar";
import {
  NOW,
  checkoutRow,
  createFakePolar,
  createMemoryStore,
  makeMorDeps,
  paymentRow,
  polarCheckout,
  polarOrder,
  polarSubscription,
  priceRow,
  subscriptionRow,
} from "./billingFakes";

const USER = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const PRODUCT = "44444444-4444-4444-8444-444444444444";
const PC = "55555555-5555-4555-8555-555555555555";
const SUB = "66666666-6666-4666-8666-666666666666";
const CUSTOMER = "77777777-7777-4777-8777-777777777777";
const ORDER = "88888888-8888-4888-8888-888888888888";

function req(query: string, headers: Record<string, string> = { host: "localhost:3100" }, base = "http://localhost:3100") {
  return new Request(`${base}/api/billing/polar/return${query}`, { headers });
}
const location = (res: Response) => res.headers.get("location");

let deps: FakeMorDeps;
let price: ReturnType<typeof priceRow>;
let attempt: ReturnType<typeof checkoutRow>;

/** 우리 시도에 묶인 Polar 결제창 — 기본은 이 사용자·test 모드·en */
function checkout(over: Parameters<typeof polarCheckout>[0] = {}) {
  return polarCheckout({
    id: PC,
    status: "succeeded",
    subscription_id: SUB,
    external_customer_id: USER,
    product_id: PRODUCT,
    metadata: { checkout_id: attempt.id, user_id: USER, livemode: false, locale: "en" },
    ...over,
  });
}
const subscription = (over: Parameters<typeof polarSubscription>[0] = {}) =>
  polarSubscription({
    id: SUB,
    product_id: PRODUCT,
    customer: { id: CUSTOMER, external_id: USER },
    checkout_id: PC,
    metadata: { checkout_id: attempt.id, user_id: USER, livemode: false },
    ...over,
  });

beforeEach(() => {
  vi.stubEnv("BILLING_MODE", "test");
  vi.stubEnv("TOSS_SECRET_KEY", "");
  m.user = { id: USER, email: "user@example.test" };
  price = priceRow({ provider: "mor", currency: "USD", external_price_id: PRODUCT });
  attempt = checkoutRow({ user_id: USER, price_id: price.id, provider: "mor" });
  deps = makeMorDeps({
    store: createMemoryStore(
      { prices: [price], profiles: [USER, OTHER], checkouts: [attempt], consents: [{ id: "c1", user_id: USER, checkout_id: attempt.id, subscription_id: null, kind: "recurring_payment" }] },
      { now: () => NOW },
    ),
    polar: createFakePolar(),
  });
  for (const fn of [m.createClient, m.createMorDeps, m.logAppError]) fn.mockReset();
  m.createClient.mockImplementation(async () => ({ auth: { getUser: async () => ({ data: { user: m.user } }) } }));
  m.createMorDeps.mockImplementation(() => deps);
  m.logAppError.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("Polar 결제창 복귀 라우트 — 게이트", () => {
  it("함수 제한 시간을 30초로 둔다", () => {
    expect(maxDuration).toBe(30);
  });

  it("결제 꺼짐이면 404 — 세션도 Polar도 보지 않는다", async () => {
    vi.stubEnv("BILLING_MODE", "");
    const res = await GET(req(`?checkout_id=${PC}`));
    expect(res.status).toBe(404);
    expect(m.createClient).not.toHaveBeenCalled();
    expect(m.createMorDeps).not.toHaveBeenCalled();
  });

  it("세션이 없으면 로그인으로 303(next 없이) — 로케일은 로케일 쿠키(ko·en만), 없으면 ko. Polar는 부르지 않는다", async () => {
    m.user = null;
    expect(location(await GET(req(`?checkout_id=${PC}`)))).toBe("http://localhost:3100/ko/login");
    expect(location(await GET(req(`?checkout_id=${PC}`, { host: "localhost:3100", cookie: "a=1; NEXT_LOCALE=en" })))).toBe(
      "http://localhost:3100/en/login",
    );
    expect(location(await GET(req(`?checkout_id=${PC}`, { host: "localhost:3100", cookie: "NEXT_LOCALE=fr" })))).toBe(
      "http://localhost:3100/ko/login",
    );
    expect(deps.polar.calls.getCheckout).toHaveLength(0);
  });

  it("checkout_id가 없거나 UUID가 아니면 notFound — Polar를 부르지 않는다", async () => {
    for (const q of ["", "?checkout_id=nope", `?checkout_id=${PC}x`, "?checkout_id={CHECKOUT_ID}"]) {
      const res = await GET(req(q));
      expect(res.status).toBe(303);
      expect(location(res)).toBe("http://localhost:3100/ko/mypage/billing?error=notFound");
    }
    expect(deps.polar.calls.getCheckout).toHaveLength(0);
  });

  it("Polar 의존성이 없으면 notConfigured", async () => {
    m.createMorDeps.mockImplementation(() => null);
    expect(location(await GET(req(`?checkout_id=${PC}`)))).toBe("http://localhost:3100/ko/mypage/billing?error=notConfigured");
  });

  it("예외는 기록(id만) 뒤 error=failed — 결제 관리로", async () => {
    m.createClient.mockRejectedValue(new Error("auth down"));
    const res = await GET(req(`?checkout_id=${PC}`));
    expect(location(res)).toBe("http://localhost:3100/ko/mypage/billing?error=failed");
    expect(m.logAppError).toHaveBeenCalledTimes(1);
    expect(String(m.logAppError.mock.calls[0][1])).toBe(`billing polar return failed for checkout ${PC}: auth down`);
  });

  it("리다이렉트 origin은 검증한 Host 헤더 — 전달 헤더가 다르면 요청 URL의 origin", async () => {
    deps.polar.script.getCheckout = [checkout({ status: "confirmed" }), checkout({ status: "confirmed" })];
    expect(location(await GET(req(`?checkout_id=${PC}`, { host: "127.0.0.1:3100", "x-forwarded-proto": "http" })))).toBe(
      "http://127.0.0.1:3100/en/mypage/billing?result=pending",
    );
    expect(
      location(await GET(req(`?checkout_id=${PC}`, { host: "www.a11ychk.com", "x-forwarded-host": "evil.example" }, "https://www.a11ychk.com"))),
    ).toBe("https://www.a11ychk.com/en/mypage/billing?result=pending");
  });
});

describe("Polar 결제창 복귀 라우트 — 결제창 상태", () => {
  it("succeeded: 구독을 다시 읽어 바로 동기화한다(웹훅보다 먼저 권한) → result=subscribed, 시도 completed·동의 연결", async () => {
    deps.polar.script.getCheckout = [checkout()];
    deps.polar.script.getSubscription = [subscription()];

    const res = await GET(req(`?checkout_id=${PC.toUpperCase()}`));

    expect(res.status).toBe(303);
    expect(location(res)).toBe("http://localhost:3100/en/mypage/billing?result=subscribed");
    expect(deps.polar.calls.getCheckout).toEqual([[PC]]);
    expect(deps.polar.calls.getSubscription).toEqual([[SUB]]);
    const row = deps.store.rows.subscriptions[0];
    expect(row).toMatchObject({ user_id: USER, provider: "mor", status: "active", external_id: SUB, livemode: false, price_id: price.id });
    expect(deps.store.rows.checkouts[0]).toMatchObject({ status: "completed", subscription_id: row.id });
    expect(deps.store.rows.consents[0].subscription_id).toBe(row.id);
  });

  it("succeeded인데 진행 중(active)으로 적지 못했으면 pending — 미납·미완료·구독 없음", async () => {
    deps.polar.script.getCheckout = [checkout(), checkout(), checkout({ subscription_id: null })];
    deps.polar.script.getSubscription = [subscription({ status: "past_due" })];
    expect(location(await GET(req(`?checkout_id=${PC}`)))).toBe("http://localhost:3100/en/mypage/billing?result=pending");

    deps.store.rows.subscriptions.length = 0;
    deps.polar.script.getSubscription = [subscription({ status: "incomplete", modified_at: "2026-01-20T16:00:09.000000Z" })];
    expect(location(await GET(req(`?checkout_id=${PC}`)))).toBe("http://localhost:3100/en/mypage/billing?result=pending");

    expect(location(await GET(req(`?checkout_id=${PC}`)))).toBe("http://localhost:3100/en/mypage/billing?result=pending");
    expect(deps.polar.calls.getSubscription).toHaveLength(2);
  });

  it("succeeded인데 이미 다른 진행 중 구독이 있으면(돈 안전 불변식으로 해지·환불) 그 가격의 결제 확인 화면에 duplicateRefunded", async () => {
    deps.store.rows.subscriptions.push(subscriptionRow({ user_id: USER }));
    deps.polar.script.getCheckout = [checkout()];
    deps.polar.script.getSubscription = [subscription()];
    deps.polar.script.updateSubscription = [subscription({ status: "canceled" })];
    // 주문을 아직 모른다 — 동기화가 해지하고 needs review를 남긴다(환불은 주문 웹훅이 마친다)
    expect(location(await GET(req(`?checkout_id=${PC}`)))).toBe(`http://localhost:3100/en/billing/checkout?price=${price.id}&error=duplicateRefunded`);
    expect(deps.polar.calls.updateSubscription).toEqual([[SUB, { revoke: true }]]);
  });

  it("웹훅이 먼저 해지·환불을 시작했으면(구독 canceled, 첫 결제 행·자동 환불 기록 있음) 다시 해지·환불하지 않고 duplicateRefunded", async () => {
    deps.store.rows.subscriptions.push(subscriptionRow({ user_id: USER }));
    const payment = paymentRow({
      user_id: USER,
      provider: "mor",
      currency: "USD",
      checkout_id: attempt.id,
      kind: "initial",
      order_id: `mor_${ORDER}`,
      external_payment_id: ORDER,
      amount: 1334,
      status: "paid",
      period_start: null,
      period_end: null,
      approved_at: "2026-01-20T16:00:02.000000Z",
    });
    deps.store.rows.payments.push(payment);
    deps.store.rows.refunds.push({
      id: morAutoRefundId(payment.id),
      payment_id: payment.id,
      amount: 1234,
      reason: "auto_duplicate",
      external_refund_id: null,
      status: "pending",
      requested_by: null,
    });
    deps.polar.script.getCheckout = [checkout()];
    deps.polar.script.getSubscription = [
      subscription({ status: "canceled", canceled_at: "2026-01-20T16:00:06.000000Z", ended_at: "2026-01-20T16:00:06.000000Z", modified_at: "2026-01-20T16:00:06.000000Z" }),
    ];
    deps.polar.script.getOrder = [polarOrder({ id: ORDER, subscription_id: SUB, metadata: { checkout_id: attempt.id, user_id: USER } })];

    expect(location(await GET(req(`?checkout_id=${PC}`)))).toBe(`http://localhost:3100/en/billing/checkout?price=${price.id}&error=duplicateRefunded`);
    expect(deps.polar.calls.updateSubscription).toHaveLength(0);
    expect(deps.polar.calls.createRefund).toHaveLength(0);
    expect(deps.store.rows.refunds).toHaveLength(1);
  });

  it("stale(웹훅이 더 새로운 상태를 먼저 적음) — 우리 행이 이 사용자의 active면 subscribed", async () => {
    deps.polar.script.getCheckout = [checkout(), checkout()];
    // 웹훅이 먼저: 결제창 복귀가 읽은 구독보다 새로운 수정 시각으로 행을 만들었다
    deps.polar.script.getSubscription = [subscription({ modified_at: "2026-01-20T16:00:09.000000Z" }), subscription()];
    expect(location(await GET(req(`?checkout_id=${PC}`)))).toBe("http://localhost:3100/en/mypage/billing?result=subscribed");
    expect(deps.store.rows.subscriptions).toHaveLength(1);
    // 복귀는 더 오래된 정본을 읽는다 → stale → 행을 읽어 판정
    expect(location(await GET(req(`?checkout_id=${PC}`)))).toBe("http://localhost:3100/en/mypage/billing?result=subscribed");
    expect(deps.store.rows.subscriptions[0]).toMatchObject({ status: "active", external_updated_at: "2026-01-20T16:00:09+00:00" });
  });

  it("웹훅이 같은 정본으로 행을 먼저 만들었으면(재전송과 같다) subscribed", async () => {
    deps.polar.script.getCheckout = [checkout(), checkout()];
    deps.polar.script.getSubscription = [subscription(), subscription()];
    expect(location(await GET(req(`?checkout_id=${PC}`)))).toBe("http://localhost:3100/en/mypage/billing?result=subscribed");
    expect(location(await GET(req(`?checkout_id=${PC}`)))).toBe("http://localhost:3100/en/mypage/billing?result=subscribed");
    expect(deps.store.rows.subscriptions).toHaveLength(1);
  });

  it("stale인데 우리 행이 미납이거나 남의 행이면 pending", async () => {
    deps.polar.script.getCheckout = [checkout(), checkout(), checkout()];
    deps.polar.script.getSubscription = [subscription({ status: "past_due", modified_at: "2026-01-20T16:00:09.000000Z" }), subscription()];
    expect(location(await GET(req(`?checkout_id=${PC}`)))).toBe("http://localhost:3100/en/mypage/billing?result=pending");
    expect(location(await GET(req(`?checkout_id=${PC}`)))).toBe("http://localhost:3100/en/mypage/billing?result=pending");

    // 같은 외부 id의 행이 다른 사용자 것 — 구독했다고 알리지 않는다
    deps.store.rows.subscriptions[0].status = "active";
    deps.store.rows.subscriptions[0].user_id = OTHER;
    deps.polar.script.getSubscription = [subscription()];
    expect(location(await GET(req(`?checkout_id=${PC}`)))).toBe("http://localhost:3100/en/mypage/billing?result=pending");
  });

  it("구독 읽기·동기화가 실패하면(결과 불명) pending + 기록 — 웹훅·크론이 마친다", async () => {
    deps.polar.script.getCheckout = [checkout(), checkout()];
    deps.polar.script.getSubscription = [new PolarError("NETWORK", "polar getSubscription failed (network)", 0)];
    expect(location(await GET(req(`?checkout_id=${PC}`)))).toBe("http://localhost:3100/en/mypage/billing?result=pending");
    expect(deps.log).toHaveBeenCalledWith(`billing polar return: subscription ${SUB} of checkout ${PC} was not synced (NETWORK 0); shown as pending`);

    deps.polar.script.getSubscription = [subscription()];
    deps.store.insertMorSubscription = async () => {
      throw new Error("billing store insertMorSubscription: timeout");
    };
    expect(location(await GET(req(`?checkout_id=${PC}`)))).toBe("http://localhost:3100/en/mypage/billing?result=pending");
    expect(m.logAppError).not.toHaveBeenCalled();
  });

  it("confirmed·open·처음 보는 상태는 pending — 시도를 건드리지 않는다", async () => {
    deps.polar.script.getCheckout = [checkout({ status: "confirmed" }), checkout({ status: "open" }), checkout({ status: "settling" })];
    for (let i = 0; i < 3; i++) expect(location(await GET(req(`?checkout_id=${PC}`)))).toBe("http://localhost:3100/en/mypage/billing?result=pending");
    expect(deps.store.rows.checkouts[0].status).toBe("open");
    expect(deps.polar.calls.getSubscription).toHaveLength(0);
  });

  it("expired: 시도를 만료로 닫고 그 가격의 결제 확인 화면에 expired", async () => {
    deps.polar.script.getCheckout = [checkout({ status: "expired", subscription_id: null })];
    expect(location(await GET(req(`?checkout_id=${PC}`)))).toBe(`http://localhost:3100/en/billing/checkout?price=${price.id}&error=expired`);
    expect(deps.store.rows.checkouts[0]).toMatchObject({ status: "expired" });
  });

  it("failed: 시도를 failed(polarCheckoutFailed)로 닫고 결제 확인 화면에 failed", async () => {
    deps.polar.script.getCheckout = [checkout({ status: "failed", subscription_id: null })];
    expect(location(await GET(req(`?checkout_id=${PC}`)))).toBe(`http://localhost:3100/en/billing/checkout?price=${price.id}&error=failed`);
    expect(deps.store.rows.checkouts[0]).toMatchObject({ status: "failed", failure_code: "polarCheckoutFailed" });
  });

  it("우리 시도를 모르거나 남의 시도면 시도를 건드리지 않고 결제 관리로 오류", async () => {
    const others = checkoutRow({ user_id: OTHER, price_id: price.id, provider: "mor" });
    deps.store.rows.checkouts.push(others);
    deps.polar.script.getCheckout = [
      checkout({ status: "failed", metadata: { user_id: USER, livemode: false, locale: "en" } }),
      checkout({ status: "expired", metadata: { checkout_id: others.id, user_id: USER, livemode: false, locale: "en" } }),
    ];
    expect(location(await GET(req(`?checkout_id=${PC}`)))).toBe("http://localhost:3100/en/mypage/billing?error=failed");
    expect(location(await GET(req(`?checkout_id=${PC}`)))).toBe("http://localhost:3100/en/mypage/billing?error=expired");
    expect(deps.store.rows.checkouts.map((c) => c.status)).toEqual(["open", "open"]);
  });

  it("시도를 닫다 저장소 오류가 나면 기록 뒤 error=failed", async () => {
    deps.polar.script.getCheckout = [checkout({ status: "expired" })];
    deps.store.expireCheckouts = async () => {
      throw new Error("billing store expireCheckouts: timeout");
    };
    expect(location(await GET(req(`?checkout_id=${PC}`)))).toBe("http://localhost:3100/ko/mypage/billing?error=failed");
    expect(String(m.logAppError.mock.calls[0][1])).toContain("expireCheckouts");
  });
});

describe("Polar 결제창 복귀 라우트 — 주인·모드·로케일", () => {
  it.each([
    ["다른 사용자(external_customer_id)", { external_customer_id: OTHER }],
    ["external_customer_id 없이 metadata의 다른 사용자", { external_customer_id: null, metadata: { checkout_id: "x", user_id: OTHER, livemode: false } }],
    ["둘이 엇갈림", { metadata: { user_id: OTHER, livemode: false } }],
    ["사용자 없음", { external_customer_id: null, metadata: { livemode: false } }],
    ["다른 모드(livemode true)", { metadata: { checkout_id: "x", user_id: USER, livemode: true } }],
    ["모드 표시 없음", { metadata: { user_id: USER } }],
    ["모드가 문자열", { metadata: { user_id: USER, livemode: "false" } }],
  ])("%s → notFound, 동기화·시도 변경 없음", async (_why, over) => {
    deps.polar.script.getCheckout = [checkout(over as Parameters<typeof polarCheckout>[0])];
    expect(location(await GET(req(`?checkout_id=${PC}`)))).toBe("http://localhost:3100/ko/mypage/billing?error=notFound");
    expect(deps.polar.calls.getSubscription).toHaveLength(0);
    expect(deps.store.rows.checkouts[0].status).toBe("open");
    expect(deps.store.rows.subscriptions).toHaveLength(0);
  });

  it("external_customer_id가 없으면 metadata.user_id로 주인을 본다", async () => {
    deps.polar.script.getCheckout = [checkout({ status: "confirmed", external_customer_id: null })];
    expect(location(await GET(req(`?checkout_id=${PC}`)))).toBe("http://localhost:3100/en/mypage/billing?result=pending");
  });

  it("Polar가 결제창을 모르면(404) notFound, 읽기가 결과 불명이면 pending + 기록", async () => {
    deps.polar.script.getCheckout = [
      new PolarError("ResourceNotFound", "polar getCheckout failed: ResourceNotFound (404)", 404),
      new PolarError("HTTP_503", "polar getCheckout failed: HTTP_503 (503)", 503),
    ];
    expect(location(await GET(req(`?checkout_id=${PC}`)))).toBe("http://localhost:3100/ko/mypage/billing?error=notFound");
    expect(location(await GET(req(`?checkout_id=${PC}`)))).toBe("http://localhost:3100/ko/mypage/billing?result=pending");
    expect(deps.log).toHaveBeenCalledWith(`billing polar return: checkout ${PC} could not be read (HTTP_503 503); shown as pending`);
  });

  it("로케일: metadata.locale → 결제창 locale → 로케일 쿠키 → ko, ko·en 밖의 값은 버린다", async () => {
    const meta = { checkout_id: attempt.id, user_id: USER, livemode: false };
    deps.polar.script.getCheckout = [
      checkout({ status: "confirmed", metadata: { ...meta, locale: "ko" }, locale: "en" }),
      checkout({ status: "confirmed", metadata: meta, locale: "en" }),
      checkout({ status: "confirmed", metadata: { ...meta, locale: "fr" }, locale: null }),
      checkout({ status: "confirmed", metadata: meta, locale: null }),
    ];
    expect(location(await GET(req(`?checkout_id=${PC}`)))).toBe("http://localhost:3100/ko/mypage/billing?result=pending");
    expect(location(await GET(req(`?checkout_id=${PC}`)))).toBe("http://localhost:3100/en/mypage/billing?result=pending");
    expect(location(await GET(req(`?checkout_id=${PC}`)))).toBe("http://localhost:3100/ko/mypage/billing?result=pending");
    expect(location(await GET(req(`?checkout_id=${PC}`, { host: "localhost:3100", cookie: "NEXT_LOCALE=en" })))).toBe(
      "http://localhost:3100/en/mypage/billing?result=pending",
    );
  });

  it("live 모드면 실결제(livemode true) 결제창·행만", async () => {
    vi.stubEnv("BILLING_MODE", "live");
    const livePrice = priceRow({ provider: "mor", currency: "USD", livemode: true, external_price_id: PRODUCT });
    deps.store.rows.prices = [livePrice];
    deps.store.rows.checkouts[0] = { ...attempt, livemode: true, price_id: livePrice.id };
    deps.polar.script.getCheckout = [checkout({ metadata: { checkout_id: attempt.id, user_id: USER, livemode: true, locale: "en" } }), checkout()];
    deps.polar.script.getSubscription = [subscription()];

    expect(location(await GET(req(`?checkout_id=${PC}`)))).toBe("http://localhost:3100/en/mypage/billing?result=subscribed");
    expect(deps.store.rows.subscriptions[0]).toMatchObject({ livemode: true, price_id: livePrice.id });
    // test 모드 표시의 결제창은 live 배포에서 받지 않는다
    expect(location(await GET(req(`?checkout_id=${PC}`)))).toBe("http://localhost:3100/ko/mypage/billing?error=notFound");
  });
});
