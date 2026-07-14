/**
 * axe 결과 정규화 — 순수 함수. Playwright·axe-core 런타임 의존성이 없어
 * 서버 스캐너와 크롬 확장(브라우저) 양쪽에서 공유한다.
 */
import type { Finding, Impact, PageScanResult } from "../types";

/** WCAG 2.2 AA + best-practice 태그 기준으로 실행 */
export const AXE_RUN_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"];

const VALID_IMPACTS: Impact[] = ["critical", "serious", "moderate", "minor"];

export interface AxeRunResults {
  violations: {
    id: string;
    impact?: string | null;
    tags: string[];
    helpUrl: string;
    nodes: { target: unknown[]; html: string; failureSummary?: string }[];
  }[];
  passes: { id: string }[];
  incomplete: { id: string }[];
}

function toImpact(value: string | null | undefined): Impact {
  return VALID_IMPACTS.includes(value as Impact) ? (value as Impact) : "moderate";
}

function toSelector(target: unknown[]): string {
  return target.map((t) => (Array.isArray(t) ? t.join(" >> ") : String(t))).join(", ");
}

export function normalizeAxeResults(url: string, raw: AxeRunResults): PageScanResult {
  const violations: Finding[] = raw.violations.map((v) => ({
    ruleId: v.id,
    impact: toImpact(v.impact),
    tags: v.tags,
    helpUrl: v.helpUrl,
    nodes: v.nodes.slice(0, 25).map((n) => ({
      selector: toSelector(n.target),
      // 스니펫은 표시용 — 저장 용량과 XSS 표면을 줄이기 위해 길이 제한
      html: n.html.slice(0, 600),
      failureSummary: (n.failureSummary ?? "").slice(0, 1000),
    })),
  }));
  return {
    url,
    violations,
    passes: raw.passes.map((p) => p.id),
    incomplete: raw.incomplete.map((i) => i.id),
    scannedAt: new Date().toISOString(),
  };
}
