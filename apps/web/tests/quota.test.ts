import { describe, expect, it } from "vitest";
import {
  ASSIGNABLE_PLAN_IDS,
  PLAN_IDS,
  TIERS,
  clampRequestedPages,
  getCustomPages,
  getEarnedPlan,
  getPlan,
  getResets,
} from "../src/lib/quota";

describe("등급 목록", () => {
  it("TIERS와 PLAN_IDS가 같은 등급을 가진다", () => {
    expect(Object.keys(TIERS).sort()).toEqual([...PLAN_IDS].sort());
  });
  it("관리자 배정 목록에는 달성 전용 등급이 없다", () => {
    expect(ASSIGNABLE_PLAN_IDS).not.toContain("plus1");
    expect(ASSIGNABLE_PLAN_IDS).not.toContain("plus2");
    expect(ASSIGNABLE_PLAN_IDS).toContain("free");
    expect(ASSIGNABLE_PLAN_IDS).toContain("plus");
  });
});

describe("getPlan / getCustomPages / getResets / getEarnedPlan", () => {
  it("알 수 없는 요금제는 free로 폴백", () => {
    expect(getPlan({ plan: "vip" })).toBe("free");
    expect(getPlan(null)).toBe("free");
  });
  it("pages override는 1 이상 정수만 인정", () => {
    expect(getCustomPages({ pages: 3 })).toBe(3);
    expect(getCustomPages({ pages: 0 })).toBeUndefined();
    expect(getCustomPages({ pages: 2.5 })).toBeUndefined();
  });
  it("리셋 시각은 ISO 파싱 가능한 값만", () => {
    const iso = new Date().toISOString();
    expect(getResets({ dailyResetAt: iso })).toEqual({ daily: iso });
    expect(getResets({ dailyResetAt: "not-a-date" })).toEqual({});
  });
  it("getEarnedPlan은 plus1/plus2만 인정 (구 plus·임의값은 null)", () => {
    expect(getEarnedPlan("plus1")).toBe("plus1");
    expect(getEarnedPlan("plus2")).toBe("plus2");
    expect(getEarnedPlan("plus")).toBeNull();
    expect(getEarnedPlan("vip")).toBeNull();
    expect(getEarnedPlan(null)).toBeNull();
    expect(getEarnedPlan(undefined)).toBeNull();
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
