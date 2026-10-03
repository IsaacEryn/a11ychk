import { describe, expect, it } from "vitest";
import type { KwcagMatrixRow } from "@a11ychk/core/catalog";
import { computeCertReadiness } from "@/app/[locale]/scans/[id]/report/certReadiness";
import type { ReviewValue } from "@/app/[locale]/scans/[id]/report/ReviewCell";

const row = (itemId: string, status: KwcagMatrixRow["status"]): KwcagMatrixRow =>
  ({ itemId, status, violationCount: 0, ruleIds: [] }) as KwcagMatrixRow;

describe("computeCertReadiness — 점검자 위반 판정의 항목 준수율", () => {
  it("자동 규칙이 없는 수동 항목의 위반 판정(페이지 범위 없음)은 100%가 아니라 0%", () => {
    const r = computeCertReadiness(
      [row("clear-instructions", "manual")],
      new Map([["clear-instructions", { violatedPages: 0, rate: 100 }]]),
      new Map<string, ReviewValue>([["clear-instructions", { outcome: "failed", note: "" } as ReviewValue]]),
      10,
    );
    expect(r.averageRate).toBe(0);
    expect(r.band).toBe("below");
  });

  it("자동 검사가 위반 페이지를 찾은 항목은 그 비율을 쓴다", () => {
    const r = computeCertReadiness(
      [row("alternative-text", "fail")],
      new Map([["alternative-text", { violatedPages: 2, rate: 80 }]]),
      new Map<string, ReviewValue>([["alternative-text", { outcome: "failed", note: "" } as ReviewValue]]),
      10,
    );
    expect(r.averageRate).toBe(80);
  });

  it("위반 페이지를 지정했으면 그 범위로 계산", () => {
    const r = computeCertReadiness(
      [row("clear-instructions", "manual")],
      new Map([["clear-instructions", { violatedPages: 0, rate: 100 }]]),
      new Map<string, ReviewValue>([["clear-instructions", { outcome: "failed", note: "", pages: ["https://a/1"] } as ReviewValue]]),
      10,
    );
    expect(r.averageRate).toBe(90);
  });

  it("통과 판정은 100%", () => {
    const r = computeCertReadiness(
      [row("clear-instructions", "manual")],
      new Map(),
      new Map<string, ReviewValue>([["clear-instructions", { outcome: "passed", note: "" } as ReviewValue]]),
      10,
    );
    expect(r.averageRate).toBe(100);
  });
});
