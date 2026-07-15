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
