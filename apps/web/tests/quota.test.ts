import { describe, expect, it } from "vitest";
import {
  ASSIGNABLE_PLAN_IDS,
  DEFAULT_SCAN_LIMITS,
  DOMAIN_VERIFY_LIMITS,
  EXT_DAILY_LIMITS,
  MAX_PAGES_PER_SCAN,
  PLANS,
  getCustomPages,
  getEarnedPlan,
  getExtDailyLimit,
  getPlan,
  getResets,
  getSampleSize,
  clampRequestedPages,
  getVerifiedDomainLimit,
  resolveLimits,
} from "../src/lib/quota";

describe("resolveLimits — 우선순위: 개별 override > 요금제 > 기본", () => {
  it("override 없음 + 요금제 비활성 → free 기본", () => {
    expect(resolveLimits(null)).toEqual(DEFAULT_SCAN_LIMITS);
    expect(resolveLimits(undefined, false)).toEqual(DEFAULT_SCAN_LIMITS);
  });

  it("요금제 활성 시 배정 요금제 한도 적용", () => {
    expect(resolveLimits({ plan: "pro" }, true)).toEqual({
      daily: PLANS.pro.daily,
      weekly: PLANS.pro.weekly,
      monthly: PLANS.pro.monthly,
    });
  });

  it("요금제 비활성이면 배정 요금제를 무시하고 free", () => {
    expect(resolveLimits({ plan: "enterprise" }, false)).toEqual(DEFAULT_SCAN_LIMITS);
  });

  it("개별 숫자 override는 요금제 활성 여부와 무관하게 항상 우선", () => {
    expect(resolveLimits({ daily: 99 }, false).daily).toBe(99);
    expect(resolveLimits({ plan: "pro", daily: 1 }, true).daily).toBe(1);
    expect(resolveLimits({ plan: "pro", daily: 1 }, true).weekly).toBe(PLANS.pro.weekly);
  });

  it("잘못된 override 값(음수·문자열)은 무시", () => {
    expect(resolveLimits({ daily: -1 }).daily).toBe(DEFAULT_SCAN_LIMITS.daily);
    expect(resolveLimits({ daily: "10" }).daily).toBe(DEFAULT_SCAN_LIMITS.daily);
  });

  it("달성 등급(earned)은 요금제 비활성에도 항상 적용 — plus1 = 5/6/15", () => {
    expect(resolveLimits(null, false, "plus1")).toEqual({ daily: 5, weekly: 6, monthly: 15 });
    expect(resolveLimits(null, false, "plus2")).toEqual({ daily: 5, weekly: 8, monthly: 20 });
  });

  it("배정 등급과 earned는 창별 max로 병합 (pro 활성 + plus1 → pro)", () => {
    expect(resolveLimits({ plan: "pro" }, true, "plus1")).toEqual({
      daily: PLANS.pro.daily,
      weekly: PLANS.pro.weekly,
      monthly: PLANS.pro.monthly,
    });
  });

  it("개별 override는 earned보다도 우선 (0 포함)", () => {
    expect(resolveLimits({ daily: 1 }, false, "plus2").daily).toBe(1);
    expect(resolveLimits({ daily: 0 }, false, "plus2").daily).toBe(0);
    expect(resolveLimits({ daily: 1 }, false, "plus2").weekly).toBe(PLANS.plus2.weekly);
  });

  it("피초대 보너스는 daily에만 +1, daily override가 있으면 미가산", () => {
    expect(resolveLimits(null, false, null, 1)).toEqual({ daily: 4, weekly: 5, monthly: 10 });
    expect(resolveLimits(null, false, "plus1", 1).daily).toBe(6); // earned와 조합
    expect(resolveLimits({ daily: 7 }, false, null, 1).daily).toBe(7); // 관리자 명시값 존중
    expect(resolveLimits(null, false, null, 1).weekly).toBe(DEFAULT_SCAN_LIMITS.weekly);
  });
});

describe("getSampleSize — 표본 크기 정책", () => {
  it("free 기본: 미확인 5p / 소유확인 10p", () => {
    expect(getSampleSize({ override: null, verified: false, plansActive: false })).toBe(5);
    expect(getSampleSize({ override: null, verified: true, plansActive: false })).toBe(10);
  });

  it("pages override는 소유확인 시 2배", () => {
    expect(getSampleSize({ override: { pages: 8 }, verified: false, plansActive: false })).toBe(8);
    expect(getSampleSize({ override: { pages: 8 }, verified: true, plansActive: false })).toBe(16);
  });

  it("모든 경로가 하드 캡(MAX_PAGES_PER_SCAN)으로 클램프", () => {
    expect(getSampleSize({ override: { pages: 100 }, verified: true, plansActive: false })).toBe(MAX_PAGES_PER_SCAN);
    // 2026-07-22 한도 개편으로 모든 요금제 sampleSize(5/10/20)가 캡(30) 이내 — 요금제 값 그대로
    expect(getSampleSize({ override: { plan: "enterprise" }, verified: false, plansActive: true })).toBe(
      PLANS.enterprise.sampleSize,
    );
  });

  it("요금제 활성 시 요금제 sampleSize", () => {
    expect(getSampleSize({ override: { plan: "pro" }, verified: false, plansActive: true })).toBe(
      PLANS.pro.sampleSize,
    );
  });

  it("earned는 max로 병합 — plus2 미확인 8p, free 소유확인 10p vs plus1 5p는 10p 유지", () => {
    expect(getSampleSize({ override: null, verified: false, plansActive: false, earned: "plus2" })).toBe(8);
    expect(getSampleSize({ override: null, verified: true, plansActive: false, earned: "plus1" })).toBe(10);
    // pages override는 earned보다 우선
    expect(getSampleSize({ override: { pages: 3 }, verified: false, plansActive: false, earned: "plus2" })).toBe(3);
  });
});

describe("getPlan / getCustomPages / getExtDailyLimit / getResets", () => {
  it("알 수 없는 요금제는 free로 폴백", () => {
    expect(getPlan({ plan: "vip" })).toBe("free");
    expect(getPlan(null)).toBe("free");
  });

  it("pages override는 1 이상 정수만 인정", () => {
    expect(getCustomPages({ pages: 3 })).toBe(3);
    expect(getCustomPages({ pages: 0 })).toBeUndefined();
    expect(getCustomPages({ pages: 2.5 })).toBeUndefined();
  });

  it("확장 일일 한도 — 등급 기본(무료 10/프로 20/엔터 30), override 0 허용(차단), 음수·비정수는 등급 기본", () => {
    expect(getExtDailyLimit(null)).toBe(EXT_DAILY_LIMITS.free);
    expect(getExtDailyLimit({ plan: "pro" })).toBe(EXT_DAILY_LIMITS.pro);
    expect(getExtDailyLimit({ plan: "enterprise" })).toBe(EXT_DAILY_LIMITS.enterprise);
    expect(getExtDailyLimit({ extDaily: 5 })).toBe(5);
    expect(getExtDailyLimit({ extDaily: 0 })).toBe(0);
    expect(getExtDailyLimit({ extDaily: -3 })).toBe(EXT_DAILY_LIMITS.free);
  });

  it("리셋 시각은 ISO 파싱 가능한 값만", () => {
    const iso = new Date().toISOString();
    expect(getResets({ dailyResetAt: iso })).toEqual({ daily: iso });
    expect(getResets({ dailyResetAt: "not-a-date" })).toEqual({});
  });
});

describe("달성 등급(earned) — getEarnedPlan / 확장·소유확인 한도 병합", () => {
  it("getEarnedPlan은 plus1/plus2만 인정 (구 plus·임의값은 null)", () => {
    expect(getEarnedPlan("plus1")).toBe("plus1");
    expect(getEarnedPlan("plus2")).toBe("plus2");
    expect(getEarnedPlan("plus")).toBeNull();
    expect(getEarnedPlan("vip")).toBeNull();
    expect(getEarnedPlan(null)).toBeNull();
    expect(getEarnedPlan(undefined)).toBeNull();
  });

  it("관리자 배정 목록에는 달성 전용 등급이 없다", () => {
    expect(ASSIGNABLE_PLAN_IDS).not.toContain("plus1");
    expect(ASSIGNABLE_PLAN_IDS).not.toContain("plus2");
    expect(ASSIGNABLE_PLAN_IDS).toContain("free");
    expect(ASSIGNABLE_PLAN_IDS).toContain("plus");
  });

  it("확장 일일 한도 — earned와 배정 중 max, 개별 override 우선", () => {
    expect(getExtDailyLimit(null, "plus1")).toBe(EXT_DAILY_LIMITS.plus1);
    expect(getExtDailyLimit({ plan: "enterprise" }, "plus1")).toBe(EXT_DAILY_LIMITS.enterprise);
    expect(getExtDailyLimit({ extDaily: 5 }, "plus2")).toBe(5);
  });

  it("소유확인 도메인 수 — earned=plus2면 2, 배정이 더 크면 배정", () => {
    expect(getVerifiedDomainLimit(null)).toBe(DOMAIN_VERIFY_LIMITS.free);
    expect(getVerifiedDomainLimit(null, "plus2")).toBe(2);
    expect(getVerifiedDomainLimit({ plan: "enterprise" }, "plus2")).toBe(DOMAIN_VERIFY_LIMITS.enterprise);
    expect(getVerifiedDomainLimit({ verifiedDomains: 1 }, "plus2")).toBe(1);
  });
});

describe("clampRequestedPages — 자동 수집 페이지 수 클램프", () => {
  it("미지정이면 한도 최대", () => {
    expect(clampRequestedPages(10)).toBe(10);
    expect(clampRequestedPages(10, undefined)).toBe(10);
  });

  it("한도 내 값은 그대로, 초과는 한도로, 1 미만은 1로", () => {
    expect(clampRequestedPages(10, 3)).toBe(3);
    expect(clampRequestedPages(10, 15)).toBe(10);
    expect(clampRequestedPages(10, 0)).toBe(1);
    expect(clampRequestedPages(10, -5)).toBe(1);
  });

  it("소수·비정상 값 방어", () => {
    expect(clampRequestedPages(10, 3.9)).toBe(3);
    expect(clampRequestedPages(10, Number.NaN)).toBe(10);
    expect(clampRequestedPages(10, Number.POSITIVE_INFINITY)).toBe(10);
  });
});
