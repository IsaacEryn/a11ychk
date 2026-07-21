import { describe, expect, it } from "vitest";
import { summarizeImprovement } from "@/lib/impactStats";

describe("summarizeImprovement — 공적 지표라 과대 집계 금지", () => {
  it("준수율이 오른 사이트만 개선으로 집계한다", () => {
    const r = summarizeImprovement([
      { firstRate: 80, lastRate: 93.6, count: 3 }, // +13.6
      { firstRate: 90, lastRate: 90, count: 2 }, // 변화 없음
      { firstRate: 95, lastRate: 92, count: 2 }, // 하락
    ]);
    expect(r.rescannedSites).toBe(3);
    expect(r.improvedSites).toBe(1);
    expect(r.avgRateGain).toBe(13.6);
  });

  it("1회 검사 사이트는 재검사·개선 어디에도 포함하지 않는다", () => {
    const r = summarizeImprovement([{ firstRate: 50, lastRate: 50, count: 1 }]);
    expect(r.rescannedSites).toBe(0);
    expect(r.improvedSites).toBe(0);
  });

  it("부동소수 잡음(+0.1%p 미만)은 개선으로 치지 않는다", () => {
    // 핵심 회귀 케이스: 예전 로직은 노드 수 감소(표본 축소)만으로 개선 처리했다
    const r = summarizeImprovement([{ firstRate: 90, lastRate: 90.05, count: 2 }]);
    expect(r.improvedSites).toBe(0);
  });

  it("개선 0건이면 평균 상승은 0", () => {
    const r = summarizeImprovement([{ firstRate: 90, lastRate: 89, count: 2 }]);
    expect(r.avgRateGain).toBe(0);
  });
});
