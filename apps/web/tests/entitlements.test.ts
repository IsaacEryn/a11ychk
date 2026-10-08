import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { MAX_PAGES_PER_SCAN, PLAN_IDS, TIERS, TIER_LIMIT_KEYS, getCustomInt } from "../src/lib/quota";
import { loadEntitlement, resolveEntitlement, sampleFor } from "../src/lib/entitlements";

const PAST = "2020-01-01T23:59:59+09:00";

describe("TIERS 불변식", () => {
  it("TIER_LIMIT_KEYS가 TierLimits의 모든 필드를 담는다 — 빠지면 그 필드는 근거 병합에서 조용히 free에 머문다", () => {
    expect([...TIER_LIMIT_KEYS].sort()).toEqual(Object.keys(TIERS.free).sort());
  });
  it("모든 등급의 모든 한도는 free 이상이다", () => {
    for (const id of PLAN_IDS) {
      for (const k of TIER_LIMIT_KEYS) expect(TIERS[id][k], `${id}.${k}`).toBeGreaterThanOrEqual(TIERS.free[k]);
    }
  });
  it("소유 확인 표본은 미확인 표본 이상이고 상한을 넘지 않는다", () => {
    for (const id of PLAN_IDS) {
      expect(TIERS[id].sampleVerified).toBeGreaterThanOrEqual(TIERS[id].sampleUnverified);
      expect(TIERS[id].sampleVerified).toBeLessThanOrEqual(MAX_PAGES_PER_SCAN);
    }
  });
});

describe("resolveEntitlement — 수치 개별값이 없으면 free 아래로 내려가지 않는다", () => {
  const overrides = [undefined, {}, { plan: "free" }, { plan: "pro" }, { plan: "pro", until: PAST }, { dailyResetAt: "2026-01-01T00:00:00Z" }];
  const earneds = [undefined, "plus1", "plus2", "plus", "vip"];
  const bonuses = [undefined, 0, 1];
  for (const o of overrides) for (const e of earneds) for (const b of bonuses) {
    it(`${JSON.stringify(o)} / ${e} / ${b}`, () => {
      const { limits } = resolveEntitlement({ scan_limit_override: o, earned_plan: e, referral_daily_bonus: b });
      for (const k of TIER_LIMIT_KEYS) expect(limits[k]).toBeGreaterThanOrEqual(TIERS.free[k]);
    });
  }
});

describe("resolveEntitlement — 표시 등급과 근거", () => {
  it("아무 근거도 없으면 free", () => {
    const e = resolveEntitlement(null);
    expect(e.tier).toBe("free");
    expect(e.source).toBe("free");
    expect(e.grants).toEqual([{ tier: "free", source: "free" }]);
  });
  it("초대 등급", () => {
    expect(resolveEntitlement({ earned_plan: "plus2" })).toMatchObject({ tier: "plus2", source: "earned" });
  });
  it("서열이 같으면 초대 등급을 표시한다(기존 동작)", () => {
    expect(resolveEntitlement({ scan_limit_override: { plan: "plus" }, earned_plan: "plus2" })).toMatchObject({
      tier: "plus2",
      source: "earned",
    });
  });
  it("관리자 배정이 더 높으면 배정 등급", () => {
    expect(resolveEntitlement({ scan_limit_override: { plan: "pro" }, earned_plan: "plus2" })).toMatchObject({
      tier: "pro",
      source: "admin",
    });
  });
  it("기한 지난 배정은 근거에서 빠진다", () => {
    const e = resolveEntitlement({ scan_limit_override: { plan: "pro", until: PAST } });
    expect(e.grants).toEqual([{ tier: "free", source: "free" }]);
  });
  it("근거 목록 순서는 free → 초대 → 관리자", () => {
    expect(resolveEntitlement({ scan_limit_override: { plan: "pro" }, earned_plan: "plus1" }).grants).toEqual([
      { tier: "free", source: "free" },
      { tier: "plus1", source: "earned" },
      { tier: "pro", source: "admin" },
    ]);
  });
  it("한도 초기화 시각을 넘겨준다", () => {
    const iso = "2026-01-01T00:00:00Z";
    expect(resolveEntitlement({ scan_limit_override: { dailyResetAt: iso } }).resets).toEqual({ daily: iso });
  });
});

describe("sampleFor", () => {
  it("소유 확인 여부로 표본을 고른다", () => {
    const e = resolveEntitlement(null);
    expect(sampleFor(e, false)).toBe(5);
    expect(sampleFor(e, true)).toBe(10);
  });
});

describe("getCustomInt", () => {
  it("0 이상 정수만 인정하고 기한이 지나면 무시한다", () => {
    expect(getCustomInt({ extDaily: 0 }, "extDaily")).toBe(0);
    expect(getCustomInt({ extDaily: 2.5 }, "extDaily")).toBeUndefined();
    expect(getCustomInt({ extDaily: -1 }, "extDaily")).toBeUndefined();
    expect(getCustomInt({ verifiedDomains: 4, until: PAST }, "verifiedDomains")).toBeUndefined();
  });
});

describe("loadEntitlement", () => {
  function stub(data: unknown) {
    const maybeSingle = vi.fn().mockResolvedValue({ data, error: null });
    const eq = vi.fn().mockReturnValue({ maybeSingle });
    const select = vi.fn().mockReturnValue({ eq });
    const from = vi.fn().mockReturnValue({ select });
    return { db: { from } as unknown as SupabaseClient, from, select, eq };
  }
  it("profiles에서 한도 관련 열만 읽어 계산한다", async () => {
    const s = stub({ scan_limit_override: null, earned_plan: "plus1", referral_daily_bonus: 0 });
    const e = await loadEntitlement(s.db, "u1");
    expect(s.from).toHaveBeenCalledWith("profiles");
    expect(s.select).toHaveBeenCalledWith("scan_limit_override, earned_plan, referral_daily_bonus");
    expect(s.eq).toHaveBeenCalledWith("id", "u1");
    expect(e.tier).toBe("plus1");
  });
  it("행이 없으면 free", async () => {
    expect((await loadEntitlement(stub(null).db, "u1")).tier).toBe("free");
  });
});
