import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// 서버 액션이 부르는 바깥 의존성을 전부 대체한다 — 가드·DB·감사·결제 흐름.
const m = vi.hoisted(() => ({
  admin: { from: vi.fn() },
  logAdminAction: vi.fn(),
  logAppError: vi.fn(),
  createBillingDeps: vi.fn(),
  runBillingCycle: vi.fn(),
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => m.admin }));
vi.mock("@/lib/actions/shared", () => ({ requireAdmin: async () => ({ user: { id: "admin-1" } }) }));
vi.mock("@/lib/logs", () => ({ logAdminAction: m.logAdminAction, logAppError: m.logAppError }));
vi.mock("@/lib/billing/server", () => ({ createBillingDeps: m.createBillingDeps }));
// 크론 판정(decideRenewalAction)은 진짜를 쓴다 — 당긴 결과가 크론에서 어떻게 읽히는지 확인하려고
vi.mock("@/lib/billing/flows/renew", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/lib/billing/flows/renew")>()),
  runBillingCycle: m.runBillingCycle,
}));

import { createPrice, deactivatePrice } from "../src/lib/actions/adminBillingPrices";
import { pullDueDate, runBillingCycleNow } from "../src/lib/actions/adminBillingTools";
import { decideRenewalAction } from "../src/lib/billing/flows/renew";
import type { SubscriptionRow } from "../src/lib/billing/types";

type Call = [string, ...unknown[]];

/**
 * supabase-js 쿼리 빌더 대역 — 호출을 기록하고, maybeSingle/single은 single을, 그냥 await하면 result를 돌려준다.
 * (select → maybeSingle 조회와 update → select 쓰기를 한 대역으로 흉내 낸다)
 */
function fakeTable(result: { data?: unknown; error?: { code?: string; message: string } | null }, single = result) {
  const calls: Call[] = [];
  const b: Record<string, unknown> = {};
  for (const name of ["select", "eq", "in", "order", "limit", "update", "insert"]) {
    b[name] = (...args: unknown[]) => {
      calls.push([name, ...args]);
      return b;
    };
  }
  b.maybeSingle = async () => ({ error: null, ...single });
  b.single = async () => ({ error: null, ...single });
  b.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
    Promise.resolve({ error: null, ...result }).then(res, rej);
  return { builder: b, calls };
}

function fd(entries: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  return f;
}

const PRICE_ID = "11111111-2222-4333-8444-555555555555";
const SUB_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const NOW = Date.parse("2026-12-01T00:00:00Z");

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  m.admin.from.mockReset();
  m.logAdminAction.mockReset();
  m.logAppError.mockReset();
  m.createBillingDeps.mockReset();
  m.runBillingCycle.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("createPrice", () => {
  const form = fd({ planCode: "pro", interval: "month", amount: "1234", livemode: "test", active: "on" });

  it("입력이 틀리면 DB를 건드리지 않고 invalid", async () => {
    expect(await createPrice({}, fd({ planCode: "pro" }))).toEqual({ error: "invalid" });
    expect(m.admin.from).not.toHaveBeenCalled();
  });

  it("toss·KRW로 고정해 넣고 감사에 남긴다", async () => {
    const t = fakeTable({ data: { id: PRICE_ID } });
    m.admin.from.mockReturnValue(t.builder);
    expect(await createPrice({}, form)).toEqual({ ok: true });
    expect(m.admin.from).toHaveBeenCalledWith("billing_prices");
    expect(t.calls[0]).toEqual([
      "insert",
      { plan_code: "pro", provider: "toss", currency: "KRW", interval: "month", amount: 1234, livemode: false, active: true },
    ]);
    expect(m.logAdminAction).toHaveBeenCalledWith(
      m.admin,
      "admin-1",
      "billing.price_create",
      undefined,
      expect.objectContaining({ priceId: PRICE_ID, plan: "pro", amount: 1234, livemode: false }),
    );
  });

  it("같은 플랜·주기·모드의 활성 가격이 있으면(23505) activeExists, 감사 없음", async () => {
    m.admin.from.mockReturnValue(fakeTable({ data: null, error: { code: "23505", message: "dup" } }).builder);
    expect(await createPrice({}, form)).toEqual({ error: "activeExists" });
    expect(m.logAdminAction).not.toHaveBeenCalled();
    expect(m.logAppError).not.toHaveBeenCalled();
  });

  it("0041 미적용이면 기록 없이 migrationMissing", async () => {
    m.admin.from.mockReturnValue(fakeTable({ data: null, error: { code: "42P01", message: "no table" } }).builder);
    expect(await createPrice({}, form)).toEqual({ error: "migrationMissing" });
    expect(m.logAppError).not.toHaveBeenCalled();
  });

  it("그 밖의 DB 오류는 기록하고 failed", async () => {
    m.admin.from.mockReturnValue(fakeTable({ data: null, error: { code: "XX000", message: "boom" } }).builder);
    expect(await createPrice({}, form)).toEqual({ error: "failed" });
    expect(m.logAppError).toHaveBeenCalledTimes(1);
  });
});

describe("deactivatePrice", () => {
  it("active=false로만 바꾸고 이미 켜진 행에만 건다", async () => {
    const t = fakeTable({
      data: [{ id: PRICE_ID, plan_code: "pro", interval: "month", amount: 1234, livemode: false }],
    });
    m.admin.from.mockReturnValue(t.builder);
    expect(await deactivatePrice({}, fd({ priceId: PRICE_ID }))).toEqual({ ok: true });
    expect(t.calls).toContainEqual(["update", { active: false }]);
    expect(t.calls).toContainEqual(["eq", "id", PRICE_ID]);
    expect(t.calls).toContainEqual(["eq", "active", true]);
    expect(m.logAdminAction).toHaveBeenCalledWith(m.admin, "admin-1", "billing.price_deactivate", undefined, expect.objectContaining({ priceId: PRICE_ID }));
  });

  it("바뀐 행이 없으면(없거나 이미 비활성) notFound, 감사 없음", async () => {
    m.admin.from.mockReturnValue(fakeTable({ data: [] }).builder);
    expect(await deactivatePrice({}, fd({ priceId: PRICE_ID }))).toEqual({ error: "notFound" });
    expect(m.logAdminAction).not.toHaveBeenCalled();
  });

  it("UUID가 아니면 DB 없이 invalid", async () => {
    expect(await deactivatePrice({}, fd({ priceId: "x" }))).toEqual({ error: "invalid" });
    expect(m.admin.from).not.toHaveBeenCalled();
  });
});

describe("pullDueDate", () => {
  const DAY = 86_400_000;
  const iso = (t: number) => new Date(t).toISOString();
  const sub = (over: Record<string, unknown> = {}) => ({
    id: SUB_ID,
    user_id: "user-1",
    provider: "toss",
    livemode: false,
    status: "active",
    current_period_start: "2026-11-01T00:00:00+00:00",
    current_period_end: "2026-12-01T00:00:00+00:00",
    next_retry_at: null,
    grace_until: null,
    cancel_at_period_end: false,
    ...over,
  });
  const pastDue = (over: Record<string, unknown> = {}) =>
    sub({
      status: "past_due",
      current_period_start: iso(NOW - 33 * DAY),
      current_period_end: iso(NOW - 3 * DAY),
      next_retry_at: iso(NOW + 2 * DAY),
      grace_until: iso(NOW + 4 * DAY),
      ...over,
    });
  /** 크론 판정에 넣을 완전한 행 — 당기기 결과(patch)를 덮어쓴다 */
  const asCronRow = (found: Record<string, unknown>, patch: Record<string, unknown>, interval: "month" | "year" = "month") =>
    ({
      ...found,
      plan_code: "pro",
      amount: 1234,
      currency: "KRW",
      interval,
      cancel_at_period_end: false,
      reminder_sent_for: null,
      ...patch,
    }) as unknown as SubscriptionRow;

  /** 첫 from()은 조회, 둘째 from()은 쓰기 */
  function setup(found: unknown, written: { data?: unknown; error?: { code?: string; message: string } | null } = { data: [{ id: SUB_ID }] }) {
    const read = fakeTable({ data: found }, { data: found });
    const write = fakeTable(written);
    m.admin.from.mockReturnValueOnce(read.builder).mockReturnValueOnce(write.builder);
    return { read, write };
  }
  const patchOf = (calls: Call[]) => calls.find((c) => c[0] === "update")?.[1] as Record<string, unknown>;

  it("UUID가 아니거나 모르는 target이면 DB 없이 invalid", async () => {
    expect(await pullDueDate({}, fd({ subscriptionId: "x" }))).toEqual({ error: "invalid" });
    expect(await pullDueDate({}, fd({ subscriptionId: SUB_ID, target: "retry" }))).toEqual({ error: "invalid" });
    expect(m.admin.from).not.toHaveBeenCalled();
  });

  it("없는 구독은 notFound", async () => {
    setup(null);
    expect(await pullDueDate({}, fd({ subscriptionId: SUB_ID }))).toEqual({ error: "notFound" });
  });

  it("실결제(livemode=true) 구독은 notTest — 쓰기를 시도하지 않는다", async () => {
    const { write } = setup(sub({ livemode: true }));
    expect(await pullDueDate({}, fd({ subscriptionId: SUB_ID }))).toEqual({ error: "notTest" });
    expect(write.calls).toEqual([]);
    expect(m.admin.from).toHaveBeenCalledTimes(1);
    expect(m.logAdminAction).not.toHaveBeenCalled();
  });

  it("실결제 미납 구독도 notTest — 재시도 시점을 건드리지 않는다", async () => {
    setup(pastDue({ livemode: true }));
    expect(await pullDueDate({}, fd({ subscriptionId: SUB_ID }))).toEqual({ error: "notTest" });
    expect(m.admin.from).toHaveBeenCalledTimes(1);
  });

  it("toss가 아닌 구독(기관 계약 등)은 notTest", async () => {
    setup(sub({ provider: "manual" }));
    expect(await pullDueDate({}, fd({ subscriptionId: SUB_ID }))).toEqual({ error: "notTest" });
    expect(m.admin.from).toHaveBeenCalledTimes(1);
  });

  it("종료된 구독은 ended", async () => {
    setup(sub({ status: "ended" }));
    expect(await pullDueDate({}, fd({ subscriptionId: SUB_ID }))).toEqual({ error: "ended" });
    expect(m.admin.from).toHaveBeenCalledTimes(1);
  });

  it("active + charge(기본): 기간 끝을 지금 + 1분으로, 안내 기록을 비운다 — 시작은 그대로. 크론이 갱신 결제로 읽는다", async () => {
    const found = sub();
    const { write } = setup(found);
    expect(await pullDueDate({}, fd({ subscriptionId: SUB_ID }))).toEqual({ ok: true, kind: "charge" });
    const patch = patchOf(write.calls);
    expect(patch.current_period_end).toBe(iso(NOW + 60_000));
    expect(patch.reminder_sent_for).toBeNull();
    expect(patch).not.toHaveProperty("current_period_start");
    expect(patch).not.toHaveProperty("next_retry_at");
    expect(decideRenewalAction(asCronRow(found, patch), NOW)).toBe("charge");
    // 쓸 때도 livemode=false·toss·같은 상태·같은 기간 끝 조건을 다시 건다
    expect(write.calls).toContainEqual(["eq", "provider", "toss"]);
    expect(write.calls).toContainEqual(["eq", "livemode", false]);
    expect(write.calls).toContainEqual(["in", "status", ["active", "past_due"]]);
    expect(write.calls).toContainEqual(["eq", "status", "active"]);
    expect(write.calls).toContainEqual(["eq", "current_period_end", found.current_period_end]);
    expect(write.calls).toContainEqual(["eq", "cancel_at_period_end", false]);
    expect(m.logAdminAction).toHaveBeenCalledWith(m.admin, "admin-1", "billing.pull_due", "user-1", {
      subscriptionId: SUB_ID,
      status: "active",
      target: "charge",
      from: found.current_period_end,
      to: iso(NOW + 60_000),
    });
  });

  it.each(["month", "year"] as const)("active + remind(%s): 기간 끝을 지금 + 2일로 — 크론이 결제 예정 안내로 읽는다", async (interval) => {
    const found = sub();
    const { write } = setup(found);
    expect(await pullDueDate({}, fd({ subscriptionId: SUB_ID, target: "remind" }))).toEqual({ ok: true, kind: "remind" });
    const patch = patchOf(write.calls);
    expect(patch.current_period_end).toBe(iso(NOW + 2 * DAY));
    expect(patch.reminder_sent_for).toBeNull();
    expect(decideRenewalAction(asCronRow(found, patch, interval), NOW)).toBe("remind");
    expect(m.logAdminAction).toHaveBeenCalledWith(
      m.admin,
      "admin-1",
      "billing.pull_due",
      "user-1",
      expect.objectContaining({ target: "remind", from: found.current_period_end, to: iso(NOW + 2 * DAY) }),
    );
  });

  it("해지 예약 구독에 안내 시점 당기기는 cancelScheduled — 쓰지 않고 감사도 없다", async () => {
    const { write } = setup(sub({ cancel_at_period_end: true }));
    expect(await pullDueDate({}, fd({ subscriptionId: SUB_ID, target: "remind" }))).toEqual({ error: "cancelScheduled" });
    expect(write.calls).toEqual([]);
    expect(m.logAdminAction).not.toHaveBeenCalled();
  });

  it("해지 예약 구독에 결제일 당기기는 종료 시험(end) — 예약이 그대로일 때만 쓴다", async () => {
    const found = sub({ cancel_at_period_end: true });
    const { write } = setup(found);
    expect(await pullDueDate({}, fd({ subscriptionId: SUB_ID }))).toEqual({ ok: true, kind: "end" });
    expect(patchOf(write.calls).current_period_end).toBe(iso(NOW + 60_000));
    expect(write.calls).toContainEqual(["eq", "cancel_at_period_end", true]);
    expect(m.logAdminAction).toHaveBeenCalledWith(m.admin, "admin-1", "billing.pull_due", "user-1", expect.objectContaining({ target: "end" }));
  });

  it("시작이 새 기간 끝보다 늦거나 같으면 시작을 지금 − 1분으로 맞춘다(check 제약)", async () => {
    const { write } = setup(sub({ current_period_start: iso(NOW + 60_000) }));
    expect(await pullDueDate({}, fd({ subscriptionId: SUB_ID }))).toEqual({ ok: true, kind: "charge" });
    const patch = patchOf(write.calls);
    expect(patch.current_period_start).toBe(iso(NOW - 60_000));
    expect(Date.parse(patch.current_period_start as string)).toBeLessThan(Date.parse(patch.current_period_end as string));
  });

  it("past_due: 다음 재시도 시점만 지금으로 — 기간 끝·유예 기한·안내 기록은 쓰지 않는다. 크론이 재시도로 읽는다", async () => {
    const found = pastDue();
    const { write } = setup(found);
    // target을 보내도(남은 폼 값) 미납 구독은 기간 끝을 건드리지 않는다
    expect(await pullDueDate({}, fd({ subscriptionId: SUB_ID, target: "remind" }))).toEqual({ ok: true, kind: "retry" });
    const patch = patchOf(write.calls);
    expect(Object.keys(patch).sort()).toEqual(["next_retry_at", "updated_at"]);
    expect(patch.next_retry_at).toBe(iso(NOW));
    expect(decideRenewalAction(asCronRow(found, patch), NOW)).toBe("retry");
    expect(write.calls).toContainEqual(["eq", "status", "past_due"]);
    expect(write.calls).toContainEqual(["eq", "livemode", false]);
    expect(m.logAdminAction).toHaveBeenCalledWith(m.admin, "admin-1", "billing.pull_due", "user-1", {
      subscriptionId: SUB_ID,
      status: "past_due",
      target: "retry",
      from: found.next_retry_at,
      to: iso(NOW),
    });
  });

  it("past_due인데 유예 기한이 지났으면 graceOver — 쓰지 않고 감사도 없다", async () => {
    const { write } = setup(pastDue({ grace_until: iso(NOW - 1) }));
    expect(await pullDueDate({}, fd({ subscriptionId: SUB_ID }))).toEqual({ error: "graceOver" });
    expect(write.calls).toEqual([]);
    expect(m.admin.from).toHaveBeenCalledTimes(1);
    expect(m.logAdminAction).not.toHaveBeenCalled();
  });

  it("읽은 뒤 바뀌어 쓴 행이 없으면 ended, 감사 없음", async () => {
    setup(sub(), { data: [] });
    expect(await pullDueDate({}, fd({ subscriptionId: SUB_ID }))).toEqual({ error: "ended" });
    expect(m.logAdminAction).not.toHaveBeenCalled();
  });

  it("쓰기 오류는 기록하고 failed", async () => {
    setup(sub(), { data: null, error: { code: "XX000", message: "boom" } });
    expect(await pullDueDate({}, fd({ subscriptionId: SUB_ID }))).toEqual({ error: "failed" });
    expect(m.logAppError).toHaveBeenCalledTimes(1);
  });
});

describe("runBillingCycleNow", () => {
  const deps = { marker: "deps" };
  const summary = { candidates: 2, charge_paid: 1, none: 1 };

  it("모드가 off면 아무것도 하지 않고 off", async () => {
    vi.stubEnv("BILLING_MODE", "");
    expect(await runBillingCycleNow({}, fd({}))).toEqual({ error: "off" });
    expect(m.createBillingDeps).not.toHaveBeenCalled();
    expect(m.runBillingCycle).not.toHaveBeenCalled();
  });

  it("키가 없어 의존성을 못 만들면 notConfigured", async () => {
    vi.stubEnv("BILLING_MODE", "test");
    vi.stubEnv("TOSS_SECRET_KEY", "");
    m.createBillingDeps.mockReturnValue(null);
    expect(await runBillingCycleNow({}, fd({}))).toEqual({ error: "notConfigured" });
    expect(m.runBillingCycle).not.toHaveBeenCalled();
  });

  it("test 모드는 테스트 행(livemode=false)만 돌리고 개수를 돌려주며 감사에 남긴다", async () => {
    vi.stubEnv("BILLING_MODE", "test");
    vi.stubEnv("TOSS_SECRET_KEY", "");
    m.createBillingDeps.mockReturnValue(deps);
    m.runBillingCycle.mockResolvedValue(summary);
    expect(await runBillingCycleNow({}, fd({}))).toEqual({ ok: true, summary });
    expect(m.runBillingCycle).toHaveBeenCalledWith(deps, false);
    expect(m.logAdminAction).toHaveBeenCalledWith(m.admin, "admin-1", "billing.cycle_run", undefined, { mode: "test", ok: true, summary });
  });

  it("live 모드는 확인 체크 없이는 돌리지 않는다", async () => {
    vi.stubEnv("BILLING_MODE", "live");
    vi.stubEnv("TOSS_SECRET_KEY", "");
    expect(await runBillingCycleNow({}, fd({}))).toEqual({ error: "confirm" });
    expect(m.createBillingDeps).not.toHaveBeenCalled();
    expect(m.runBillingCycle).not.toHaveBeenCalled();
  });

  it("live 모드에서 확인하면 실결제 행(livemode=true)을 돌린다", async () => {
    vi.stubEnv("BILLING_MODE", "live");
    vi.stubEnv("TOSS_SECRET_KEY", "");
    m.createBillingDeps.mockReturnValue(deps);
    m.runBillingCycle.mockResolvedValue(summary);
    expect(await runBillingCycleNow({}, fd({ confirm: "on" }))).toEqual({ ok: true, summary });
    expect(m.runBillingCycle).toHaveBeenCalledWith(deps, true);
  });

  it("흐름이 던지면 errorText로 기록하고 failed, 실패도 감사에 남긴다(중간까지 결제가 나갔을 수 있다)", async () => {
    vi.stubEnv("BILLING_MODE", "test");
    vi.stubEnv("TOSS_SECRET_KEY", "");
    m.createBillingDeps.mockReturnValue(deps);
    m.runBillingCycle.mockRejectedValue(new Error("boom"));
    expect(await runBillingCycleNow({}, fd({}))).toEqual({ error: "failed" });
    expect(m.logAppError).toHaveBeenCalledWith(m.admin, "runBillingCycleNow failed: boom", { path: "adminBillingTools" });
    expect(m.logAdminAction).toHaveBeenCalledWith(m.admin, "admin-1", "billing.cycle_run", undefined, { mode: "test", ok: false });
  });

  it("토스 오류는 코드와 상태만 기록한다(errorText)", async () => {
    vi.stubEnv("BILLING_MODE", "test");
    vi.stubEnv("TOSS_SECRET_KEY", "");
    m.createBillingDeps.mockReturnValue(deps);
    const { TossError } = await import("../src/lib/billing/toss");
    m.runBillingCycle.mockRejectedValue(new TossError("UNAUTHORIZED_KEY", "secret-looking message", 401));
    expect(await runBillingCycleNow({}, fd({}))).toEqual({ error: "failed" });
    expect(m.logAppError).toHaveBeenCalledWith(m.admin, "runBillingCycleNow failed: UNAUTHORIZED_KEY (401)", { path: "adminBillingTools" });
  });
});
