import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

// 회원 탈퇴 액션이 부르는 바깥 의존성을 대체한다 — 로그인·DB·기록·결제 저장소. 결제 정리 흐름(manage.ts)과
// 저장소의 오류 코드(store.ts)·테이블 없음 판정(dbErrors.ts)은 진짜를 쓴다.
const m = vi.hoisted(() => ({
  user: { id: "11111111-1111-4111-8111-111111111111", email: "user@example.com" },
  role: "user" as string,
  activeScans: 0,
  deleteUserError: null as { message: string } | null,
  deleteUser: vi.fn(),
  logAppError: vi.fn(),
  store: null as unknown,
  /** createMorDeps가 돌려줄 값 — null이면 Polar 미설정(off·키 없음) */
  mor: null as unknown,
}));

vi.mock("@/lib/actions/shared", () => ({
  requireUser: async () => ({
    supabase: {
      from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: { role: m.role }, error: null }) }) }) }),
      auth: { signOut: async () => ({}) },
    },
    user: m.user,
  }),
  actionLocale: async () => "ko",
  revalidateAll: () => undefined,
  revalidateLocalized: () => undefined,
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({}) }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => ({ select: () => ({ eq: () => ({ in: async () => ({ count: m.activeScans }) }) }) }),
    auth: { admin: { deleteUser: m.deleteUser } },
  }),
}));
vi.mock("@/lib/notify", () => ({ sendAdminInquiryAlert: async () => undefined }));
vi.mock("@/lib/logs", () => ({ logAppError: m.logAppError }));
vi.mock("@/lib/billing/store", () => ({ createSupabaseBillingStore: () => m.store }));
vi.mock("@/lib/billing/server", () => ({ createMorDeps: () => m.mor }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`NEXT_REDIRECT ${url}`);
  },
}));

import { deleteAccount } from "../src/lib/actions/profile";
import { PolarError } from "../src/lib/billing/polar";
import type { BillingStore } from "../src/lib/billing/types";
import {
  NOW,
  createFakePolar,
  createMemoryStore,
  customerRow,
  deleteUserCascade,
  iso,
  DAY,
  makeMorDeps,
  paymentRow,
  pgTime,
  polarSubscription,
  subscriptionRow,
  type FakeMorDeps,
  type MemoryStore,
  type MemorySubscription,
  type PolarScript,
} from "./billingFakes";

const USER = m.user.id;
const OLD_KEY = "v1:old-iv:old-tag:old-ct";

const form = () => {
  const f = new FormData();
  f.set("confirm", "user@example.com");
  return f;
};
const run = () => deleteAccount({}, form());

/** 탈퇴가 끝까지 가면 로그인 화면으로 보낸다(redirect가 던진다) */
async function expectDeleted() {
  await expect(run()).rejects.toThrow("NEXT_REDIRECT /ko/login?reason=deleted");
}

const memory = (seed: Parameters<typeof createMemoryStore>[0] = {}): MemoryStore => {
  const store = createMemoryStore(seed, { now: () => NOW });
  m.store = store;
  return store;
};

/** deleteUser가 불린 시점의 구독 상태 — 계정을 지우기 전에는 아무것도 끝내지 않았는지 본다 */
let statusesAtDelete: string[] | null;

beforeEach(() => {
  vi.stubEnv("BILLING_MODE", "off");
  m.mor = null;
  m.role = "user";
  m.activeScans = 0;
  m.deleteUserError = null;
  m.logAppError.mockReset();
  m.deleteUser.mockReset();
  statusesAtDelete = null;
  m.deleteUser.mockImplementation(async (id: string) => {
    const store = m.store as MemoryStore;
    statusesAtDelete = store.rows?.subscriptions.map((s) => s.status) ?? null;
    // 성공하면 0041의 cascade·set null — 고객 행(빌링키)은 지워지고 구독·결제는 user_id만 빈다
    if (!m.deleteUserError && store.rows) deleteUserCascade(store, id);
    return { error: m.deleteUserError };
  });
  memory();
});

describe("deleteAccount — 결제 정리", () => {
  it("끝낼 구독을 먼저 모으고, 계정을 지운 뒤 id로 끝낸다 — 빌링키는 고객 행과 함께 지워진다(결제 모드가 off여도)", async () => {
    const store = memory({
      subscriptions: [subscriptionRow({ user_id: USER, livemode: true }), subscriptionRow({ user_id: USER, livemode: false })],
      customers: [
        customerRow({ user_id: USER, livemode: true, toss_billing_key_enc: OLD_KEY }),
        customerRow({ user_id: USER, livemode: false, toss_billing_key_enc: OLD_KEY }),
      ],
    });

    await expectDeleted();

    // 계정을 지우는 순간에는 아무것도 끝내지 않았다 — 삭제가 실패하면 유료 기간을 잃지 않는다
    expect(statusesAtDelete).toEqual(["active", "active"]);
    expect(store.rows.subscriptions.map((s) => [s.status, s.ended_reason, s.user_id])).toEqual([
      ["ended", "user_canceled", null],
      ["ended", "user_canceled", null],
    ]);
    expect(store.rows.customers).toHaveLength(0);
    expect(m.logAppError).not.toHaveBeenCalled();
  });

  it("결과를 모르는 결제가 걸려 있어도 탈퇴는 막지 않고, 구독 id만 담은 확인 필요 기록 한 줄을 남긴다", async () => {
    const sub = subscriptionRow({ user_id: USER });
    memory({
      subscriptions: [sub],
      payments: [paymentRow({ user_id: USER, subscription_id: sub.id, kind: "renewal", status: "pending" })],
      customers: [customerRow({ user_id: USER, livemode: false, toss_billing_key_enc: OLD_KEY })],
    });

    await expectDeleted();

    expect(m.deleteUser).toHaveBeenCalledWith(USER);
    expect(m.logAppError).toHaveBeenCalledTimes(1);
    const [, message, opts] = m.logAppError.mock.calls[0];
    expect(message).toMatch(/^billing needs review: account deleted with pending payment/);
    expect(message).toContain(sub.id);
    expect(message).not.toContain("user@example.com");
    expect(message).not.toContain(OLD_KEY);
    expect(opts).toEqual({ path: "actions.deleteAccount" });
  });

  it("구독이 없고 첫 결제만 결과를 모르는 경우도 같은 기록을 남기고 탈퇴한다", async () => {
    memory({ payments: [paymentRow({ user_id: USER, kind: "initial", status: "pending", livemode: true })] });

    await expectDeleted();

    expect(m.deleteUser).toHaveBeenCalledTimes(1);
    expect(m.logAppError.mock.calls[0][1]).toMatch(/^billing needs review: account deleted with pending payment/);
  });

  it("모은 뒤 계정을 지우기 전에 갱신이 확정돼 기간이 넘어갔어도 끝내고, 그 결제를 확인 필요 한 줄(id만)로 남긴다", async () => {
    const sub = subscriptionRow({ user_id: USER });
    const store = memory({ subscriptions: [sub], customers: [customerRow({ user_id: USER, livemode: false, toss_billing_key_enc: OLD_KEY })] });
    const renewal = paymentRow({ user_id: USER, subscription_id: sub.id, kind: "renewal", status: "paid", period_start: sub.current_period_end, period_end: iso(NOW + 50 * DAY) });
    const deleteAfterCascade = m.deleteUser.getMockImplementation()!;
    m.deleteUser.mockImplementationOnce(async (id: string) => {
      // 크론의 갱신이 계정 삭제 직전에 확정됐다 — 구독이 한 주기 전진하고 결제는 paid
      Object.assign(store.rows.subscriptions[0], { current_period_start: pgTime(sub.current_period_end), current_period_end: pgTime(NOW + 50 * DAY) });
      store.rows.payments.push(structuredClone(renewal));
      return deleteAfterCascade(id);
    });

    await expectDeleted();

    expect(store.rows.subscriptions[0]).toMatchObject({ status: "ended", ended_reason: "user_canceled", user_id: null });
    expect(store.rows.payments[0].status).toBe("paid");
    expect(m.logAppError).toHaveBeenCalledTimes(1);
    expect(m.logAppError.mock.calls[0][1]).toBe(`billing needs review: subscription ${sub.id} renewed during account deletion (payment ${renewal.id})`);
    expect(m.logAppError.mock.calls[0][2]).toEqual({ path: "actions.deleteAccount" });
  });

  it("계정을 지운 뒤 구독을 끝내지 못하면(저장소 오류) 구독 id로 확인 필요를 남기고 탈퇴는 성공한다 — 빌링키가 없어 청구되지 않는다", async () => {
    const sub = subscriptionRow({ user_id: USER });
    const store = memory({ subscriptions: [sub], customers: [customerRow({ user_id: USER, livemode: false, toss_billing_key_enc: OLD_KEY })] });
    store.updateSubscriptionIf = async () => {
      throw new Error("billing store updateSubscriptionIf: timeout");
    };

    await expectDeleted();

    expect(m.deleteUser).toHaveBeenCalledTimes(1);
    expect(store.rows.subscriptions[0]).toMatchObject({ status: "active", user_id: null });
    expect(store.rows.customers).toHaveLength(0);
    expect(m.logAppError).toHaveBeenCalledTimes(1);
    const [, message, opts] = m.logAppError.mock.calls[0];
    expect(message).toMatch(/^billing needs review/);
    expect(message).toContain(sub.id);
    expect(message).not.toContain("user@example.com");
    expect(opts).toEqual({ path: "actions.deleteAccount" });
  });

  it("구독 목록을 읽지 못하는 저장소 오류(테이블 없음이 아님)도 failed", async () => {
    const store = memory();
    store.listLiveSubscriptions = async () => {
      throw Object.assign(new Error("billing store listLiveSubscriptions: permission denied"), { code: "42501" });
    };

    expect(await run()).toEqual({ error: "failed" });
    expect(m.deleteUser).not.toHaveBeenCalled();
  });

  it("0041 미적용(결제 테이블 없음)이면 끝낼 구독이 없는 것이다 — 기록 없이 탈퇴를 계속한다 (진짜 저장소가 올린 오류 코드로 판정)", async () => {
    for (const code of ["42P01", "PGRST205"]) {
      m.deleteUser.mockClear();
      m.logAppError.mockClear();
      const missing = { data: null, error: { code, message: 'relation "public.subscriptions" does not exist' } };
      const failing = new Proxy(
        {},
        {
          get: (_t, prop) => (prop === "then" ? (ok: (v: unknown) => unknown) => Promise.resolve(missing).then(ok) : () => failing),
        },
      );
      // 모의 대체 없는 진짜 저장소 — 오류 코드를 달아 던지는지까지 함께 확인한다
      const { createSupabaseBillingStore } = await vi.importActual<typeof import("../src/lib/billing/store")>("../src/lib/billing/store");
      m.store = createSupabaseBillingStore({ from: () => failing } as unknown as SupabaseClient);
      // Polar가 설정돼 있어도 해지할 MoR 구독이 없다 — 응답을 정해 두지 않은 가짜라 부르면 던진다
      vi.stubEnv("BILLING_MODE", "test");
      const mor = makeMorDeps({ polar: createFakePolar() });
      m.mor = mor;

      await expectDeleted();

      expect(m.deleteUser).toHaveBeenCalledTimes(1);
      expect(m.logAppError).not.toHaveBeenCalled();
      expect(mor.polar.calls.updateSubscription).toEqual([]);
    }
  });

  it("진행 중 검사가 있으면 결제를 건드리기 전에 active로 거절한다", async () => {
    m.activeScans = 1;
    const store = memory({ subscriptions: [subscriptionRow({ user_id: USER })] });
    const list = vi.spyOn(store as BillingStore, "listLiveSubscriptions");

    expect(await run()).toEqual({ error: "active" });

    expect(list).not.toHaveBeenCalled();
    expect(store.rows.subscriptions[0].status).toBe("active");
    expect(m.deleteUser).not.toHaveBeenCalled();
  });

  it("관리자 계정·확인 문구 불일치는 결제를 건드리기 전에 거절한다", async () => {
    const store = memory({ subscriptions: [subscriptionRow({ user_id: USER })] });

    m.role = "admin";
    expect(await run()).toEqual({ error: "admin" });

    m.role = "user";
    const wrong = new FormData();
    wrong.set("confirm", "someone@else.com");
    expect(await deleteAccount({}, wrong)).toEqual({ error: "mismatch" });

    expect(store.rows.subscriptions[0].status).toBe("active");
    expect(m.deleteUser).not.toHaveBeenCalled();
  });

  it("계정 삭제가 실패하면 아무 구독도 끝내지 않는다 — 유료 기간과 빌링키가 그대로이고, 다시 시도하면 그때 끝낸다", async () => {
    const store = memory({
      subscriptions: [subscriptionRow({ user_id: USER })],
      customers: [customerRow({ user_id: USER, livemode: false, toss_billing_key_enc: OLD_KEY })],
    });
    m.deleteUserError = { message: "auth unavailable" };

    expect(await run()).toEqual({ error: "failed" });
    expect(store.rows.subscriptions[0]).toMatchObject({ status: "active", user_id: USER, ended_at: null });
    expect(store.rows.customers[0].toss_billing_key_enc).toBe(OLD_KEY);
    expect(m.logAppError.mock.calls.some(([, msg]) => String(msg).startsWith("account delete failed"))).toBe(true);

    m.deleteUserError = null;
    await expectDeleted();
    expect(store.rows.subscriptions[0]).toMatchObject({ status: "ended", ended_reason: "user_canceled" });
  });

  it("다른 사용자의 구독은 건드리지 않는다", async () => {
    const other = subscriptionRow({ user_id: "22222222-2222-4222-8222-222222222222", current_period_end: iso(NOW + 5 * DAY) });
    const store = memory({ subscriptions: [other] });

    await expectDeleted();

    expect(store.rows.subscriptions[0].status).toBe("active");
  });
});

describe("deleteAccount — 해외 결제(Polar) 구독은 계정을 지우기 전에 Polar에서 해지한다", () => {
  const POLAR_SUB = "66666666-6666-4666-8666-666666666666";
  const POLAR_SUB_2 = "67676767-6767-4767-8767-676767676767";
  const CUSTOMER = "55555555-5555-4555-8555-555555555555";
  const REVOKED_AT = "2026-01-30T16:00:01.250000Z";

  function morRow(over: Partial<MemorySubscription> = {}): MemorySubscription {
    return {
      ...subscriptionRow({ user_id: USER, provider: "mor", currency: "USD", billing_anchor_day: null }),
      mor_provider: "polar",
      external_id: POLAR_SUB,
      external_customer_id: CUSTOMER,
      external_updated_at: "2026-01-20T16:00:05.123456Z",
      ...over,
    };
  }
  const canceled = (over: Parameters<typeof polarSubscription>[0] = {}) =>
    polarSubscription({ id: POLAR_SUB, status: "canceled", modified_at: REVOKED_AT, canceled_at: REVOKED_AT, ended_at: REVOKED_AT, ...over });

  /** test 모드(행 livemode=false) + Polar 의존성(같은 메모리 저장소) */
  function polarWorld(seed: Parameters<typeof createMemoryStore>[0], script: Partial<PolarScript> = {}): { store: MemoryStore; mor: FakeMorDeps } {
    vi.stubEnv("BILLING_MODE", "test");
    const store = memory({ profiles: [USER], ...seed });
    const mor = makeMorDeps({ store, polar: createFakePolar(script) });
    m.mor = mor;
    return { store, mor };
  }
  const blocked = { error: "billingCancelFailed" };
  const messages = () => m.logAppError.mock.calls.map((c) => String(c[1]));

  it("revoke 성공 → 우리 행을 ended(user_canceled)로 끝낸 뒤 계정을 지운다 — Polar 해지가 deleteUser보다 먼저", async () => {
    const tossSub = subscriptionRow({ user_id: USER, current_period_end: iso(NOW + 5 * DAY) });
    const { store, mor } = polarWorld({ subscriptions: [morRow(), tossSub] }, { updateSubscription: [canceled()] });

    await expectDeleted();

    expect(mor.polar.calls.updateSubscription).toEqual([[POLAR_SUB, { revoke: true }]]);
    // 계정을 지우는 순간 MoR 행은 이미 끝났고, 토스 행은 M3 순서대로 지운 뒤에 끝난다
    expect(statusesAtDelete).toEqual(["ended", "active"]);
    expect(store.rows.subscriptions[0]).toMatchObject({
      status: "ended",
      ended_reason: "user_canceled",
      ended_at: pgTime(REVOKED_AT),
      external_updated_at: pgTime(REVOKED_AT),
      user_id: null,
    });
    expect(store.rows.subscriptions[1]).toMatchObject({ status: "ended", ended_reason: "user_canceled" });
    expect(messages()).toEqual([`billing account deletion: mor subscriptions ${POLAR_SUB} revoked at Polar (rows ${store.rows.subscriptions[0].id})`]);
    expect(m.logAppError.mock.calls[0][2]).toEqual({ path: "actions.deleteAccount" });
    expect(messages().join("\n")).not.toContain("user@example.com");
  });

  it("이미 해지됨(403 AlreadyCanceledSubscription)도 성공 — 행을 끝내고 탈퇴한다", async () => {
    const { store } = polarWorld(
      { subscriptions: [morRow({ status: "past_due" })] },
      { updateSubscription: [new PolarError("AlreadyCanceledSubscription", "polar updateSubscription failed: AlreadyCanceledSubscription (403)", 403, true)] },
    );

    await expectDeleted();

    expect(store.rows.subscriptions[0]).toMatchObject({ status: "ended", ended_reason: "user_canceled", ended_at: pgTime(NOW) });
    expect(m.deleteUser).toHaveBeenCalledTimes(1);
  });

  it("결과 불명이면 한 번 다시 읽어 canceled면 성공으로 본다", async () => {
    const { store, mor } = polarWorld(
      { subscriptions: [morRow()] },
      { updateSubscription: [new PolarError("NETWORK", "polar updateSubscription failed (network)", 0, true)], getSubscription: [canceled()] },
    );

    await expectDeleted();

    expect(mor.polar.calls.getSubscription).toEqual([[POLAR_SUB]]);
    expect(store.rows.subscriptions[0]).toMatchObject({ status: "ended", ended_reason: "user_canceled" });
  });

  it("revoke 응답이 canceled가 아니면 결과 불명처럼 다시 읽는다", async () => {
    const { store, mor } = polarWorld(
      { subscriptions: [morRow()] },
      { updateSubscription: [canceled({ status: "active" })], getSubscription: [canceled()] },
    );
    await expectDeleted();
    expect(mor.polar.calls.getSubscription).toHaveLength(1);
    expect(store.rows.subscriptions[0].status).toBe("ended");
  });

  it("다시 읽어도 해지되지 않았거나 읽지 못하면 탈퇴를 막는다(billingCancelFailed) — 계정·행 그대로, 기록 한 줄", async () => {
    for (const reread of [canceled({ status: "active" }), new PolarError("HTTP_502", "polar getSubscription failed: HTTP_502 (502)", 502)]) {
      m.deleteUser.mockClear();
      m.logAppError.mockClear();
      const { store } = polarWorld(
        { subscriptions: [morRow()] },
        { updateSubscription: [new PolarError("HTTP_503", "polar updateSubscription failed: HTTP_503 (503)", 503, true)], getSubscription: [reread] },
      );

      expect(await run()).toEqual(blocked);

      expect(m.deleteUser).not.toHaveBeenCalled();
      expect(store.rows.subscriptions[0]).toMatchObject({ status: "active", user_id: USER });
      expect(messages()).toEqual([
        `billing account deletion blocked for user ${USER}: mor subscription ${POLAR_SUB} (row ${store.rows.subscriptions[0].id}) could not be canceled at Polar (revoke outcome unknown)`,
      ]);
    }
  });

  it("revoke가 확정 실패(404·422 등)면 막는다", async () => {
    const { store, mor } = polarWorld(
      { subscriptions: [morRow()] },
      { updateSubscription: [new PolarError("ResourceNotFound", "polar updateSubscription failed: ResourceNotFound (404)", 404, true)] },
    );

    expect(await run()).toEqual(blocked);

    expect(mor.polar.calls.getSubscription).toEqual([]);
    expect(m.deleteUser).not.toHaveBeenCalled();
    expect(store.rows.subscriptions[0].status).toBe("active");
    expect(messages()).toEqual([
      `billing account deletion blocked for user ${USER}: mor subscription ${POLAR_SUB} (row ${store.rows.subscriptions[0].id}) could not be canceled at Polar (revoke failed: ResourceNotFound (404))`,
    ]);
  });

  it("Polar 의존성이 없으면(off·키 없음) Polar를 부르지 않고 막는다", async () => {
    for (const mode of ["off", "test"]) {
      m.deleteUser.mockClear();
      m.logAppError.mockClear();
      const { store } = polarWorld({ subscriptions: [morRow({ livemode: mode === "off" })] });
      vi.stubEnv("BILLING_MODE", mode);
      m.mor = null;

      expect(await run(), mode).toEqual(blocked);
      expect(m.deleteUser).not.toHaveBeenCalled();
      expect(messages(), mode).toEqual([
        `billing account deletion blocked for user ${USER}: mor subscriptions ${POLAR_SUB} (rows ${store.rows.subscriptions[0].id}) cannot be canceled at Polar here (Polar is not configured)`,
      ]);
    }
  });

  it("다른 모드의 MoR 구독이 하나라도 있으면 아무것도 해지하지 않고 막는다 — 이 배포의 Polar 토큰으로는 해지할 수 없다", async () => {
    const live = morRow({ livemode: true, external_id: POLAR_SUB_2 });
    const test = morRow();
    const { store, mor } = polarWorld({ subscriptions: [test, live] }, { updateSubscription: [canceled()] });

    expect(await run()).toEqual(blocked);

    expect(mor.polar.calls.updateSubscription).toEqual([]);
    expect(store.rows.subscriptions.map((s) => s.status)).toEqual(["active", "active"]);
    expect(messages()).toEqual([
      `billing account deletion blocked for user ${USER}: mor subscriptions ${POLAR_SUB},${POLAR_SUB_2} (rows ${test.id},${live.id}) cannot be canceled at Polar here (livemode differs from this deployment)`,
    ]);
  });

  it("해지 뒤 우리 행을 끝내지 못해도(저장소 오류) 탈퇴는 계속한다 — Polar는 더 청구하지 않고, 남은 행은 크론 대사가 끝낸다", async () => {
    const { store } = polarWorld({ subscriptions: [morRow()] }, { updateSubscription: [canceled()] });
    store.updateMorSubscriptionIf = async () => {
      throw new Error("billing store updateMorSubscriptionIf: timeout");
    };

    await expectDeleted();

    expect(store.rows.subscriptions[0]).toMatchObject({ status: "active", user_id: null });
    expect(messages()).toEqual([
      `billing account deletion: mor subscriptions ${POLAR_SUB} revoked at Polar (rows ${store.rows.subscriptions[0].id}); rows ${store.rows.subscriptions[0].id} could not be ended — the billing cron reconciles them`,
    ]);
  });

  it("그 사이 웹훅이 먼저 행을 끝냈으면(조건부 갱신 엇갈림) 그대로 둔다", async () => {
    const { store } = polarWorld({ subscriptions: [morRow({ external_updated_at: "2026-01-30T16:00:09.000000Z" })] }, { updateSubscription: [canceled()] });
    const realUpdate = store.updateMorSubscriptionIf.bind(store);
    let first = true;
    store.updateMorSubscriptionIf = async (id, expected, patch) => {
      if (first) {
        first = false;
        Object.assign(store.rows.subscriptions[0], { status: "ended", ended_reason: "payment_failed", ended_at: pgTime(NOW) });
      }
      return realUpdate(id, expected, patch);
    };

    await expectDeleted();

    expect(store.rows.subscriptions[0]).toMatchObject({ status: "ended", ended_reason: "payment_failed" });
    expect(messages()).toEqual([`billing account deletion: mor subscriptions ${POLAR_SUB} revoked at Polar (rows ${store.rows.subscriptions[0].id})`]);
  });

  it("저장된 Polar 시각이 해지 응답보다 늦어도 끝낸다(다시 읽어 저장된 시각을 조건으로)", async () => {
    const { store } = polarWorld({ subscriptions: [morRow({ external_updated_at: "2026-01-30T16:00:09.000000Z" })] }, { updateSubscription: [canceled()] });
    await expectDeleted();
    expect(store.rows.subscriptions[0]).toMatchObject({ status: "ended", ended_reason: "user_canceled" });
  });

  it("MoR 구독을 읽지 못하는 저장소 오류(테이블 없음이 아님)면 failed — 계정을 지우지 않는다", async () => {
    const { store } = polarWorld({ subscriptions: [morRow()] });
    store.listLiveMorSubscriptions = async () => {
      throw Object.assign(new Error("billing store listLiveMorSubscriptions: permission denied"), { code: "42501" });
    };
    expect(await run()).toEqual({ error: "failed" });
    expect(m.deleteUser).not.toHaveBeenCalled();
  });

  it("끝난 MoR 구독·다른 사용자의 MoR 구독은 건드리지 않는다(Polar 의존성이 없어도 막지 않는다)", async () => {
    const ended = morRow({ status: "ended", ended_reason: "user_canceled" });
    const others = morRow({ user_id: "22222222-2222-4222-8222-222222222222", external_id: POLAR_SUB_2 });
    const store = memory({ subscriptions: [ended, others], profiles: [USER] });
    m.mor = null;

    await expectDeleted();

    expect(store.rows.subscriptions.map((s) => s.status)).toEqual(["ended", "active"]);
    expect(m.logAppError).not.toHaveBeenCalled();
  });
});
