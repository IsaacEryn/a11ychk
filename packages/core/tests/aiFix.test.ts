import { describe, expect, it } from "vitest";
import { buildAiFix, groupViolationsForAiFix, type AiFixInput } from "../src/report/aiFix";
import type { PageScanResult } from "../src/types";

/**
 * 이 문서는 웹 API·MCP가 함께 만드는 공개 산출물이라, 의도치 않은 표현 변화가
 * 곧 사용자 눈에 띈다. 대표 입력의 출력을 문자열로 고정해 회귀를 잡는다.
 * (웹 라우트에서 이관할 때 기존 인라인 구현과 줄 단위로 동일함을 기준으로 작성)
 */

const INPUT: AiFixInput = {
  site: "https://example.com/",
  scannedAt: "2026-07-30T00:00:00.000Z",
  axeVersion: "4.12.1",
  complianceRate: 87.5,
  totalViolationNodes: 3,
  lang: "ko",
  groups: [
    {
      // 심각도 낮은 그룹을 앞에 둬서 빌더 정렬을 함께 검증
      ruleId: "label",
      impact: "moderate",
      tags: ["wcag2a", "wcag412"],
      helpUrl: null,
      nodes: [{ pageUrl: "https://example.com/form", selector: "#q", html: '<input name="q">', failureSummary: null }],
    },
    {
      ruleId: "image-alt",
      impact: "critical",
      tags: ["wcag2a", "wcag111"],
      helpUrl: "https://help.example/image-alt",
      nodes: [
        { pageUrl: "https://example.com/", selector: "img.hero", html: '<img src="a.png">', failureSummary: "images must have alternate text" },
        { pageUrl: "https://example.com/about", selector: "img.logo", html: '<img\n  src="b.png">', failureSummary: null },
      ],
    },
  ],
  failedReviews: [
    { standard: "kwcag", itemId: "5.2.1", note: "자막 없음", pages: ["https://example.com/video"] },
    { standard: "wcag", itemId: "9.9.9", note: "", pages: [] },
  ],
};

describe("buildAiFix", () => {
  const { markdown, json } = buildAiFix(INPUT);

  it("JSON: 메타·심각도순 정렬·노드 캡 구조", () => {
    const j = json as {
      meta: Record<string, unknown>;
      violations: { ruleId: string; totalNodes: number; kwcag: string[]; nodes: unknown[] }[];
      failedReviews: { name: string; itemId: string }[];
      instructions: string;
    };
    expect(j.meta).toMatchObject({
      tool: "A11y Check (a11ychk.com)",
      site: "https://example.com/",
      standard: "WCAG 2.2 AA + KWCAG 2.2",
      engine: "axe-core v4.12.1 + a11ychk rules",
      complianceRate: 87.5,
      totalViolationNodes: 3,
    });
    // critical(image-alt)이 moderate(label)보다 앞
    expect(j.violations.map((v) => v.ruleId)).toEqual(["image-alt", "label"]);
    expect(j.violations[0]!.kwcag).toContain("5.1.1");
    expect(j.violations[0]!.totalNodes).toBe(2);
    expect(j.instructions).toContain("웹 접근성 전문 개발자");
    // 수동 실패 항목 이름 해석: 카탈로그 등재 → 이름, 미등재 → id 그대로
    expect(j.failedReviews[0]!.name).toBe("자막 제공");
    expect(j.failedReviews[1]!.name).toBe("9.9.9");
  });

  it("Markdown: 구조가 고정된 형태를 유지한다", () => {
    expect(markdown).toContain("# 웹 접근성 수정 요청 — https://example.com/");
    expect(markdown).toContain("- 현재 준수율: 87.5% / 위반: 2종의 규칙, 요소 3개");
    expect(markdown).toContain("## 작업 지침");
    expect(markdown).toContain("## 위반 목록 (심각도순)");
    // 정렬: image-alt(치명적)가 1번
    expect(markdown).toMatch(/### 1\. .* — 치명적 · WCAG 1\.1\.1 · KWCAG 5\.1\.1 \(`image-alt`\)/);
    expect(markdown).toContain("참고: https://help.example/image-alt");
    // 여러 줄 html 들여쓰기 유지
    expect(markdown).toContain("  <img\n    src=\"b.png\">");
    // failureSummary 없는 노드는 진단 줄 생략
    expect(markdown).toContain("자동 진단: images must have alternate text");
    expect(markdown).toContain("## 점검자 확인 실패 항목 (수동 검사)");
    expect(markdown).toContain("- **자막 제공** (KWCAG 5.2.1)");
    expect(markdown).toContain("점검자 메모: 자막 없음");
    expect(markdown).toContain("## 완료 기준");
    expect(markdown.endsWith("\n")).toBe(true);
  });

  it("노드가 캡을 넘으면 요약 줄로 접는다", () => {
    const many = buildAiFix({
      ...INPUT,
      failedReviews: [],
      groups: [
        {
          ruleId: "image-alt",
          impact: "critical",
          tags: [],
          helpUrl: null,
          nodes: Array.from({ length: 13 }, (_, i) => ({
            pageUrl: `https://example.com/p${i}`,
            selector: `img.n${i}`,
            html: "<img>",
            failureSummary: null,
          })),
        },
      ],
    });
    expect(many.markdown).toContain("**발생 위치** (13곳)");
    expect(many.markdown).toContain("- 외 3곳 — 동일 패턴이므로 같은 방식으로 수정");
    const j = many.json as { violations: { totalNodes: number; nodes: unknown[] }[] };
    expect(j.violations[0]!.totalNodes).toBe(13);
    expect(j.violations[0]!.nodes).toHaveLength(10);
  });

  it("영문 문서도 같은 구조로 나온다", () => {
    const en = buildAiFix({ ...INPUT, lang: "en" });
    expect(en.markdown).toContain("# Web Accessibility Fix Request — https://example.com/");
    expect(en.markdown).toContain("- Current compliance: 87.5% / Violations: 2 rules, 3 elements");
    expect(en.markdown).toContain("## Definition of done");
    expect((en.json as { instructions: string }).instructions).toContain("web accessibility engineer");
  });
});

describe("groupViolationsForAiFix", () => {
  it("페이지별 결과를 규칙 단위로 합친다", () => {
    const pages: PageScanResult[] = [
      {
        url: "https://example.com/",
        scannedAt: "2026-07-30T00:00:00.000Z",
        passes: [],
        incomplete: [],
        violations: [
          {
            ruleId: "image-alt",
            impact: "critical",
            tags: ["wcag2a"],
            helpUrl: "https://help.example/image-alt",
            nodes: [{ selector: "img.a", html: "<img>", failureSummary: "" }],
          },
        ],
      },
      {
        url: "https://example.com/about",
        scannedAt: "2026-07-30T00:00:00.000Z",
        passes: [],
        incomplete: [],
        violations: [
          {
            ruleId: "image-alt",
            impact: "critical",
            tags: ["wcag2a"],
            helpUrl: "https://help.example/image-alt",
            nodes: [{ selector: "img.b", html: "<img>", failureSummary: "no alt" }],
          },
        ],
      },
    ];
    const groups = groupViolationsForAiFix(pages);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.nodes).toHaveLength(2);
    expect(groups[0]!.nodes.map((n) => n.pageUrl)).toEqual(["https://example.com/", "https://example.com/about"]);
    // 빈 failureSummary는 null로 정규화 (마크다운에서 진단 줄 생략과 일치)
    expect(groups[0]!.nodes[0]!.failureSummary).toBeNull();
    expect(groups[0]!.nodes[1]!.failureSummary).toBe("no alt");
  });
});
