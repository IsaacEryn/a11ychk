import { describe, expect, it } from "vitest";
import type { Finding, PageScanResult, ScanSummary } from "@a11ychk/core/catalog";
import { buildTeaserResult } from "../src/lib/teaser";

function finding(overrides: Partial<Finding>): Finding {
  return {
    ruleId: "image-alt",
    impact: "critical",
    tags: ["wcag2a", "wcag111"],
    helpUrl: "https://example.com/help",
    nodes: [],
    ...overrides,
  };
}

function page(violations: Finding[]): PageScanResult {
  return { url: "https://example.com/", violations, passes: [], incomplete: [], scannedAt: "2026-07-22T00:00:00Z" };
}

function summary(): ScanSummary {
  return {
    pageCount: 1,
    scannedPageCount: 1,
    totalViolations: 2,
    totalViolationNodes: 5,
    byImpact: { critical: 3, serious: 2, moderate: 0, minor: 0 },
    byRule: {},
    kwcagMatrix: [],
    wcagMatrix: [],
    complianceRate: 87.5,
  } as unknown as ScanSummary;
}

describe("buildTeaserResult — 서버측 트리밍·잠금", () => {
  it("노드가 여러 개여도 응답 sample은 규칙당 정확히 1개만 포함한다", () => {
    const p = page([
      finding({
        nodes: [
          { selector: "img#a", html: "<img id='a'>", failureSummary: "alt 없음" },
          { selector: "img#b", html: "<img id='b'>", failureSummary: "alt 없음" },
          { selector: "img#c", html: "<img id='c'>", failureSummary: "alt 없음" },
        ],
      }),
    ]);
    const out = buildTeaserResult(p, summary(), "ko");
    expect(out.rules).toHaveLength(1);
    expect(out.rules[0].nodeCount).toBe(3);
    // 첫 노드 1개만 — 나머지 위치는 응답에 실리지 않는다(클라이언트 우회 불가)
    expect(out.rules[0].sample).toEqual({ selector: "img#a", html: "<img id='a'>" });
    expect(JSON.stringify(out)).not.toContain("img#b");
  });

  it("selector·html은 300자로 절단한다", () => {
    const long = "x".repeat(1000);
    const p = page([finding({ nodes: [{ selector: long, html: long, failureSummary: "" }] })]);
    const out = buildTeaserResult(p, summary(), "ko");
    expect(out.rules[0].sample?.selector).toHaveLength(300);
    expect(out.rules[0].sample?.html).toHaveLength(300);
  });

  it("규칙은 심각도순(critical→minor)으로 정렬한다", () => {
    const p = page([
      finding({ ruleId: "html-has-lang", impact: "minor" }),
      finding({ ruleId: "label", impact: "serious" }),
      finding({ ruleId: "image-alt", impact: "critical" }),
    ]);
    const out = buildTeaserResult(p, summary(), "ko");
    expect(out.rules.map((r) => r.impact)).toEqual(["critical", "serious", "minor"]);
  });

  it("요약 수치·캐시 플래그를 그대로 전달한다", () => {
    const out = buildTeaserResult(page([]), summary(), "en");
    expect(out.rate).toBe(87.5);
    expect(out.byImpact.critical).toBe(3);
    expect(out.totalNodes).toBe(5);
    expect(out.cached).toBe(false);
    expect(out.rules).toHaveLength(0);
  });
});
