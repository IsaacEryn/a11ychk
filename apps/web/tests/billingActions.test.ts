import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FakeDeps } from "./billingFakes";

// 서버 액션이 부르는 바깥 의존성 — 로그인·요청 헤더·공개 범위·결제 의존성. 결제 모드·키 판정(config)은 진짜를 쓴다.
const m = vi.hoisted(() => ({
  user: { id: "11111111-1111-4111-8111-111111111111", email: "user@example.com" } as { id: string; email: string | null },
  headers: new Map<string, string>(),
  locale: "ko",
  viewer: { isAdmin: false, isTester: true },
  flags: { showPrices: false, checkoutOpen: false },
  deps: null as unknown,
  createBillingDeps: vi.fn(),
}));
vi.mock("@/lib/actions/shared", () => ({
  requireUser: async () => ({ supabase: {}, user: m.user }),
  actionLocale: async () => m.locale,
}));
vi.mock("next/headers", () => ({ headers: async () => ({ get: (k: string) => m.headers.get(k.toLowerCase()) ?? null }) }));
vi.mock("@/lib/billing/viewer", () => ({ loadViewer: async () => m.viewer }));
vi.mock("@/lib/appSettings", () => ({ getBillingFlags: async () => m.flags }));
vi.mock("@/lib/billing/server", () => ({ createBillingDeps: m.createBillingDeps }));

import { abandonCheckout, startCardChange, startCheckout } from "../src/lib/actions/billing";
import { NOW, checkoutRow, createMemoryStore, makeDeps, priceRow, subscriptionRow } from "./billingFakes";

const USER = "11111111-1111-4111-8111-111111111111";

function fd(entries: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  return f;
}

let deps: FakeDeps;
let price: ReturnType<typeof priceRow>;

beforeEach(() => {
  // 가짜 키 — 접두(test_)만 맞춘다
  vi.stubEnv("BILLING_MODE", "test");
  vi.stubEnv("TOSS_CLIENT_KEY", "test_ck_fake_client");
  vi.stubEnv("TOSS_SECRET_KEY", "test_sk_fake_secret");
  m.headers = new Map([["host", "localhost:3100"]]);
  m.locale = "en";
  m.viewer = { isAdmin: false, isTester: true };
  m.flags = { showPrices: false, checkoutOpen: false };
  price = priceRow();
  deps = makeDeps({ store: createMemoryStore({ prices: [price] }, { now: () => NOW }), now: () => NOW });
  m.createBillingDeps.mockReset();
  m.createBillingDeps.mockImplementation(() => deps);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("startCheckout — 결제 시작 액션", () => {
  it("정상: 요청 헤더로 만든 성공·실패 주소, 클라이언트 키·고객 키·이메일을 돌려준다(시크릿 키는 없다)", async () => {
    const out = await startCheckout({}, fd({ priceId: price.id, consent: "on" }));

    const checkout = deps.store.rows.checkouts[0];
    const customer = deps.store.rows.customers[0];
    expect(out).toEqual({
      ok: true,
      sdk: {
        clientKey: "test_ck_fake_client",
        customerKey: customer.toss_customer_key,
        successUrl: `http://localhost:3100/api/billing/toss/callback?checkout=${checkout.id}&locale=en`,
        failUrl: `http://localhost:3100/api/billing/toss/fail?checkout=${checkout.id}&locale=en`,
        customerEmail: "user@example.com",
      },
    });
    expect(JSON.stringify(out)).not.toContain("test_sk_");
    expect(deps.store.rows.consents).toHaveLength(1);
    expect(deps.store.rows.consents[0].snapshot).toMatchObject({ locale: "en", amount: price.amount });
  });

  it("동의가 없으면 consent — 결제 설정·DB를 보지 않는다", async () => {
    expect(await startCheckout({}, fd({ priceId: price.id }))).toEqual({ error: "consent" });
    expect(await startCheckout({}, fd({ priceId: "nope", consent: "on" }))).toEqual({ error: "invalid" });
    expect(m.createBillingDeps).not.toHaveBeenCalled();
  });

  it("결제 모드 off면 notAllowed, 키가 모자라면 notConfigured", async () => {
    vi.stubEnv("BILLING_MODE", "");
    expect(await startCheckout({}, fd({ priceId: price.id, consent: "on" }))).toEqual({ error: "notAllowed" });

    vi.stubEnv("BILLING_MODE", "test");
    vi.stubEnv("TOSS_CLIENT_KEY", "");
    expect(await startCheckout({}, fd({ priceId: price.id, consent: "on" }))).toEqual({ error: "notConfigured" });

    vi.stubEnv("TOSS_CLIENT_KEY", "test_ck_fake_client");
    m.createBillingDeps.mockImplementation(() => null);
    expect(await startCheckout({}, fd({ priceId: price.id, consent: "on" }))).toEqual({ error: "notConfigured" });
    expect(deps.store.rows.checkouts).toHaveLength(0);
  });

  it("test 모드에서 관리자·테스터가 아니면 notAllowed(플래그로 열 수 없다)", async () => {
    m.viewer = { isAdmin: false, isTester: false };
    m.flags = { showPrices: true, checkoutOpen: true };
    expect(await startCheckout({}, fd({ priceId: price.id, consent: "on" }))).toEqual({ error: "notAllowed" });
    expect(deps.store.rows.checkouts).toHaveLength(0);
  });

  it("전달 헤더가 host와 다르거나 로컬이 아닌 http면 failed — 시도를 만들기 전에 멈추고 기록한다", async () => {
    m.headers = new Map([
      ["host", "www.a11ychk.com"],
      ["x-forwarded-host", "evil.example"],
    ]);
    expect(await startCheckout({}, fd({ priceId: price.id, consent: "on" }))).toEqual({ error: "failed" });
    m.headers = new Map([
      ["host", "www.a11ychk.com"],
      ["x-forwarded-proto", "http"],
    ]);
    expect(await startCheckout({}, fd({ priceId: price.id, consent: "on" }))).toEqual({ error: "failed" });
    expect(deps.store.rows.checkouts).toHaveLength(0);
    expect(deps.store.rows.customers).toHaveLength(0);
    expect(deps.log).toHaveBeenCalledTimes(2);
  });

  it("흐름의 거절은 그대로(inProgress 등), 저장소 오류는 failed + 기록", async () => {
    await startCheckout({}, fd({ priceId: price.id, consent: "on" }));
    expect(await startCheckout({}, fd({ priceId: price.id, consent: "on" }))).toEqual({ error: "inProgress" });

    deps.store.getPrice = async () => {
      throw new Error("billing store getPrice: timeout");
    };
    expect(await startCheckout({}, fd({ priceId: price.id, consent: "on" }))).toEqual({ error: "failed" });
    expect(deps.log).toHaveBeenCalledWith(expect.stringContaining("billing start checkout failed"));
  });
});

describe("startCardChange·abandonCheckout", () => {
  it("자기 진행 중 구독이면 카드 변경 결제창 값을 돌려주고, 남의 구독이면 notAllowed — 공개 범위 플래그와 무관", async () => {
    const mine = subscriptionRow({ user_id: USER, price_id: price.id, livemode: true });
    const others = subscriptionRow({ user_id: "22222222-2222-4222-8222-222222222222", price_id: price.id, livemode: true });
    deps.store.rows.subscriptions.push(mine, others);
    // live 모드에서 새 가입을 닫아도(checkoutOpen false) 기존 구독자는 카드를 바꿀 수 있다
    vi.stubEnv("BILLING_MODE", "live");
    vi.stubEnv("TOSS_CLIENT_KEY", "live_ck_fake_client");
    vi.stubEnv("TOSS_SECRET_KEY", "live_sk_fake_secret");
    m.viewer = { isAdmin: false, isTester: false };

    expect(await startCardChange({}, fd({ subscriptionId: others.id }))).toEqual({ error: "notAllowed" });
    const out = await startCardChange({}, fd({ subscriptionId: mine.id }));
    expect(out).toMatchObject({ ok: true, sdk: { clientKey: "live_ck_fake_client" } });
    expect(deps.store.rows.checkouts[0]).toMatchObject({ purpose: "card_change", subscription_id: mine.id, livemode: true });
    expect(await startCardChange({}, fd({ subscriptionId: "x" }))).toEqual({ error: "invalid" });
  });

  it("abandonCheckout은 이 사용자의 open 시도만 닫는다, 결제 꺼짐이면 notConfigured", async () => {
    deps.store.rows.checkouts.push(checkoutRow({ user_id: USER, price_id: price.id }));
    expect(await abandonCheckout()).toEqual({ ok: true });
    expect(deps.store.rows.checkouts[0]).toMatchObject({ status: "expired", failure_code: "abandoned" });

    vi.stubEnv("BILLING_MODE", "");
    expect(await abandonCheckout()).toEqual({ error: "notConfigured" });
  });
});
