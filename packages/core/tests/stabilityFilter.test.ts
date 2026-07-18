import { describe, expect, it } from "vitest";
import { filterStableViolations } from "../src/scanner/runAxe";
import type { AxeRunResults } from "../src/scanner/normalize";

function violation(
  id: string,
  targets: string[][],
): AxeRunResults["violations"][number] {
  return {
    id,
    impact: "serious",
    tags: ["wcag2aa"],
    helpUrl: `https://dequeuniversity.com/rules/axe/${id}`,
    nodes: targets.map((target) => ({ target, html: "<div>x</div>", failureSummary: "f" })),
  };
}

function results(violations: AxeRunResults["violations"]): AxeRunResults {
  return { violations, passes: [], incomplete: [] };
}

describe("filterStableViolations (2-패스 안정성 필터)", () => {
  it("두 패스 모두 검출된 노드만 위반으로 유지한다", () => {
    const first = results([violation("color-contrast", [["#a"], ["#b"], ["#c"]])]);
    const confirm = results([violation("color-contrast", [["#a"], ["#c"]])]);
    const { violations, demotedRuleIds } = filterStableViolations(first, confirm);
    expect(violations).toHaveLength(1);
    expect(violations[0]!.nodes.map((n) => n.target)).toEqual([["#a"], ["#c"]]);
    expect(demotedRuleIds).toEqual([]);
  });

  it("확정 패스에서 규칙 전체가 사라지면 위반이 아니라 강등 목록에 넣는다", () => {
    const first = results([
      violation("color-contrast", [["#fade-in"]]),
      violation("image-alt", [["#img"]]),
    ]);
    const confirm = results([violation("image-alt", [["#img"]])]);
    const { violations, demotedRuleIds } = filterStableViolations(first, confirm);
    expect(violations.map((v) => v.id)).toEqual(["image-alt"]);
    expect(demotedRuleIds).toEqual(["color-contrast"]);
  });

  it("확정 패스에만 새로 나타난 노드는 채택하지 않는다 (1차가 기준)", () => {
    const first = results([violation("color-contrast", [["#a"]])]);
    const confirm = results([violation("color-contrast", [["#a"], ["#new"]])]);
    const { violations } = filterStableViolations(first, confirm);
    expect(violations[0]!.nodes.map((n) => n.target)).toEqual([["#a"]]);
  });

  it("같은 선택자라도 규칙이 다르면 별개로 판정한다", () => {
    const first = results([
      violation("color-contrast", [["#a"]]),
      violation("link-name", [["#a"]]),
    ]);
    const confirm = results([violation("link-name", [["#a"]])]);
    const { violations, demotedRuleIds } = filterStableViolations(first, confirm);
    expect(violations.map((v) => v.id)).toEqual(["link-name"]);
    expect(demotedRuleIds).toEqual(["color-contrast"]);
  });

  it("iframe 다중 선택자(target 배열)도 정확히 대조한다", () => {
    const first = results([violation("image-alt", [["iframe#f", "#img"]])]);
    const confirmSame = results([violation("image-alt", [["iframe#f", "#img"]])]);
    const confirmOther = results([violation("image-alt", [["iframe#g", "#img"]])]);
    expect(filterStableViolations(first, confirmSame).violations).toHaveLength(1);
    expect(filterStableViolations(first, confirmOther).demotedRuleIds).toEqual(["image-alt"]);
  });

  it("안정 위반의 노드·메타데이터는 그대로 보존한다", () => {
    const first = results([violation("color-contrast", [["#a"]])]);
    const { violations } = filterStableViolations(first, first);
    expect(violations[0]!).toEqual(first.violations[0]!);
  });
});
