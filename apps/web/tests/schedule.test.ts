import { describe, expect, it } from "vitest";
import { FREQUENCY_HOURS, dueIntervalHours } from "@/lib/scan/schedule";

describe("dueIntervalHours — 정기 검사 주기 간격", () => {
  it("주기별 간격은 주기보다 약간 짧다 (드리프트로 하루씩 밀림 방지)", () => {
    expect(dueIntervalHours("daily")).toBe(20);
    expect(dueIntervalHours("weekly")).toBe(6.5 * 24);
    expect(dueIntervalHours("monthly")).toBe(27 * 24);
    expect(dueIntervalHours("weekly")).toBeLessThan(7 * 24);
    expect(dueIntervalHours("monthly")).toBeLessThan(30 * 24);
  });

  it("미지정·알 수 없는 값은 daily로 폴백 (0021 미적용 행 방어)", () => {
    expect(dueIntervalHours(undefined)).toBe(FREQUENCY_HOURS.daily);
    expect(dueIntervalHours(null)).toBe(FREQUENCY_HOURS.daily);
    expect(dueIntervalHours("hourly")).toBe(FREQUENCY_HOURS.daily);
    expect(dueIntervalHours(42)).toBe(FREQUENCY_HOURS.daily);
  });
});
