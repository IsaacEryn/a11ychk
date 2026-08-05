/**
 * 카탈로그가 실제로 실행되는 axe 규칙을 모두 덮는지, 그리고 덮지 못한 규칙이
 * 들어와도 집계가 적합성 위반을 놓치지 않는지 고정한다.
 *
 * 미등재 규칙은 getRuleEntry의 태그 폴백으로 WCAG를 복원해야 한다. 폴백이 끊기면
 * 실제 위반이 '모범 사례 권고'로 강등되고 해당 성공기준이 통과로 표시된다.
 */
import axe from "axe-core";
import { describe, expect, it } from "vitest";
import { RULE_BY_ID } from "../src/catalog/rules";
import { AXE_RUN_TAGS } from "../src/scanner/normalize";
import { aggregateScan } from "../src/report/aggregate";
import type { PageScanResult } from "../src/types";

/** 이번 검사 태그로 실제 실행되는 axe 규칙 (deprecated·experimental 제외) */
function activeAxeRules(): { id: string; tags: string[] }[] {
  return axe
    .getRules()
    .map((r) => ({ id: r.ruleId, tags: r.tags as string[] }))
    .filter((r) => r.tags.some((t) => AXE_RUN_TAGS.includes(t)))
    .filter((r) => !r.tags.includes("deprecated") && !r.tags.includes("experimental"));
}

describe("axe 규칙 커버리지", () => {
  it("실행되는 axe 규칙은 모두 카탈로그에 있어야 한다", () => {
    const missing = activeAxeRules()
      .map((r) => r.id)
      .filter((id) => !RULE_BY_ID.has(id));
    expect(
      missing,
      `카탈로그 누락 — packages/core/src/catalog/rules.ts에 항목을 추가하고 npm run coverage로 문서를 재생성할 것: ${missing.join(", ")}`,
    ).toEqual([]);
  });
});

describe("미등재 규칙의 태그 폴백", () => {
  const page = (violationRuleId: string, tags: string[]): PageScanResult => ({
    url: "https://example.com/",
    violations: [
      {
        ruleId: violationRuleId,
        impact: "serious",
        tags,
        helpUrl: "",
        nodes: [{ selector: "div", html: "<div></div>", failureSummary: "" }],
      },
    ],
    passes: [],
    incomplete: [],
    scannedAt: new Date().toISOString(),
  });

  it("카탈로그에 없어도 태그의 WCAG 성공기준을 위반으로 계상한다", () => {
    const summary = aggregateScan([page("some-future-rule", ["wcag2a", "wcag412"])], "4.12.1");
    const sc = summary.wcagMatrix?.find((r) => r.scId === "4.1.2");
    expect(sc?.outcome).toBe("failed");
    expect(sc?.violationCount).toBe(1);
    expect(summary.bestPractice ?? []).toEqual([]);
  });

  it("통과한 규칙이 있어도 미등재 위반이 그 성공기준을 통과로 덮지 않는다", () => {
    const withPass: PageScanResult = {
      ...page("some-future-rule", ["wcag2a", "wcag412"]),
      passes: ["aria-tooltip-name"], // 같은 SC(4.1.2)에 매핑된 등재 규칙
    };
    const sc = aggregateScan([withPass], "4.12.1").wcagMatrix?.find((r) => r.scId === "4.1.2");
    expect(sc?.outcome).toBe("failed");
  });

  it("WCAG 태그가 없는 규칙은 그대로 모범 사례 권고로 분리된다", () => {
    const summary = aggregateScan([page("some-bp-rule", ["best-practice"])], "4.12.1");
    expect(summary.bestPractice?.map((b) => b.ruleId)).toEqual(["some-bp-rule"]);
    expect(summary.wcagMatrix?.every((r) => r.outcome !== "failed")).toBe(true);
  });
});
