import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// 결제 크론 라우트 — 인증·실행 기록·의존성 조립·흐름을 대체하고, 모드 판정(config)은 진짜를 쓴다
const m = vi.hoisted(() => ({
  createBillingDeps: vi.fn(),
  createMorDeps: vi.fn(),
  runBillingCycle: vi.fn(),
  runMorCycle: vi.fn(),
}));
vi.mock("@/lib/cronAuth", () => ({ isAuthorizedCron: () => true }));
vi.mock("@/lib/cronRun", () => ({ withCronRun: async (_job: string, fn: () => Promise<Record<string, unknown>>) => fn() }));
vi.mock("@/lib/billing/server", () => ({ createBillingDeps: m.createBillingDeps, createMorDeps: m.createMorDeps }));
vi.mock("@/lib/billing/flows/renew", () => ({ runBillingCycle: m.runBillingCycle }));
vi.mock("@/lib/billing/flows/morCycle", () => ({ runMorCycle: m.runMorCycle }));

import { GET } from "../src/app/api/cron/billing/route";

const call = () => GET(new Request("https://www.a11ychk.com/api/cron/billing"));
const TOSS = { kind: "toss-deps" };
const MOR = { kind: "mor-deps" };

beforeEach(() => {
  vi.stubEnv("BILLING_MODE", "test");
  vi.stubEnv("TOSS_SECRET_KEY", "");
  for (const fn of Object.values(m)) fn.mockReset();
  m.runBillingCycle.mockResolvedValue({ candidates: 0 });
  m.runMorCycle.mockResolvedValue({ mor_candidates: 0 });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("GET /api/cron/billing — MoR 대사 단계", () => {
  it("off면 처리 없이 skipped", async () => {
    vi.stubEnv("BILLING_MODE", "");
    expect(await (await call()).json()).toEqual({ skipped: "off" });
    expect(m.createMorDeps).not.toHaveBeenCalled();
  });

  it("토스·Polar 모두 있으면 한 실행에 MoR 의존성을 넘긴다(같은 예산)", async () => {
    m.createBillingDeps.mockReturnValue(TOSS);
    m.createMorDeps.mockReturnValue(MOR);
    expect(await (await call()).json()).toEqual({ candidates: 0 });
    expect(m.runBillingCycle).toHaveBeenCalledWith(TOSS, false, { mor: MOR });
    expect(m.runMorCycle).not.toHaveBeenCalled();
  });

  it("Polar 키가 없으면 MoR 단계 없이 토스 단계만(mor: null)", async () => {
    m.createBillingDeps.mockReturnValue(TOSS);
    m.createMorDeps.mockReturnValue(null);
    await call();
    expect(m.runBillingCycle).toHaveBeenCalledWith(TOSS, false, { mor: null });
  });

  it("토스 키가 없으면 MoR 대사를 마저 돌린 뒤 설정 안 됨으로 실패한다(상호 감시가 알린다)", async () => {
    m.createBillingDeps.mockReturnValue(null);
    m.createMorDeps.mockReturnValue(MOR);
    await expect(call()).rejects.toThrow("billing cron not configured");
    expect(m.runMorCycle).toHaveBeenCalledWith(MOR, false);
    expect(m.runBillingCycle).not.toHaveBeenCalled();
  });

  it("둘 다 없으면 아무것도 돌리지 않고 실패한다", async () => {
    m.createBillingDeps.mockReturnValue(null);
    m.createMorDeps.mockReturnValue(null);
    await expect(call()).rejects.toThrow("billing cron not configured");
    expect(m.runMorCycle).not.toHaveBeenCalled();
  });
});
