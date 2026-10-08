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
vi.mock("@/lib/billing/flows/renew", () => ({ runBillingCycle: m.runBillingCycle }));

import { createPrice, deactivatePrice } from "../src/lib/actions/adminBillingPrices";
import { pullDueDate, runBillingCycleNow } from "../src/lib/actions/adminBillingTools";

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
  const sub = (over: Record<string, unknown> = {}) => ({
    id: SUB_ID,
    user_id: "user-1",
    provider: "toss",
    livemode: false,
    status: "active",
    current_period_start: "2026-11-01T00:00:00+00:00",
    current_period_end: "2026-12-01T00:00:00+00:00",
    ...over,
  });

  /** 첫 from()은 조회, 둘째 from()은 쓰기 */
  function setup(found: unknown, written: { data?: unknown; error?: { code?: string; message: string } | null } = { data: [{ id: SUB_ID }] }) {
    const read = fakeTable({ data: found }, { data: found });
    const write = fakeTable(written);
    m.admin.from.mockReturnValueOnce(read.builder).mockReturnValueOnce(write.builder);
    return { read, write };
  }

  it("UUID가 아니면 DB 없이 invalid", async () => {
    expect(await pullDueDate({}, fd({ subscriptionId: "x" }))).toEqual({ error: "invalid" });
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

  it("기간 끝을 지금 + 1분으로, 안내 기록을 비운다 — 시작은 그대로", async () => {
    const { write } = setup(sub());
    expect(await pullDueDate({}, fd({ subscriptionId: SUB_ID }))).toEqual({ ok: true });
    const patch = write.calls.find((c) => c[0] === "update")?.[1] as Record<string, unknown>;
    expect(patch.current_period_end).toBe(new Date(NOW + 60_000).toISOString());
    expect(patch.reminder_sent_for).toBeNull();
    expect(patch).not.toHaveProperty("current_period_start");
    // 쓸 때도 livemode=false·toss·진행 중 조건을 다시 건다
    expect(write.calls).toContainEqual(["eq", "provider", "toss"]);
    expect(write.calls).toContainEqual(["eq", "livemode", false]);
    expect(write.calls).toContainEqual(["in", "status", ["active", "past_due"]]);
    expect(m.logAdminAction).toHaveBeenCalledWith(
      m.admin,
      "admin-1",
      "billing.pull_due",
      "user-1",
      expect.objectContaining({ subscriptionId: SUB_ID, to: new Date(NOW + 60_000).toISOString() }),
    );
  });

  it("시작이 새 기간 끝보다 늦거나 같으면 시작을 지금 − 1분으로 맞춘다(check 제약)", async () => {
    const { write } = setup(sub({ current_period_start: new Date(NOW + 60_000).toISOString() }));
    expect(await pullDueDate({}, fd({ subscriptionId: SUB_ID }))).toEqual({ ok: true });
    const patch = write.calls.find((c) => c[0] === "update")?.[1] as Record<string, unknown>;
    expect(patch.current_period_start).toBe(new Date(NOW - 60_000).toISOString());
    expect(Date.parse(patch.current_period_start as string)).toBeLessThan(Date.parse(patch.current_period_end as string));
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
    expect(m.logAdminAction).toHaveBeenCalledWith(m.admin, "admin-1", "billing.cycle_run", undefined, { mode: "test", summary });
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

  it("흐름이 던지면 기록하고 failed, 감사는 남기지 않는다", async () => {
    vi.stubEnv("BILLING_MODE", "test");
    vi.stubEnv("TOSS_SECRET_KEY", "");
    m.createBillingDeps.mockReturnValue(deps);
    m.runBillingCycle.mockRejectedValue(new Error("boom"));
    expect(await runBillingCycleNow({}, fd({}))).toEqual({ error: "failed" });
    expect(m.logAppError).toHaveBeenCalledTimes(1);
    expect(m.logAdminAction).not.toHaveBeenCalled();
  });
});
