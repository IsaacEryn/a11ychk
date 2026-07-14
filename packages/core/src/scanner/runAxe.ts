/**
 * axe-core 실행기.
 * 브라우저 실행(launch)은 환경마다 다르므로 (로컬 chromium / 서버리스 @sparticuz/chromium /
 * 크롬 확장) 이 모듈은 Playwright Page를 받아 axe를 주입·실행하고 결과를 정규화만 한다.
 */
import type { Page } from "playwright-core";
import axe from "axe-core";
import type { Finding, Impact, PageScanResult } from "../types";

/** WCAG 2.2 AA + best-practice 태그 기준으로 실행 */
export const AXE_RUN_TAGS = [
  "wcag2a",
  "wcag2aa",
  "wcag21a",
  "wcag21aa",
  "wcag22aa",
  "best-practice",
];

const VALID_IMPACTS: Impact[] = ["critical", "serious", "moderate", "minor"];

interface AxeRunResults {
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
      // 스니펫은 보고서 표시용 — 저장 용량과 XSS 표면을 줄이기 위해 길이 제한
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

/** 이미 로드된 페이지에 axe를 주입하고 실행 */
export async function runAxeOnPage(page: Page): Promise<PageScanResult> {
  await page.evaluate(axe.source);
  const raw = (await page.evaluate(
    async (tags) =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (globalThis as any).axe.run(document, {
        runOnly: { type: "tag", values: tags },
        resultTypes: ["violations", "passes", "incomplete"],
      }),
    AXE_RUN_TAGS,
  )) as AxeRunResults;
  return normalizeAxeResults(page.url(), raw);
}

export const AXE_VERSION: string = axe.version;
