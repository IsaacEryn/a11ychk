import { describe, expect, it } from "vitest";
import { getPlan, getResets, isOverrideExpired, getCustomPages, TIERS } from "../src/lib/quota";
import { resolveEntitlement } from "../src/lib/entitlements";

const past = "2020-01-01T23:59:59+09:00";
const future = "2999-01-01T23:59:59+09:00";
const grant = { plan: "pro", daily: 99, pages: 20, dailyResetAt: "2026-01-01T00:00:00Z" };

describe("scan_limit_override.until — 한시 배정 만료", () => {
  it("기한 전에는 배정이 그대로 적용된다", () => {
    const o = { ...grant, until: future };
    expect(isOverrideExpired(o)).toBe(false);
    expect(getPlan(o)).toBe("pro");
    expect(resolveEntitlement({ scan_limit_override: o }).limits.daily).toBe(99);
    expect(getCustomPages(o)).toBe(20);
  });

  it("기한이 지나면 요금제·개별 숫자는 무시되고 무료 기본값으로 돌아간다", () => {
    const o = { ...grant, until: past };
    expect(isOverrideExpired(o)).toBe(true);
    expect(getPlan(o)).toBe("free");
    expect(resolveEntitlement({ scan_limit_override: o }).limits.daily).toBe(TIERS.free.daily);
    expect(getCustomPages(o)).toBeUndefined();
  });

  it("만료돼도 한도 초기화 시각(*ResetAt)은 유지된다 — 배정이 아니라 집계 기준", () => {
    expect(getResets({ ...grant, until: past }).daily).toBe("2026-01-01T00:00:00Z");
  });

  it("until이 없거나 형식이 깨지면 무기한으로 본다", () => {
    expect(isOverrideExpired(grant)).toBe(false);
    expect(isOverrideExpired({ ...grant, until: "언젠가" })).toBe(false);
    expect(getPlan({ ...grant, until: "언젠가" })).toBe("pro");
  });
});
