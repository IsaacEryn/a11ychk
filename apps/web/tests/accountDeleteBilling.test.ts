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
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`NEXT_REDIRECT ${url}`);
  },
}));

import { deleteAccount } from "../src/lib/actions/profile";
import type { BillingStore } from "../src/lib/billing/types";
import { NOW, createMemoryStore, customerRow, deleteUserCascade, iso, DAY, paymentRow, pgTime, subscriptionRow, type MemoryStore } from "./billingFakes";

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

      await expectDeleted();

      expect(m.deleteUser).toHaveBeenCalledTimes(1);
      expect(m.logAppError).not.toHaveBeenCalled();
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
