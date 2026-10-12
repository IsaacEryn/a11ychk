import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

const m = vi.hoisted(() => ({ logAppError: vi.fn() }));
vi.mock("@/lib/logs", () => ({ logAppError: m.logAppError }));
// 기록 제한(1분에 한 번)은 이 테스트의 관심이 아니다
vi.mock("@/lib/billing/logThrottle", () => ({ shouldLog: () => true }));

import { pricingChannel } from "../src/lib/billing/price";
import { loadShownPrices } from "../src/lib/billing/shownPrices";

type Call = [string, ...unknown[]];

/** supabase-js 쿼리 빌더 대역 — 호출을 기록하고, await하면 result를 돌려준다 */
function fakeAdmin(result: { data?: unknown; error?: { code?: string; message: string } | null }) {
  const calls: Call[] = [];
  const b: Record<string, unknown> = {};
  for (const name of ["select", "eq", "in", "not"]) {
    b[name] = (...args: unknown[]) => {
      calls.push([name, ...args]);
      return b;
    };
  }
  b.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => Promise.resolve({ error: null, ...result }).then(res, rej);
  const admin = {
    from: (table: string) => {
      calls.push(["from", table]);
      return b;
    },
  } as unknown as SupabaseClient;
  return { admin, calls };
}

const row = (interval: "month" | "year", over: Record<string, unknown> = {}) => ({
  id: `${interval}-id`,
  plan_code: "pro",
  interval,
  amount: 1234,
  currency: "USD",
  ...over,
});

beforeEach(() => {
  m.logAppError.mockReset();
});

describe("loadShownPrices — 요금제에 진열할 가격", () => {
  it("영어(Polar): mor·USD·지금 모드·활성·셀프서비스 플랜, Polar 상품 id가 있는 행만", async () => {
    const { admin, calls } = fakeAdmin({ data: [] });
    await loadShownPrices(admin, true, pricingChannel("en"));
    expect(calls).toEqual([
      ["from", "billing_prices"],
      ["select", "id, plan_code, interval, amount, currency"],
      ["eq", "provider", "mor"],
      ["eq", "currency", "USD"],
      ["eq", "livemode", true],
      ["eq", "active", true],
      ["in", "plan_code", ["pro", "enterprise"]],
      ["not", "external_price_id", "is", null],
    ]);
  });

  it("한국어(토스): toss·KRW — 외부 id 조건은 걸지 않는다", async () => {
    const { admin, calls } = fakeAdmin({ data: [] });
    await loadShownPrices(admin, false, pricingChannel("ko"));
    expect(calls).toContainEqual(["eq", "provider", "toss"]);
    expect(calls).toContainEqual(["eq", "currency", "KRW"]);
    expect(calls).toContainEqual(["eq", "livemode", false]);
    expect(calls.some(([name]) => name === "not")).toBe(false);
  });

  it("월간을 연간보다 먼저", async () => {
    const { admin } = fakeAdmin({ data: [row("year"), row("month")] });
    expect((await loadShownPrices(admin, true, pricingChannel("en"))).map((p) => p.interval)).toEqual(["month", "year"]);
  });

  it("테이블이 없으면 조용히 가격 없음, 그 밖의 오류는 기록하고 가격 없음", async () => {
    const missing = fakeAdmin({ data: null, error: { code: "42P01", message: "no table" } });
    expect(await loadShownPrices(missing.admin, true, pricingChannel("en"))).toEqual([]);
    expect(m.logAppError).not.toHaveBeenCalled();

    const broken = fakeAdmin({ data: null, error: { code: "XX000", message: "boom" } });
    expect(await loadShownPrices(broken.admin, true, pricingChannel("en"))).toEqual([]);
    expect(m.logAppError).toHaveBeenCalledExactlyOnceWith(broken.admin, "pricing price lookup failed: boom", { path: "pricing" });
  });
});
