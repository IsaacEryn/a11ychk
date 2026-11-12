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

  it("KWCAG 대응은 옛 클라이언트용 공식 번호 배열(kwcag)과 새 표기 문자열(kwcagLabel)을 함께 낸다", () => {
    // server-side-image-map은 대체 텍스트(검사항목 1, 5.1.1)와 키보드 사용 보장(검사항목 10, 6.1.1)에 걸린다.
    // 배포 전에 열린 탭은 kwcag.join(", ")을 부르므로 배열이어야 하고, 새 화면은 kwcagLabel을 그대로 보인다.
    const p = page([finding({ ruleId: "server-side-image-map", tags: ["wcag2a", "wcag211"] })]);
    const ko = buildTeaserResult(p, summary(), "ko").rules[0];
    expect(ko.kwcag).toEqual(["5.1.1", "6.1.1"]);
    expect(ko.kwcagLabel).toBe("검사항목 1·10");
    const en = buildTeaserResult(p, summary(), "en").rules[0];
    expect(en.kwcag).toEqual(["5.1.1", "6.1.1"]);
    expect(en.kwcagLabel).toBe("Checkpoints 1, 10");
  });

  it("준수율은 요약에서, 캐시 플래그는 false로 낸다", () => {
    const out = buildTeaserResult(page([]), summary(), "en");
    expect(out.rate).toBe(87.5);
    expect(out.cached).toBe(false);
    expect(out.rules).toHaveLength(0);
    expect(out.ruleCount).toBe(0);
    expect(out.totalNodes).toBe(0);
    expect(out.advisoryCount).toBe(0);
  });

  it("같은 규칙이 프레임마다 따로 와도 한 줄로 합친다", () => {
    // runAxeOnPage는 프레임별 결과를 이어 붙이므로 같은 ruleId가 여러 번 온다
    const p = page([
      finding({ nodes: [{ selector: "img#a", html: "<img id='a'>", failureSummary: "" }] }),
      finding({ ruleId: "label", impact: "critical", tags: ["wcag2a", "wcag412"], nodes: [{ selector: "input", html: "<input>", failureSummary: "" }] }),
      finding({
        nodes: [
          { selector: "iframe >> img#b", html: "<img id='b'>", failureSummary: "" },
          { selector: "iframe >> img#c", html: "<img id='c'>", failureSummary: "" },
        ],
      }),
    ]);
    const out = buildTeaserResult(p, summary(), "ko");
    expect(out.rules.map((r) => r.ruleId)).toEqual(["image-alt", "label"]);
    expect(out.ruleCount).toBe(2);
    expect(out.rules[0].nodeCount).toBe(3);
    expect(out.rules[0].sample?.selector).toBe("img#a");
    expect(out.totalNodes).toBe(4);
    expect(out.byImpact).toEqual({ critical: 4, serious: 0, moderate: 0, minor: 0 });
  });

  it("모범 사례 권고는 목록·규칙 수·요소 수·심각도에서 빼고 개수만 따로 낸다", () => {
    const p = page([
      finding({ ruleId: "region", impact: "moderate", tags: ["cat.keyboard", "best-practice"], nodes: Array.from({ length: 14 }, (_, i) => ({ selector: `div#r${i}`, html: "<div>", failureSummary: "" })) }),
      finding({ ruleId: "color-contrast", impact: "serious", tags: ["wcag2aa", "wcag143"], nodes: [{ selector: "p", html: "<p>", failureSummary: "" }] }),
    ]);
    const s = { ...summary(), bestPractice: [{ ruleId: "region", count: 14 }] } as ScanSummary;
    const out = buildTeaserResult(p, s, "ko");
    expect(out.rules.map((r) => r.ruleId)).toEqual(["color-contrast"]);
    expect(out.ruleCount).toBe(1);
    expect(out.totalNodes).toBe(1);
    expect(out.byImpact).toEqual({ critical: 0, serious: 1, moderate: 0, minor: 0 });
    expect(out.advisoryCount).toBe(1);
    expect(JSON.stringify(out)).not.toContain("div#r0");
  });
});
