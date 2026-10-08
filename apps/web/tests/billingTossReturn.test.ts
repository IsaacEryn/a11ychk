import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// 토스 복귀 라우트의 바깥 의존성 — 세션·결제 의존성·관리자 클라이언트·기록·결제 흐름. 결제 모드 판정(config)은 진짜를 쓴다.
const m = vi.hoisted(() => ({
  user: { id: "11111111-1111-4111-8111-111111111111", email: "user@example.com" } as { id: string; email: string | null } | null,
  createClient: vi.fn(),
  createBillingDeps: vi.fn(),
  getCheckout: vi.fn(),
  logAppError: vi.fn(),
  completeCheckout: vi.fn(),
  failCheckout: vi.fn(),
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: m.createClient }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));
vi.mock("@/lib/logs", () => ({ logAppError: m.logAppError }));
vi.mock("@/lib/billing/server", () => ({
  createBillingDeps: m.createBillingDeps,
  createSupabaseBillingStore: () => ({ getCheckout: m.getCheckout }),
}));
vi.mock("@/lib/billing/flows/subscribe", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/lib/billing/flows/subscribe")>()),
  completeCheckout: m.completeCheckout,
  failCheckout: m.failCheckout,
}));

import { GET as callback } from "../src/app/api/billing/toss/callback/route";
import { GET as fail } from "../src/app/api/billing/toss/fail/route";

const USER = "11111111-1111-4111-8111-111111111111";
const CHECKOUT = "33333333-4444-4555-8666-777777777777";
const PRICE = "11111111-2222-4333-8444-555555555555";
const AUTH_KEY = "auth_plain_secret_0002";
const DEPS = { marker: "deps", log: vi.fn() };

/** 요청 — url의 호스트와 Host 헤더를 따로 줄 수 있다(Next가 127.0.0.1을 localhost로 바꿔 주는 경우 흉내) */
function req(path: string, headers: Record<string, string> = { host: "localhost:3100" }, base = "http://localhost:3100") {
  return new Request(`${base}${path}`, { headers });
}
const location = (res: Response) => res.headers.get("location");

beforeEach(() => {
  vi.stubEnv("BILLING_MODE", "test");
  vi.stubEnv("TOSS_SECRET_KEY", "test_sk_fake_secret");
  m.user = { id: USER, email: "user@example.com" };
  for (const fn of [m.createClient, m.createBillingDeps, m.getCheckout, m.logAppError, m.completeCheckout, m.failCheckout]) fn.mockReset();
  m.createClient.mockImplementation(async () => ({ auth: { getUser: async () => ({ data: { user: m.user } }) } }));
  m.createBillingDeps.mockImplementation(() => DEPS);
  m.logAppError.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("토스 성공 콜백 라우트", () => {
  it("결제 꺼짐이면 404 — 세션도 보지 않는다", async () => {
    vi.stubEnv("BILLING_MODE", "");
    const res = await callback(req(`/api/billing/toss/callback?checkout=${CHECKOUT}&authKey=a&customerKey=b`));
    expect(res.status).toBe(404);
    expect(m.createClient).not.toHaveBeenCalled();
    expect((await fail(req(`/api/billing/toss/fail?checkout=${CHECKOUT}`))).status).toBe(404);
  });

  it("세션이 없으면 로그인으로 303(next 없이 — authKey를 옮기지 않는다), 로케일은 쿼리대로", async () => {
    m.user = null;
    const res = await callback(req(`/api/billing/toss/callback?checkout=${CHECKOUT}&locale=en&authKey=${AUTH_KEY}&customerKey=b`));
    expect(res.status).toBe(303);
    expect(location(res)).toBe("http://localhost:3100/en/login");
    expect(m.completeCheckout).not.toHaveBeenCalled();
  });

  it("정상: 메일을 미루는 의존성으로 completeCheckout을 부르고 결과 주소로 303", async () => {
    m.completeCheckout.mockResolvedValue({ kind: "subscribed", subscriptionId: "s1" });

    const res = await callback(req(`/api/billing/toss/callback?checkout=${CHECKOUT}&locale=ko&customerKey=ck-1&authKey=${AUTH_KEY}`));

    expect(res.status).toBe(303);
    expect(location(res)).toBe("http://localhost:3100/ko/mypage/billing?result=subscribed");
    expect(m.createBillingDeps).toHaveBeenCalledWith({ deferMail: true });
    expect(m.completeCheckout).toHaveBeenCalledWith(DEPS, {
      checkoutId: CHECKOUT,
      userId: USER,
      livemode: false,
      authKey: AUTH_KEY,
      customerKey: "ck-1",
      customerEmail: "user@example.com",
    });
  });

  it("live 모드면 실결제 행(livemode: true)으로 흐름을 부른다 — 콜백·실패 모두", async () => {
    vi.stubEnv("BILLING_MODE", "live");
    vi.stubEnv("TOSS_SECRET_KEY", "live_sk_fake_secret");
    m.completeCheckout.mockResolvedValue({ kind: "subscribed", subscriptionId: "s1" });
    m.failCheckout.mockResolvedValue({ priceId: null, reason: "canceled", purpose: "card_change" });

    const ok = await callback(req(`/api/billing/toss/callback?checkout=${CHECKOUT}&locale=ko&customerKey=ck-1&authKey=${AUTH_KEY}`));
    expect(location(ok)).toBe("http://localhost:3100/ko/mypage/billing?result=subscribed");
    expect(m.completeCheckout.mock.calls[0][1]).toMatchObject({ checkoutId: CHECKOUT, userId: USER, livemode: true });

    await fail(req(`/api/billing/toss/fail?checkout=${CHECKOUT}&locale=ko&code=PAY_PROCESS_CANCELED`));
    expect(m.failCheckout).toHaveBeenCalledWith(DEPS, { checkoutId: CHECKOUT, userId: USER, livemode: true, code: "PAY_PROCESS_CANCELED" });
  });

  it("토스가 ?로 이어 붙인 쿼리도 같은 값으로 읽고, 오류는 가격이 있으면 그 결제 화면으로", async () => {
    m.completeCheckout.mockResolvedValue({ kind: "error", code: "cardRejected", priceId: PRICE });
    const res = await callback(req(`/api/billing/toss/callback?checkout=${CHECKOUT}&locale=en?customerKey=ck-1&authKey=${AUTH_KEY}`));
    expect(location(res)).toBe(`http://localhost:3100/en/billing/checkout?price=${PRICE}&error=cardRejected`);
    expect(m.completeCheckout.mock.calls[0][1]).toMatchObject({ authKey: AUTH_KEY, customerKey: "ck-1" });
  });

  it("리다이렉트 origin은 검증한 Host 헤더 — 요청 URL이 localhost로 바뀌어 와도 브라우저가 쓴 127.0.0.1로 돌아간다", async () => {
    m.completeCheckout.mockResolvedValue({ kind: "pending" });
    const res = await callback(
      req(`/api/billing/toss/callback?checkout=${CHECKOUT}&customerKey=b&authKey=a`, { host: "127.0.0.1:3100", "x-forwarded-proto": "http" }),
    );
    expect(location(res)).toBe("http://127.0.0.1:3100/ko/mypage/billing?result=pending");

    // 전달 헤더가 Host와 다르면 Host 헤더를 믿지 않고 요청 URL의 origin
    const forged = await callback(
      req(`/api/billing/toss/callback?checkout=${CHECKOUT}&customerKey=b&authKey=a`, { host: "www.a11ychk.com", "x-forwarded-host": "evil.example" }, "https://www.a11ychk.com"),
    );
    expect(location(forged)).toBe("https://www.a11ychk.com/ko/mypage/billing?result=pending");
  });

  it("예외는 기록(authKey 없이) 뒤 error=failed — 결제 관리로", async () => {
    m.completeCheckout.mockRejectedValue(new Error("boom"));
    const res = await callback(req(`/api/billing/toss/callback?checkout=${CHECKOUT}&customerKey=b&authKey=${AUTH_KEY}`));
    expect(res.status).toBe(303);
    expect(location(res)).toBe("http://localhost:3100/ko/mypage/billing?error=failed");
    expect(m.logAppError).toHaveBeenCalledTimes(1);
    const logged = String(m.logAppError.mock.calls[0][1]);
    expect(logged).toContain("boom");
    expect(logged).toContain(CHECKOUT);
    expect(logged).not.toContain(AUTH_KEY);

    // 세션 조회가 던져도 같다
    m.createClient.mockRejectedValue(new Error("auth down"));
    expect(location(await callback(req(`/api/billing/toss/callback?checkout=${CHECKOUT}`)))).toBe("http://localhost:3100/ko/mypage/billing?error=failed");
  });

  it("설정이 없으면 notConfigured — 그 사용자의 새 구독 시도면 그 가격의 결제 화면, 아니면 결제 관리", async () => {
    m.createBillingDeps.mockImplementation(() => null);
    m.getCheckout.mockResolvedValue({ id: CHECKOUT, user_id: USER, livemode: false, purpose: "subscribe", price_id: PRICE });
    expect(location(await callback(req(`/api/billing/toss/callback?checkout=${CHECKOUT}&customerKey=b&authKey=a`)))).toBe(
      `http://localhost:3100/ko/billing/checkout?price=${PRICE}&error=notConfigured`,
    );

    m.getCheckout.mockResolvedValue({ id: CHECKOUT, user_id: "someone-else", livemode: false, purpose: "subscribe", price_id: PRICE });
    expect(location(await callback(req(`/api/billing/toss/callback?checkout=${CHECKOUT}&customerKey=b&authKey=a`)))).toBe(
      "http://localhost:3100/ko/mypage/billing?error=notConfigured",
    );
    expect(m.completeCheckout).not.toHaveBeenCalled();
  });

  it("시도 id가 UUID가 아니면 notFound, 인증 결과가 없으면 시도를 닫고 failed", async () => {
    expect(location(await callback(req("/api/billing/toss/callback?checkout=nope&customerKey=b&authKey=a")))).toBe(
      "http://localhost:3100/ko/mypage/billing?error=notFound",
    );
    expect(m.completeCheckout).not.toHaveBeenCalled();

    m.failCheckout.mockResolvedValue({ priceId: PRICE, reason: "failed", purpose: "subscribe" });
    expect(location(await callback(req(`/api/billing/toss/callback?checkout=${CHECKOUT}`)))).toBe(
      `http://localhost:3100/ko/billing/checkout?price=${PRICE}&error=failed`,
    );
    expect(m.failCheckout).toHaveBeenCalledWith(DEPS, { checkoutId: CHECKOUT, userId: USER, livemode: false, code: "MISSING_AUTH_RESULT" });
  });
});

describe("토스 실패 라우트", () => {
  it("시도를 닫고 새 구독이면 결제 화면, 카드 변경이면 결제 관리로", async () => {
    m.failCheckout.mockResolvedValue({ priceId: PRICE, reason: "canceled", purpose: "subscribe" });
    const res = await fail(req(`/api/billing/toss/fail?checkout=${CHECKOUT}&locale=en&code=PAY_PROCESS_CANCELED&message=x`));
    expect(res.status).toBe(303);
    expect(location(res)).toBe(`http://localhost:3100/en/billing/checkout?price=${PRICE}&error=canceled`);
    expect(m.failCheckout).toHaveBeenCalledWith(DEPS, { checkoutId: CHECKOUT, userId: USER, livemode: false, code: "PAY_PROCESS_CANCELED" });

    m.failCheckout.mockResolvedValue({ priceId: PRICE, reason: "failed", purpose: "card_change" });
    expect(location(await fail(req(`/api/billing/toss/fail?checkout=${CHECKOUT}&code=REJECT_CARD_COMPANY`)))).toBe(
      "http://localhost:3100/ko/mypage/billing?error=failed",
    );
  });

  it("세션이 없으면 로그인, 시도 id가 이상하면 시도를 건드리지 않고 결제 관리로", async () => {
    m.user = null;
    expect(location(await fail(req(`/api/billing/toss/fail?checkout=${CHECKOUT}`)))).toBe("http://localhost:3100/ko/login");
    m.user = { id: USER, email: null };
    expect(location(await fail(req("/api/billing/toss/fail?checkout=bad&code=X")))).toBe("http://localhost:3100/ko/mypage/billing?error=failed");
    expect(m.failCheckout).not.toHaveBeenCalled();
  });
});
