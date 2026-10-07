import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { MAX_PAGES_PER_SCAN, PLAN_IDS, TIERS, TIER_LIMIT_KEYS, getCustomInt } from "../src/lib/quota";
import {
  isSubscriptionEntitled,
  loadEntitlement,
  loadSubscriptionGrants,
  RENEWAL_GRACE_MS,
  resolveEntitlement,
  sampleFor,
  type SubscriptionGrantRow,
} from "../src/lib/entitlements";

// 로더의 오류 기록이 service role 클라이언트를 만들지 않게 한다
const { logAppError } = vi.hoisted(() => ({ logAppError: vi.fn() }));
vi.mock("@/lib/logs", () => ({ logAppError }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));

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

const NOW = Date.parse("2026-06-15T03:00:00Z");
const sub = (over: Partial<SubscriptionGrantRow> = {}): SubscriptionGrantRow => ({
  plan_code: "pro",
  provider: "toss",
  status: "active",
  current_period_start: "2026-06-01T00:00:00+09:00",
  current_period_end: "2026-07-01T00:00:00+09:00",
  grace_until: null,
  cancel_at_period_end: false,
  ...over,
});

describe("isSubscriptionEntitled — 상태가 아니라 시각으로 판정", () => {
  const end = Date.parse("2026-07-01T00:00:00+09:00");
  it("기간 안의 active는 유효", () => {
    expect(isSubscriptionEntitled(sub(), NOW)).toBe(true);
  });
  it("카드·해외 결제는 기간이 끝나도 48시간 여유를 준다(갱신 크론 지연 대비)", () => {
    expect(isSubscriptionEntitled(sub(), end + RENEWAL_GRACE_MS - 1)).toBe(true);
    expect(isSubscriptionEntitled(sub(), end + RENEWAL_GRACE_MS)).toBe(false);
  });
  it("해지 예약·기관 계약은 기간 끝까지만", () => {
    expect(isSubscriptionEntitled(sub({ cancel_at_period_end: true }), end - 1)).toBe(true);
    expect(isSubscriptionEntitled(sub({ cancel_at_period_end: true }), end)).toBe(false);
    expect(isSubscriptionEntitled(sub({ provider: "manual" }), end - 1)).toBe(true);
    expect(isSubscriptionEntitled(sub({ provider: "manual" }), end)).toBe(false);
  });
  it("시작 전이면 무효(미래 시작 기관 계약)", () => {
    expect(isSubscriptionEntitled(sub({ provider: "manual", current_period_start: "2026-07-01T00:00:00+09:00", current_period_end: "2027-06-30T23:59:59+09:00" }), NOW)).toBe(false);
  });
  it("미납은 유예 기한까지, 유예가 없으면 무효", () => {
    expect(isSubscriptionEntitled(sub({ status: "past_due", grace_until: "2026-06-20T00:00:00Z" }), NOW)).toBe(true);
    expect(isSubscriptionEntitled(sub({ status: "past_due", grace_until: "2026-06-10T00:00:00Z" }), NOW)).toBe(false);
    expect(isSubscriptionEntitled(sub({ status: "past_due", grace_until: null }), NOW)).toBe(false);
  });
  it("종료·깨진 날짜는 무효", () => {
    expect(isSubscriptionEntitled(sub({ status: "ended" }), NOW)).toBe(false);
    expect(isSubscriptionEntitled(sub({ current_period_end: "언젠가" }), NOW)).toBe(false);
  });
});

describe("resolveEntitlement — 구독·기관 계약 근거", () => {
  it("기관 계약은 contract 근거로 들어가고 종료 시각을 함께 준다", () => {
    const e = resolveEntitlement(null, [sub({ provider: "manual", current_period_end: "2027-03-31T23:59:59+09:00" })], NOW);
    expect(e).toMatchObject({ tier: "pro", source: "contract", until: "2027-03-31T23:59:59+09:00" });
    expect(e.limits).toEqual(TIERS.pro);
  });
  it("카드 구독은 subscription 근거", () => {
    expect(resolveEntitlement(null, [sub()], NOW)).toMatchObject({ tier: "pro", source: "subscription" });
  });
  it("관리자 배정보다 높은 구독이 표시 등급이 된다", () => {
    const e = resolveEntitlement({ scan_limit_override: { plan: "pro" } }, [sub({ plan_code: "enterprise" })], NOW);
    expect(e).toMatchObject({ tier: "enterprise", source: "subscription" });
  });
  it("서열이 같으면 구독이 관리자 배정보다 먼저 보인다", () => {
    expect(resolveEntitlement({ scan_limit_override: { plan: "pro" } }, [sub()], NOW).source).toBe("subscription");
  });
  it("무효 구독·모르는 등급은 근거에서 빠진다", () => {
    expect(resolveEntitlement(null, [sub({ status: "ended" }), sub({ plan_code: "vip" })], NOW).grants).toEqual([
      { tier: "free", source: "free" },
    ]);
  });
  it("구독 근거가 없으면 until도 없다", () => {
    expect(resolveEntitlement({ earned_plan: "plus1" }).until).toBeUndefined();
  });
});

describe("loadEntitlement / loadSubscriptionGrants", () => {
  /** 테이블별 응답을 주입하는 스텁 — 호출을 기록한다 */
  function stub(opts: {
    profile?: unknown;
    profileError?: { message: string };
    subs?: unknown[];
    subsError?: { code?: string; message: string };
  }) {
    const calls: [string, string, unknown[]][] = [];
    const db = {
      from(table: string) {
        const result =
          table === "profiles"
            ? { data: opts.profile ?? null, error: opts.profileError ?? null }
            : { data: opts.subsError ? null : (opts.subs ?? []), error: opts.subsError ?? null };
        const builder: Record<string, unknown> = {};
        for (const m of ["select", "eq", "in"]) {
          builder[m] = (...args: unknown[]) => {
            calls.push([table, m, args]);
            return builder;
          };
        }
        builder.maybeSingle = () => Promise.resolve(result);
        builder.then = (resolve: (v: unknown) => unknown) => Promise.resolve(result).then(resolve);
        return builder;
      },
    } as unknown as SupabaseClient;
    return { db, calls };
  }

  beforeEach(() => logAppError.mockClear());

  it("프로필과 진행 중 실결제 구독을 함께 읽는다", async () => {
    const s = stub({
      profile: { scan_limit_override: null, earned_plan: "plus1", referral_daily_bonus: 0 },
      subs: [{ user_id: "u1", ...sub({ provider: "manual", current_period_start: "2020-01-01T00:00:00+09:00", current_period_end: "2999-01-01T23:59:59+09:00" }) }],
    });
    const e = await loadEntitlement(s.db, "u1");
    expect(s.calls).toContainEqual(["profiles", "select", ["scan_limit_override, earned_plan, referral_daily_bonus"]]);
    expect(s.calls).toContainEqual(["subscriptions", "in", ["user_id", ["u1"]]]);
    expect(s.calls).toContainEqual(["subscriptions", "in", ["status", ["active", "past_due"]]]);
    expect(s.calls).toContainEqual(["subscriptions", "in", ["livemode", [true]]]);
    expect(e).toMatchObject({ tier: "pro", source: "contract" });
  });

  it("프로필이 없으면 free", async () => {
    expect((await loadEntitlement(stub({}).db, "u1")).tier).toBe("free");
  });

  it("구독 테이블이 없으면(0041 미적용) 조용히 구독 없음", async () => {
    const e = await loadEntitlement(stub({ subsError: { code: "PGRST205", message: "missing" } }).db, "u1");
    expect(e.tier).toBe("free");
    expect(logAppError).not.toHaveBeenCalled();
  });

  it("그 밖의 조회 오류는 free로 계산하고 기록한다", async () => {
    const e = await loadEntitlement(
      stub({ profileError: { message: "boom" }, subsError: { code: "08006", message: "conn" } }).db,
      "u1",
    );
    expect(e.tier).toBe("free");
    expect(logAppError).toHaveBeenCalledTimes(2);
  });

  it("여러 사용자의 구독을 사용자별로 묶는다", async () => {
    const s = stub({ subs: [{ user_id: "a", ...sub() }, { user_id: "b", ...sub({ plan_code: "enterprise" }) }, { user_id: "a", ...sub({ status: "past_due" }) }] });
    const map = await loadSubscriptionGrants(s.db, ["a", "b"]);
    expect(map.get("a")).toHaveLength(2);
    expect(map.get("b")?.[0].plan_code).toBe("enterprise");
  });

  it("빈 목록이면 조회하지 않는다", async () => {
    const s = stub({});
    expect((await loadSubscriptionGrants(s.db, [])).size).toBe(0);
    expect(s.calls).toHaveLength(0);
  });
});
