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
  revalidateLocalized: vi.fn(),
}));
vi.mock("@/lib/actions/shared", () => ({
  requireUser: async () => ({ supabase: {}, user: m.user }),
  actionLocale: async () => m.locale,
  revalidateLocalized: m.revalidateLocalized,
}));
vi.mock("next/headers", () => ({ headers: async () => ({ get: (k: string) => m.headers.get(k.toLowerCase()) ?? null }) }));
vi.mock("@/lib/billing/viewer", () => ({ loadViewer: async () => m.viewer }));
vi.mock("@/lib/appSettings", () => ({ getBillingFlags: async () => m.flags }));
vi.mock("@/lib/billing/server", () => ({ createBillingDeps: m.createBillingDeps }));

import {
  abandonCheckout,
  cancelSubscriptionAction,
  resumeSubscriptionAction,
  startCardChange,
  startCheckout,
} from "../src/lib/actions/billing";
import { DAY, NOW, checkoutRow, createMemoryStore, iso, makeDeps, paymentRow, priceRow, subscriptionRow } from "./billingFakes";

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
  m.revalidateLocalized.mockReset();
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
    expect(await startCheckout({}, fd({ priceId: price.id, consent: "on" }))).toEqual({ error: "inProgress", blockedBy: "open" });

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

  it("abandonCheckout은 이 사용자의 open 시도만 닫고 닫은 수·남은 까닭을 준다, 결제 꺼짐이면 notConfigured", async () => {
    deps.store.rows.checkouts.push(checkoutRow({ user_id: USER, price_id: price.id }));
    expect(await abandonCheckout()).toEqual({ closed: 1, blockedBy: null });
    expect(deps.store.rows.checkouts[0]).toMatchObject({ status: "expired", failure_code: "abandoned" });
    // 닫을 것이 없으면 0 — 화면은 성공으로 안내하지 않는다
    expect(await abandonCheckout()).toEqual({ closed: 0, blockedBy: null });
    deps.store.rows.checkouts.push(checkoutRow({ user_id: USER, price_id: price.id, status: "processing" }));
    expect(await abandonCheckout()).toEqual({ closed: 0, blockedBy: "processing" });
    deps.store.listUnfinishedCheckouts = async () => {
      throw new Error("billing store listUnfinishedCheckouts: timeout");
    };
    expect(await abandonCheckout()).toEqual({ error: "failed" });

    vi.stubEnv("BILLING_MODE", "");
    expect(await abandonCheckout()).toEqual({ error: "notConfigured" });
  });
});

describe("cancelSubscriptionAction·resumeSubscriptionAction — 해지·재개", () => {
  it("지금 모드(test → livemode false)의 자기 구독만 — 해지 예약 → 재개, 결과마다 결제 관리·마이페이지를 다시 그린다", async () => {
    const mine = subscriptionRow({ user_id: USER });
    const liveRow = subscriptionRow({ user_id: USER, livemode: true });
    deps.store.rows.subscriptions.push(mine, liveRow);

    expect(await cancelSubscriptionAction()).toEqual({ ok: true, done: "scheduled" });
    // 요청 경로라 메일은 응답 뒤로 미룬다
    expect(m.createBillingDeps).toHaveBeenCalledWith({ deferMail: true });
    expect(m.revalidateLocalized).toHaveBeenCalledWith("/mypage/billing", "/mypage");
    expect(deps.store.rows.subscriptions.map((s) => s.cancel_at_period_end)).toEqual([true, false]);
    expect(deps.mailer.sent.map((x) => x.kind)).toEqual(["cancelScheduled"]);

    expect(await cancelSubscriptionAction()).toEqual({ error: "already" });
    expect(await resumeSubscriptionAction()).toEqual({ ok: true, done: "resumed" });
    expect(await resumeSubscriptionAction()).toEqual({ error: "notFound" });
    expect(deps.store.rows.subscriptions[0].cancel_at_period_end).toBe(false);
    expect(m.revalidateLocalized).toHaveBeenCalledTimes(4);
  });

  it("미납이면 바로 끝냄(endedNow), 결과를 모르는 결제가 있으면 busy, 기간이 끝난 예약은 tooLate", async () => {
    const due = subscriptionRow({
      user_id: USER,
      status: "past_due",
      current_period_start: iso(NOW - 30 * DAY),
      current_period_end: iso(NOW - DAY),
      grace_until: iso(NOW + 6 * DAY),
    });
    deps.store.rows.subscriptions.push(due);
    deps.store.rows.payments.push(
      paymentRow({ user_id: USER, subscription_id: due.id, kind: "retry", attempt: 2, period_start: due.current_period_end }),
    );
    expect(await cancelSubscriptionAction()).toEqual({ error: "busy" });

    deps.store.rows.payments[0].status = "failed";
    expect(await cancelSubscriptionAction()).toEqual({ ok: true, done: "endedNow" });
    expect(deps.store.rows.subscriptions[0]).toMatchObject({ status: "ended", ended_reason: "user_canceled" });

    deps.store.rows.subscriptions.push(
      subscriptionRow({ user_id: USER, cancel_at_period_end: true, current_period_start: iso(NOW - 30 * DAY), current_period_end: iso(NOW - 1000) }),
    );
    expect(await resumeSubscriptionAction()).toEqual({ error: "tooLate" });
  });

  it("결제 꺼짐이면 notAllowed, 설정이 없으면 notConfigured, 저장소 오류는 failed + 기록(다시 그리지 않는다)", async () => {
    vi.stubEnv("BILLING_MODE", "");
    expect(await cancelSubscriptionAction()).toEqual({ error: "notAllowed" });
    expect(await resumeSubscriptionAction()).toEqual({ error: "notAllowed" });
    expect(m.createBillingDeps).not.toHaveBeenCalled();

    vi.stubEnv("BILLING_MODE", "test");
    m.createBillingDeps.mockImplementation(() => null);
    expect(await cancelSubscriptionAction()).toEqual({ error: "notConfigured" });

    m.createBillingDeps.mockImplementation(() => deps);
    deps.store.getLiveSubscription = async () => {
      throw new Error("billing store getLiveSubscription: timeout");
    };
    expect(await cancelSubscriptionAction()).toEqual({ error: "failed" });
    expect(await resumeSubscriptionAction()).toEqual({ error: "failed" });
    expect(deps.log).toHaveBeenCalledWith(expect.stringContaining("billing cancel subscription failed"));
    expect(deps.log).toHaveBeenCalledWith(expect.stringContaining("billing resume subscription failed"));
    expect(m.revalidateLocalized).not.toHaveBeenCalled();
  });
});
