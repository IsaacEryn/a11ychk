import { describe, expect, it } from "vitest";
import {
  DEFAULT_SCAN_LIMITS,
  EXT_DAILY_DEFAULT,
  MAX_PAGES_PER_SCAN,
  PLANS,
  getCustomPages,
  getExtDailyLimit,
  getPlan,
  getResets,
  getSampleSize,
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

  it("확장 일일 한도 override — 0 허용(차단), 음수·비정수는 기본값", () => {
    expect(getExtDailyLimit(null)).toBe(EXT_DAILY_DEFAULT);
    expect(getExtDailyLimit({ extDaily: 5 })).toBe(5);
    expect(getExtDailyLimit({ extDaily: 0 })).toBe(0);
    expect(getExtDailyLimit({ extDaily: -3 })).toBe(EXT_DAILY_DEFAULT);
  });

  it("리셋 시각은 ISO 파싱 가능한 값만", () => {
    const iso = new Date().toISOString();
    expect(getResets({ dailyResetAt: iso })).toEqual({ daily: iso });
    expect(getResets({ dailyResetAt: "not-a-date" })).toEqual({});
  });
});
