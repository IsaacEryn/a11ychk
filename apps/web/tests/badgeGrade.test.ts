import { describe, expect, it } from "vitest";
import { gradeOf, gradeColor, DIRECTORY_MIN_RATE } from "../src/lib/badgeGrade";

describe("badgeGrade — 배지·디렉터리·보고서 공통 밴딩", () => {
  it("준수율 경계에서 등급을 올바르게 나눈다", () => {
    expect(gradeOf(100)).toBe("good");
    expect(gradeOf(90)).toBe("good");
    expect(gradeOf(89.9)).toBe("fair");
    expect(gradeOf(75)).toBe("fair");
    expect(gradeOf(74.9)).toBe("poor");
    expect(gradeOf(0)).toBe("poor");
  });

  it("각 등급에 고정 색상을 반환한다", () => {
    expect(gradeColor("good")).toMatch(/^#[0-9a-f]{6}$/);
    expect(gradeColor("fair")).toMatch(/^#[0-9a-f]{6}$/);
    expect(gradeColor("poor")).toMatch(/^#[0-9a-f]{6}$/);
    // 등급별로 색이 달라야 함
    expect(new Set(["good", "fair", "poor"].map((g) => gradeColor(g as never))).size).toBe(3);
  });

  it("디렉터리 최소 준수율은 fair 하한 이상으로 보수적이다", () => {
    // 저품질 사이트를 공개 목록에 노출하지 않도록 poor 등급은 등재 임계 미만
    expect(DIRECTORY_MIN_RATE).toBeGreaterThanOrEqual(75);
    expect(gradeOf(DIRECTORY_MIN_RATE)).not.toBe("poor");
  });
});
