/**
 * AI 수정 요청 문서 빌더 — 위반 목록을 AI 코딩 도구(Claude/ChatGPT/Copilot)에
 * 그대로 투입할 수 있는 자기완결 문서(Markdown·JSON)로 만든다.
 *
 * 같은 문서를 웹 API(ai-fix 라우트)와 MCP 서버가 만들고, 확장도 향후 여기로
 * 통합할 예정이라 순수 함수로 둔다 — 입력은 정규화된 형태만 받고 DB·인증을
 * 모른다. 카탈로그(getRuleEntry 등)만 쓰므로 브라우저 번들에서도 안전하다.
 */
import { KWCAG_BY_ID } from "../catalog/kwcag";
import { WCAG_BY_ID } from "../catalog/wcag";
import { getRuleEntry } from "../catalog/rules";
import type { Impact, PageScanResult } from "../types";

const IMPACT_ORDER: Impact[] = ["critical", "serious", "moderate", "minor"];
const IMPACT_KO: Record<Impact, string> = { critical: "치명적", serious: "심각", moderate: "보통", minor: "경미" };
const IMPACT_EN: Record<Impact, string> = { critical: "Critical", serious: "Serious", moderate: "Moderate", minor: "Minor" };

/** 규칙당 문서에 포함할 최대 발생 위치 — 나머지는 "동일 패턴 외 N곳"으로 요약 */
export const AI_FIX_MAX_NODES_PER_RULE = 10;

/**
 * 검사 대상 페이지에서 가져온 스니펫을 감쌀 코드펜스.
 * 스니펫에 백틱 세 개가 들어 있으면 펜스가 그 자리에서 닫히고, 뒤따르는 페이지 내용이
 * 코드가 아니라 AI에게 주는 지시문 자리로 빠져나온다. 내용의 최장 백틱 런보다 긴
 * 펜스를 골라 그 탈출을 막는다.
 */
export function codeFence(content: string): string {
  let longest = 0;
  for (const m of content.matchAll(/`+/g)) longest = Math.max(longest, m[0].length);
  return "`".repeat(Math.max(3, longest + 1));
}

export interface AiFixNode {
  pageUrl: string | null;
  selector: string;
  html: string;
  failureSummary: string | null;
}

export interface AiFixGroup {
  ruleId: string;
  impact: Impact;
  /** axe 태그 — 카탈로그 미등재 규칙의 WCAG 폴백 매핑에 사용 */
  tags: string[];
  helpUrl: string | null;
  /** 전체 발생 위치 (캡은 빌더가 적용) */
  nodes: AiFixNode[];
}

export interface AiFixFailedReview {
  standard: string;
  itemId: string;
  note: string;
  pages: string[];
}

export interface AiFixInput {
  site: string;
  scannedAt: string;
  axeVersion: string;
  complianceRate: number;
  totalViolationNodes: number;
  lang: "ko" | "en";
  groups: AiFixGroup[];
  /** 점검자가 '실패'로 확정한 수동 항목 (웹 전용 — MCP는 미전달) */
  failedReviews?: AiFixFailedReview[];
  maxNodesPerRule?: number;
}

export function buildAiFixInstructions(lang: "ko" | "en"): string {
  return lang === "en"
    ? `You are a web accessibility engineer. Fix every violation listed below on the target site.
Principles: (1) prefer semantic HTML over ARIA patches; (2) minimize visual design changes;
(3) each violation gives you the page URL, CSS selector, and current HTML as clues to locate
the source file; (4) if a fix is not possible, state the reason explicitly.
Output format per violation: [target location] → [fixed code] → [one-line rationale].`
    : `당신은 웹 접근성 전문 개발자입니다. 아래 위반 목록을 대상 사이트에서 모두 수정하세요.
원칙: ① ARIA 덧대기보다 시맨틱 HTML을 우선할 것 ② 시각 디자인 변경은 최소화할 것
③ 각 위반에는 소스 파일을 찾는 단서로 '페이지 URL + CSS 선택자 + 현재 HTML'이 제공됨
④ 수정이 불가능하거나 보류해야 하는 항목은 사유를 명시할 것.
출력 형식: 위반별로 [대상 위치] → [수정된 코드] → [수정 이유 한 줄].`;
}

/** 로컬 스캔 결과(PageScanResult[])를 빌더 입력 그룹으로 — MCP·확장용 어댑터 */
export function groupViolationsForAiFix(pages: PageScanResult[]): AiFixGroup[] {
  const byRule = new Map<string, AiFixGroup>();
  for (const page of pages) {
    for (const v of page.violations) {
      const group =
        byRule.get(v.ruleId) ??
        (() => {
          const g: AiFixGroup = { ruleId: v.ruleId, impact: v.impact, tags: v.tags, helpUrl: v.helpUrl || null, nodes: [] };
          byRule.set(v.ruleId, g);
          return g;
        })();
      for (const n of v.nodes) {
        group.nodes.push({ pageUrl: page.url, selector: n.selector, html: n.html, failureSummary: n.failureSummary || null });
      }
    }
  }
  return [...byRule.values()];
}

export function buildAiFix(input: AiFixInput): { markdown: string; json: Record<string, unknown> } {
  const { site, scannedAt, axeVersion, complianceRate, totalViolationNodes, lang } = input;
  const maxNodes = input.maxNodesPerRule ?? AI_FIX_MAX_NODES_PER_RULE;
  const failedReviewsIn = input.failedReviews ?? [];

  const pickText = (t: { ko: string; en?: string }) => (lang === "en" && t.en ? t.en : t.ko);
  const impactLabel = lang === "en" ? IMPACT_EN : IMPACT_KO;
  const L = (ko: string, en: string) => (lang === "en" ? en : ko);

  // 심각도순 정렬 + 카탈로그 엔트리 결합 (호출부 그룹 순서와 무관하게 결정적)
  const groups = input.groups
    .map((g) => ({ ...g, entry: getRuleEntry(g.ruleId, g.tags) }))
    .sort((a, b) => IMPACT_ORDER.indexOf(a.impact) - IMPACT_ORDER.indexOf(b.impact));

  // 수동 실패 항목의 표시 이름 해석 (KWCAG/WCAG 카탈로그, 미등재 시 id 그대로)
  const failedReviews = failedReviewsIn.map((r) => ({
    standard: r.standard,
    itemId: r.itemId,
    name: (() => {
      const entry = r.standard === "kwcag" ? KWCAG_BY_ID.get(r.itemId) : WCAG_BY_ID.get(r.itemId);
      return entry ? pickText(entry.name) : r.itemId;
    })(),
    note: r.note,
    pages: r.pages,
  }));

  const instructions = buildAiFixInstructions(lang);

  // ── JSON 형식 ──
  const json = {
    meta: {
      tool: "A11y Check (a11ychk.com)",
      site,
      scannedAt,
      standard: "WCAG 2.2 AA + KWCAG 2.2",
      engine: `axe-core v${axeVersion} + a11ychk rules`,
      complianceRate,
      totalViolationNodes,
    },
    instructions,
    violations: groups.map(({ ruleId, nodes, entry, impact, helpUrl }) => ({
      ruleId,
      title: pickText(entry.title),
      impact,
      level: entry.level,
      wcag: entry.wcag,
      kwcag: entry.kwcag,
      helpUrl,
      guide: pickText(entry.guide),
      totalNodes: nodes.length,
      nodes: nodes.slice(0, maxNodes).map((n) => ({
        pageUrl: n.pageUrl,
        selector: n.selector,
        html: n.html,
        failureSummary: n.failureSummary,
      })),
    })),
    failedReviews,
  };

  // ── Markdown 형식 ──
  const lines: string[] = [];
  lines.push(`# ${L("웹 접근성 수정 요청", "Web Accessibility Fix Request")} — ${site}`);
  lines.push("");
  lines.push(`- ${L("검사 도구", "Audit tool")}: A11y Check (a11ychk.com)`);
  lines.push(`- ${L("검사 일시", "Scanned at")}: ${scannedAt}`);
  lines.push(`- ${L("검사 기준", "Standard")}: WCAG 2.2 AA · KWCAG 2.2 / axe-core v${axeVersion} + a11ychk rules`);
  lines.push(
    `- ${L("현재 준수율", "Current compliance")}: ${complianceRate}% / ${L("위반", "Violations")}: ${groups.length}${L(
      "종의 규칙, 요소 ",
      " rules, ",
    )}${totalViolationNodes}${L("개", " elements")}`,
  );
  lines.push("");
  lines.push(`## ${L("작업 지침", "Instructions")}`);
  lines.push("");
  lines.push(instructions);
  lines.push("");
  lines.push(`## ${L("위반 목록 (심각도순)", "Violations (by severity)")}`);

  groups.forEach(({ ruleId, nodes, entry, impact, helpUrl }, i) => {
    lines.push("");
    const refs = [
      entry.wcag.length > 0 ? `WCAG ${entry.wcag.join(", ")}` : null,
      entry.kwcag.length > 0 ? `KWCAG ${entry.kwcag.join(", ")}` : null,
    ]
      .filter(Boolean)
      .join(" · ");
    lines.push(`### ${i + 1}. ${pickText(entry.title)} — ${impactLabel[impact]}${refs ? ` · ${refs}` : ""} (\`${ruleId}\`)`);
    lines.push("");
    lines.push(`**${L("수정 방법", "How to fix")}**`);
    lines.push("");
    lines.push(pickText(entry.guide));
    if (helpUrl) {
      lines.push("");
      lines.push(`${L("참고", "Reference")}: ${helpUrl}`);
    }
    lines.push("");
    lines.push(`**${L("발생 위치", "Occurrences")}** (${nodes.length}${L("곳", "")})`);
    for (const n of nodes.slice(0, maxNodes)) {
      lines.push("");
      lines.push(`- ${L("페이지", "Page")}: ${n.pageUrl ?? "?"}`);
      lines.push(`  ${L("선택자", "Selector")}: \`${n.selector}\``);
      lines.push(`  ${L("현재 코드", "Current code")}:`);
      const fence = codeFence(n.html);
      lines.push(`  ${fence}html`);
      lines.push(`  ${n.html.replaceAll("\n", "\n  ")}`);
      lines.push(`  ${fence}`);
      if (n.failureSummary) {
        lines.push(`  ${L("자동 진단", "Diagnosis")}: ${n.failureSummary.replaceAll("\n", " / ")}`);
      }
    }
    if (nodes.length > maxNodes) {
      lines.push("");
      lines.push(
        `- ${L(`외 ${nodes.length - maxNodes}곳 — 동일 패턴이므로 같은 방식으로 수정`, `+${nodes.length - maxNodes} more with the same pattern — apply the same fix`)}`,
      );
    }
  });

  if (failedReviews.length > 0) {
    lines.push("");
    lines.push(`## ${L("점검자 확인 실패 항목 (수동 검사)", "Expert-confirmed failures (manual review)")}`);
    for (const r of failedReviews) {
      lines.push("");
      lines.push(`- **${r.name}** (${r.standard.toUpperCase()} ${r.itemId})`);
      if (r.note) lines.push(`  ${L("점검자 메모", "Reviewer note")}: ${r.note}`);
      if (r.pages.length > 0) lines.push(`  ${L("관련 페이지", "Related pages")}: ${r.pages.join(" · ")}`);
    }
  }

  lines.push("");
  lines.push(`## ${L("완료 기준", "Definition of done")}`);
  lines.push("");
  lines.push(`- ${L("수정 후 axe-core 재검사에서 위 규칙의 위반 0건", "Zero violations for the rules above on an axe-core re-scan")}`);
  lines.push(
    `- ${L("a11ychk.com에서 동일 조건 재검사로 준수율 개선 확인", "Verify the compliance improvement with a same-scope re-scan on a11ychk.com")}`,
  );
  lines.push("");

  return { markdown: lines.join("\n"), json };
}
