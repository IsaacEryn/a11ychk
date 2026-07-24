import { describe, expect, it } from "vitest";
import {
  KWCAG_BY_WCAG,
  WCAG_CRITERIA,
  combineOutcomes,
  computeScores,
  deriveKwcagOutcomeFromWcag,
  deriveWcagReviewsFromKwcag,
  getKwcagOnlyManualItems,
  getManualChecksByWcag,
  KWCAG_BY_ID,
  type WcagMatrixRow,
  type WcagOutcome,
} from "../src/catalog-entry";

describe("WCAG 축 역매핑 (KWCAG_BY_WCAG / getManualChecksByWcag)", () => {
  it("다중 출처 SC는 1.3.1 ← {7.3.1, 7.3.2, 7.4.1} 정확히 1건뿐이다", () => {
    const multi = [...KWCAG_BY_WCAG.entries()].filter(([, items]) => items.length > 1);
    expect(multi.map(([sc]) => sc)).toEqual(["1.3.1"]);
    expect(multi[0]![1].map((i) => i.id).sort()).toEqual(["7.3.1", "7.3.2", "7.4.1"]);
  });

  it("파생 체크리스트는 전 항목이 출처·한국어 검사 방법을 갖고 WCAG 순서로 정렬된다", () => {
    const checks = getManualChecksByWcag();
    expect(checks.length).toBeGreaterThanOrEqual(30);
    const order = new Map(WCAG_CRITERIA.map((c, i) => [c.id, i]));
    for (let i = 1; i < checks.length; i++) {
      expect(order.get(checks[i]!.scId)!).toBeGreaterThan(order.get(checks[i - 1]!.scId)!);
    }
    for (const c of checks) {
      expect(c.sources.length).toBeGreaterThanOrEqual(1);
      expect(c.sources.some((s) => s.howToTest?.ko)).toBe(true);
      expect(["A", "AA"]).toContain(c.level);
    }
  });

  it("폐기(4.1.1)·AAA(2.5.5) 참조는 파생 목록에 나타나지 않는다", () => {
    const ids = new Set(getManualChecksByWcag().map((c) => c.scId));
    expect(ids.has("4.1.1")).toBe(false);
    expect(ids.has("2.5.5")).toBe(false);
  });

  it("KWCAG 고유 수동 항목은 5.4.3·6.4.4 두 개다 (8.1.1은 full이라 제외)", () => {
    expect(getKwcagOnlyManualItems().map((i) => i.id).sort()).toEqual(["5.4.3", "6.4.4"]);
  });
});

describe("combineOutcomes — 결합 규칙 (failed > cannotTell > 전원-긍정 > 없음)", () => {
  it("failed가 하나라도 있으면 failed (부분 정보로도 확정)", () => {
    expect(combineOutcomes(["passed", "failed"], false)).toBe("failed");
  });
  it("cannotTell은 failed 다음 우선", () => {
    expect(combineOutcomes(["passed", "cannotTell"], true)).toBe("cannotTell");
  });
  it("전원 판정 + 전부 passed → passed, 전부 notPresent → notPresent", () => {
    expect(combineOutcomes(["passed", "passed"], true)).toBe("passed");
    expect(combineOutcomes(["notPresent", "notPresent"], true)).toBe("notPresent");
    expect(combineOutcomes(["passed", "notPresent"], true)).toBe("passed");
  });
  it("부분적 긍정 판정만으로는 결합하지 않는다 (complete=false)", () => {
    expect(combineOutcomes(["passed"], false)).toBeNull();
  });
  it("notChecked는 판정으로 취급하지 않는다", () => {
    expect(combineOutcomes(["notChecked"], true)).toBeNull();
  });
});

describe("deriveWcagReviewsFromKwcag — kwcag 판정의 SC 팬아웃", () => {
  it("6.1.2 failed → 대응 SC(2.4.3·2.4.7·2.4.11) 전부 failed", () => {
    const derived = deriveWcagReviewsFromKwcag({ "6.1.2": "failed" });
    for (const sc of KWCAG_BY_ID.get("6.1.2")!.wcag) {
      expect(derived[sc]).toBe("failed");
    }
  });

  it("1.3.1은 출처 3개 전원 passed일 때만 passed로 파생된다", () => {
    expect(deriveWcagReviewsFromKwcag({ "7.3.2": "passed" })["1.3.1"]).toBeUndefined();
    const all = deriveWcagReviewsFromKwcag({ "7.3.1": "passed", "7.3.2": "passed", "7.4.1": "passed" });
    expect(all["1.3.1"]).toBe("passed");
    const mixed = deriveWcagReviewsFromKwcag({ "7.3.1": "passed", "7.3.2": "failed" });
    expect(mixed["1.3.1"]).toBe("failed");
  });
});

describe("deriveKwcagOutcomeFromWcag — WCAG 판정의 KWCAG 파생 표시", () => {
  const item612 = KWCAG_BY_ID.get("6.1.2")!;

  it("대응 SC 전원 passed → passed", () => {
    const reviews: Record<string, WcagOutcome> = {};
    for (const sc of item612.wcag) reviews[sc] = "passed";
    expect(deriveKwcagOutcomeFromWcag(item612, reviews)).toBe("passed");
  });

  it("부분 판정만으로는 파생하지 않는다 (1:N 안전장치)", () => {
    expect(deriveKwcagOutcomeFromWcag(item612, { [item612.wcag[0]!]: "passed" })).toBeNull();
  });

  it("failed 하나면 failed", () => {
    expect(deriveKwcagOutcomeFromWcag(item612, { [item612.wcag[0]!]: "failed" })).toBe("failed");
  });

  it("대응 SC 없는 항목(5.4.3)·폐기 참조만 있는 항목(8.1.1)은 항상 null", () => {
    expect(deriveKwcagOutcomeFromWcag(KWCAG_BY_ID.get("5.4.3")!, { "1.1.1": "passed" })).toBeNull();
    expect(deriveKwcagOutcomeFromWcag(KWCAG_BY_ID.get("8.1.1")!, { "4.1.1": "passed" } as never)).toBeNull();
  });
});

describe("computeScores — kwcag 파생 폴백", () => {
  const matrix: WcagMatrixRow[] = [
    { scId: "2.4.3", outcome: "notChecked", violationCount: 0, ruleIds: [] },
    { scId: "2.4.7", outcome: "notChecked", violationCount: 0, ruleIds: [] },
    { scId: "2.4.11", outcome: "notChecked", violationCount: 0, ruleIds: [] },
  ];

  it("kwcag 판정만 있어도 수동·통합 점수에 반영된다", () => {
    const scores = computeScores(matrix, {}, { "6.1.2": "failed" });
    expect(scores.manual.failed).toBe(3);
    expect(scores.combined.failed).toBe(3);
  });

  it("같은 SC에 wcag 직접 판정이 있으면 파생을 무시한다", () => {
    const scores = computeScores(matrix, { "2.4.3": "passed" }, { "6.1.2": "failed" });
    expect(scores.manual.passed).toBe(1); // 2.4.3 = 직접 passed
    expect(scores.manual.failed).toBe(2); // 2.4.7·2.4.11 = 파생 failed
  });

  it("2인자 호출은 기존과 동일하게 동작한다 (하위 호환)", () => {
    const scores = computeScores(matrix, { "2.4.3": "failed" });
    expect(scores.manual.failed).toBe(1);
    expect(scores.manual.passed).toBe(0);
  });
});
