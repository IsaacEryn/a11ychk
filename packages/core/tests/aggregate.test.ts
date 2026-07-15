import { describe, expect, it } from "vitest";
import { aggregateScan } from "../src/report/aggregate";
import type { PageScanResult } from "../src/types";

function page(partial: Partial<PageScanResult>): PageScanResult {
  return {
    url: "https://example.com/",
    violations: [],
    passes: [],
    incomplete: [],
    scannedAt: new Date().toISOString(),
    ...partial,
  };
}

describe("aggregateScan", () => {
  it("빈 결과", () => {
    const s = aggregateScan([], "4.10.0");
    expect(s.totalViolations).toBe(0);
    expect(s.complianceRate).toBe(0);
    expect(s.kwcagMatrix).toHaveLength(33);
  });

  it("impact·규칙별 노드 수 집계", () => {
    const s = aggregateScan(
      [
        page({
          violations: [
            {
              ruleId: "image-alt",
              impact: "critical",
              tags: ["wcag2a", "wcag111"],
              helpUrl: "",
              nodes: [
                { selector: "img:nth-child(1)", html: "<img>", failureSummary: "" },
                { selector: "img:nth-child(2)", html: "<img>", failureSummary: "" },
              ],
            },
          ],
          passes: ["html-has-lang", "document-title"],
        }),
      ],
      "4.10.0",
    );
    expect(s.totalViolations).toBe(1);
    expect(s.totalViolationNodes).toBe(2);
    expect(s.byImpact.critical).toBe(2);
    expect(s.byRule["image-alt"]).toBe(2);
    // 통과 2규칙 / 검사 3규칙 = 66.7%
    expect(s.complianceRate).toBeCloseTo(66.7, 1);
  });

  it("한 페이지라도 위반이면 해당 규칙은 위반으로 집계", () => {
    const s = aggregateScan(
      [
        page({ passes: ["image-alt"] }),
        page({
          url: "https://example.com/b",
          violations: [
            {
              ruleId: "image-alt",
              impact: "critical",
              tags: [],
              helpUrl: "",
              nodes: [{ selector: "img", html: "<img>", failureSummary: "" }],
            },
          ],
        }),
      ],
      "4.10.0",
    );
    expect(s.complianceRate).toBe(0);
    const row = s.kwcagMatrix.find((r) => r.itemId === "5.1.1");
    expect(row?.status).toBe("fail");
    expect(row?.violationCount).toBe(1);
    expect(row?.ruleIds).toContain("image-alt");
  });

  it("완전 수동 항목은 manual 상태", () => {
    const s = aggregateScan([page({})], "4.10.0");
    const auth = s.kwcagMatrix.find((r) => r.itemId === "7.4.3"); // 접근 가능한 인증
    expect(auth?.status).toBe("manual");
  });

  it("full 커버 항목이 통과하면 pass 상태", () => {
    const s = aggregateScan([page({ passes: ["html-has-lang"] })], "4.10.0");
    const lang = s.kwcagMatrix.find((r) => r.itemId === "7.1.1");
    expect(lang?.status).toBe("pass");
  });
});

describe("WCAG 2.2 SC 매트릭스 (WCAG-EM)", () => {
  it("AA 목표 시 A+AA 성공기준 전부 포함", () => {
    const s = aggregateScan([], "4.10.0", { conformanceTarget: "AA" });
    expect(s.wcagMatrix.length).toBe(55);
    // 자동 결과가 없으면 전부 notChecked
    expect(s.wcagMatrix.every((r) => r.outcome === "notChecked")).toBe(true);
  });

  it("A 목표 시 A 성공기준만 포함", () => {
    const s = aggregateScan([], "4.10.0", { conformanceTarget: "A" });
    expect(s.wcagMatrix.every((r) => r.scId)).toBe(true);
    expect(s.wcagMatrix.length).toBeLessThan(40);
  });

  it("위반 규칙의 SC는 failed, 통과 규칙의 SC는 passed", () => {
    const s = aggregateScan(
      [
        page({
          violations: [
            {
              ruleId: "color-contrast", // → 1.4.3
              impact: "serious",
              tags: [],
              helpUrl: "",
              nodes: [{ selector: "p", html: "<p>", failureSummary: "" }],
            },
          ],
          passes: ["html-has-lang"], // → 3.1.1
        }),
      ],
      "4.10.0",
      { conformanceTarget: "AA" },
    );
    expect(s.wcagMatrix.find((r) => r.scId === "1.4.3")?.outcome).toBe("failed");
    expect(s.wcagMatrix.find((r) => r.scId === "3.1.1")?.outcome).toBe("passed");
    // 자동 규칙이 없는 SC는 notChecked (수동 필요)
    expect(s.wcagMatrix.find((r) => r.scId === "1.2.2")?.outcome).toBe("notChecked");
  });

  it("incomplete 규칙의 SC는 cannotTell", () => {
    const s = aggregateScan([page({ incomplete: ["color-contrast"] })], "4.10.0", { conformanceTarget: "AA" });
    expect(s.wcagMatrix.find((r) => r.scId === "1.4.3")?.outcome).toBe("cannotTell");
  });

  it("사이트 검사 결과(siteChecks)를 규칙 세트로 편입해 매트릭스에 반영", () => {
    const s = aggregateScan([page({})], "4.10.0", {
      conformanceTarget: "AA",
      siteChecks: [
        { ruleId: "a11ychk:page-title-unique", outcome: "failed", count: 3, nodes: [] }, // → 2.4.2
        { ruleId: "a11ychk:multiple-ways", outcome: "passed", count: 0, nodes: [] }, // → 2.4.5
      ],
    });
    expect(s.wcagMatrix.find((r) => r.scId === "2.4.2")?.outcome).toBe("failed");
    expect(s.wcagMatrix.find((r) => r.scId === "2.4.2")?.violationCount).toBe(3);
    expect(s.wcagMatrix.find((r) => r.scId === "2.4.5")?.outcome).toBe("passed");
  });

  it("자동·수동·통합 세 준수율 계산 (점검자 판정이 통합에서 우선)", () => {
    const s = aggregateScan(
      [
        page({
          violations: [
            { ruleId: "color-contrast", impact: "serious", tags: [], helpUrl: "", nodes: [{ selector: "p", html: "<p>", failureSummary: "" }] }, // 1.4.3 fail
          ],
          passes: ["html-has-lang"], // 3.1.1 pass
        }),
      ],
      "4.10.0",
      {
        conformanceTarget: "AA",
        // 점검자가 1.4.3을 통과로 뒤집고, 자동 미확인 1.2.2를 위반으로 판정
        reviews: { wcag: { "1.4.3": "passed", "1.2.2": "failed" }, kwcag: {} },
      },
    );
    // 자동: 1통과(3.1.1) / 1위반(1.4.3)
    expect(s.scores?.automated.passed).toBe(1);
    expect(s.scores?.automated.failed).toBe(1);
    expect(s.scores?.automated.rate).toBe(50);
    // 수동: 1통과(1.4.3) / 1위반(1.2.2)
    expect(s.scores?.manual.passed).toBe(1);
    expect(s.scores?.manual.failed).toBe(1);
    // 통합: 1.4.3은 점검자 통과로, 1.2.2는 점검자 위반, 3.1.1 자동 통과 → 2통과 1위반
    expect(s.scores?.combined.passed).toBe(2);
    expect(s.scores?.combined.failed).toBe(1);
  });

  it("notPresentScs — 미디어 없으면 1.2.x는 해당 없음, KWCAG 5.2.1은 not-applicable, 자동 점수에 충족으로 반영", () => {
    const s = aggregateScan([page({ passes: ["html-has-lang"] })], "4.10.0", {
      conformanceTarget: "AA",
      notPresentScs: ["1.2.1", "1.2.2", "1.2.3", "1.2.4", "1.2.5"],
    });
    expect(s.wcagMatrix.find((r) => r.scId === "1.2.1")?.outcome).toBe("notPresent");
    expect(s.wcagMatrix.find((r) => r.scId === "1.2.5")?.outcome).toBe("notPresent");
    // 5.2.1(자막 제공)은 1.2.1~1.2.3 대응 → 해당 없음
    expect(s.kwcagMatrix.find((r) => r.itemId === "5.2.1")?.status).toBe("not-applicable");
    // 자동 점수: 3.1.1 통과 + 1.2.x 5건 해당없음 = 6건 충족
    expect(s.scores?.automated.passed).toBe(6);
  });

  it("sample 요약을 전달하면 summary.sample에 포함", () => {
    const s = aggregateScan([], "4.10.0", {
      sample: {
        structuredCount: 5,
        randomCount: 1,
        processCount: 0,
        method: "seeded-random",
        technologies: ["HTML", "CSS"],
        randomSurfacedNewRules: [],
      },
    });
    expect(s.sample?.structuredCount).toBe(5);
    expect(s.sample?.technologies).toContain("HTML");
  });
});
