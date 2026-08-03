/**
 * scan_page / scan_pages 구현.
 *
 * 판정은 웹 보고서·GitHub Action과 같은 기준을 쓴다: aggregateScan이 골라 주는
 * 모범 사례(bestPractice, WCAG 성공기준에 대응하지 않는 axe 규칙)를 준수율과 위반
 * 집계에서 빼고 권고로만 보고한다. 세 진입점의 점수가 어긋나면 안 된다.
 */
import {
  AXE_VERSION,
  AI_FIX_MAX_NODES_PER_RULE,
  aggregateScan,
  getRuleEntry,
  groupViolationsForAiFix,
  pickLocale,
  scanUrls,
  type Impact,
} from "@a11ychk/core";
import { browserSource, launchBrowser } from "./browser";
import { footer } from "./funnel";

const IMPACT_ORDER: Impact[] = ["critical", "serious", "moderate", "minor"];
/** html 스니펫 표시 상한 — 원본 전량을 결과에 싣지 않는다 (컨텍스트 보호) */
const MAX_HTML_CHARS = 300;

export interface ScanToolResult {
  structuredContent: {
    scannedPages: number;
    failedUrls: { url: string; reason: string }[];
    complianceRate: number;
    violationNodes: number;
    violationRules: number;
    advisoryRules: number;
    browser: "chromium" | "chrome";
    violations: {
      ruleId: string;
      title: string;
      impact: Impact;
      wcag: string[];
      kwcag: string[];
      helpUrl: string | null;
      guide: string;
      totalNodes: number;
      nodes: { pageUrl: string | null; selector: string; html: string; failureSummary: string | null }[];
    }[];
    advisory: { ruleId: string; title: string; totalNodes: number }[];
  };
  text: string;
}

const clip = (s: string) => (s.length > MAX_HTML_CHARS ? `${s.slice(0, MAX_HTML_CHARS)}…` : s);

export async function runScanTool(
  urls: string[],
  lang: "ko" | "en",
  maxUrls: number,
  onProgress?: (done: number, total: number, url: string) => void,
): Promise<ScanToolResult> {
  const total = Math.min(urls.length, maxUrls);
  let done = 0;
  const { pages, failedUrls } = await scanUrls(urls, {
    launch: launchBrowser,
    maxUrls,
    onResult: (url) => {
      done += 1;
      onProgress?.(done, total, url);
    },
  });

  const summary = aggregateScan(pages, AXE_VERSION);
  const advisoryIds = new Set((summary.bestPractice ?? []).map((b) => b.ruleId));

  const allGroups = groupViolationsForAiFix(pages)
    .map((g) => ({ ...g, entry: getRuleEntry(g.ruleId, g.tags) }))
    .sort((a, b) => IMPACT_ORDER.indexOf(a.impact) - IMPACT_ORDER.indexOf(b.impact));
  const violationGroups = allGroups.filter((g) => !advisoryIds.has(g.ruleId));
  const advisoryGroups = allGroups.filter((g) => advisoryIds.has(g.ruleId));

  const violationNodes = violationGroups.reduce((n, g) => n + g.nodes.length, 0);
  // 웹 보고서 헤드라인·액션과 같은 값 — WCAG 성공기준 기준 자동 점수
  const complianceRate = summary.scores?.automated.rate ?? summary.complianceRate;

  const structuredContent: ScanToolResult["structuredContent"] = {
    scannedPages: pages.length,
    failedUrls,
    complianceRate,
    violationNodes,
    violationRules: violationGroups.length,
    advisoryRules: advisoryGroups.length,
    browser: browserSource,
    violations: violationGroups.map((g) => ({
      ruleId: g.ruleId,
      title: pickLocale(g.entry.title, lang),
      impact: g.impact,
      wcag: g.entry.wcag,
      kwcag: g.entry.kwcag,
      helpUrl: g.helpUrl,
      guide: pickLocale(g.entry.guide, lang),
      totalNodes: g.nodes.length,
      nodes: g.nodes.slice(0, AI_FIX_MAX_NODES_PER_RULE).map((n) => ({
        pageUrl: n.pageUrl,
        selector: n.selector,
        html: clip(n.html),
        failureSummary: n.failureSummary,
      })),
    })),
    advisory: advisoryGroups.map((g) => ({
      ruleId: g.ruleId,
      title: pickLocale(g.entry.title, lang),
      totalNodes: g.nodes.length,
    })),
  };

  return { structuredContent, text: renderText(structuredContent, lang, urls[0]) };
}

function renderText(r: ScanToolResult["structuredContent"], lang: "ko" | "en", rootUrl?: string): string {
  const L = (ko: string, en: string) => (lang === "en" ? en : ko);
  const lines: string[] = [];
  lines.push(
    `${L("검사 페이지", "Pages scanned")}: ${r.scannedPages} / ${L("자동 검사 준수율", "Automated compliance")}: ${r.complianceRate}%`,
  );
  lines.push(
    `${L("위반", "Violations")}: ${r.violationRules}${L("종의 규칙, 요소 ", " rules, ")}${r.violationNodes}${L("개", " elements")}` +
      (r.advisoryRules > 0 ? ` (${L("모범 사례 권고", "best-practice advisories")}: ${r.advisoryRules})` : ""),
  );
  for (const v of r.violations) {
    lines.push("");
    const refs = [v.wcag.length ? `WCAG ${v.wcag.join(", ")}` : null, v.kwcag.length ? `KWCAG ${v.kwcag.join(", ")}` : null]
      .filter(Boolean)
      .join(" · ");
    lines.push(`- ${v.title} (\`${v.ruleId}\`, ${v.impact}${refs ? `, ${refs}` : ""}) — ${v.totalNodes}${L("곳", " nodes")}`);
    const first = v.nodes[0];
    if (first) lines.push(`  ${L("예", "e.g.")}: ${first.pageUrl ?? "?"} → \`${first.selector}\``);
  }
  if (r.advisory.length > 0) {
    lines.push("");
    lines.push(
      `${L("모범 사례 권고(준수율 미반영)", "Best-practice advisories (not counted)")}: ` +
        r.advisory.map((a) => `${a.ruleId}(${a.totalNodes})`).join(", "),
    );
  }
  if (r.failedUrls.length > 0) {
    lines.push("");
    lines.push(`${L("열지 못한 페이지", "Pages that failed to load")}:`);
    for (const f of r.failedUrls) lines.push(`- ${f.url} — ${f.reason}`);
  }
  lines.push("");
  lines.push(
    L(
      "각 위반의 guide 필드에 한국어 수정 방법이 있습니다. 수정 후 같은 도구로 재검사해 확인하세요.",
      "Each violation carries remediation guidance in its guide field. Re-scan with this tool after fixing.",
    ),
  );
  lines.push("");
  lines.push(footer(lang, "scan", rootUrl));
  return lines.join("\n");
}
