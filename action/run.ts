/**
 * GitHub Actions 러너 — 지정 URL들을 chromium으로 열어 자동 접근성 검사
 * (axe-core + 자체 규칙, WCAG 2.2 + KWCAG 2.2)를 실행하고, 스텝 요약(Markdown)과
 * 종료 코드로 결과를 알린다. 배포 전(사전 게시) 검사 용도.
 *
 * 실행 방식: action.yml이 esbuild로 이 파일을 번들한 뒤 node로 실행한다.
 * 입력은 GitHub Actions 규약대로 INPUT_* 환경변수로 전달된다.
 */
import { appendFileSync } from "node:fs";
import {
  AXE_VERSION,
  aggregateScan,
  getRuleEntry,
  runAxeOnPage,
  type Impact,
  type PageScanResult,
} from "../packages/core/src/index";

const IMPACT_ORDER: Impact[] = ["critical", "serious", "moderate", "minor"];
const IMPACT_LABEL: Record<Impact, string> = {
  critical: "치명적 (critical)",
  serious: "심각 (serious)",
  moderate: "보통 (moderate)",
  minor: "경미 (minor)",
};

/** 한 번의 실행에서 검사할 최대 URL 수 (CI 시간 보호) */
const MAX_URLS = 20;
const FAIL_ON_VALUES = ["any", "critical", "serious", "none"] as const;
type FailOn = (typeof FAIL_ON_VALUES)[number];

function parseUrls(raw: string): string[] {
  return raw
    .split(/[\n,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

async function main() {
  const urls = parseUrls(process.env.INPUT_URLS ?? "");
  const failOnRaw = (process.env.INPUT_FAIL_ON ?? "serious").trim();
  if (urls.length === 0) {
    console.error("::error::urls 입력이 비어 있습니다. 검사할 페이지 URL을 한 줄에 하나씩 지정하세요.");
    process.exit(2);
  }
  if (!FAIL_ON_VALUES.includes(failOnRaw as FailOn)) {
    console.error(`::error::fail-on 값이 올바르지 않습니다: "${failOnRaw}" (허용: ${FAIL_ON_VALUES.join(", ")})`);
    process.exit(2);
  }
  const failOn = failOnRaw as FailOn;
  if (urls.length > MAX_URLS) {
    console.log(`::warning::URL이 ${urls.length}개라 앞 ${MAX_URLS}개만 검사합니다.`);
  }

  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ headless: true });
  const pages: PageScanResult[] = [];
  const failedUrls: { url: string; reason: string }[] = [];
  try {
    for (const url of urls.slice(0, MAX_URLS)) {
      const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: "ko-KR" });
      const page = await context.newPage();
      try {
        await page.goto(url, { waitUntil: "load", timeout: 60_000 });
        await page.waitForTimeout(500); // 늦은 렌더 안정화
        pages.push(await runAxeOnPage(page));
        console.log(`✓ ${url}`);
      } catch (e) {
        const reason = ((e as Error).message ?? "unknown").split("\n")[0]!.slice(0, 200);
        failedUrls.push({ url, reason });
        console.log(`✗ ${url} — ${reason}`);
      } finally {
        await context.close().catch(() => undefined);
      }
    }
  } finally {
    await browser.close().catch(() => undefined);
  }

  if (pages.length === 0) {
    console.error("::error::모든 URL에서 페이지를 열지 못했습니다.");
    process.exit(1);
  }

  const summary = aggregateScan(pages, AXE_VERSION);

  // 규칙별 집계 (전체 페이지 합산, 심각도순)
  const byRule = new Map<string, { impact: Impact; nodes: number; tags: string[] }>();
  for (const p of pages) {
    for (const v of p.violations) {
      const prev = byRule.get(v.ruleId);
      byRule.set(v.ruleId, {
        impact: prev?.impact ?? v.impact,
        nodes: (prev?.nodes ?? 0) + v.nodes.length,
        tags: prev?.tags ?? v.tags,
      });
    }
  }
  const rules = [...byRule.entries()]
    .map(([ruleId, r]) => ({ ruleId, ...r, entry: getRuleEntry(ruleId, r.tags) }))
    .sort((a, b) => IMPACT_ORDER.indexOf(a.impact) - IMPACT_ORDER.indexOf(b.impact));

  // ── 스텝 요약 (Markdown) ──
  const md: string[] = [];
  md.push("## A11y Check — 자동 접근성 검사 결과");
  md.push("");
  md.push(`- 검사 페이지: ${pages.length}개 / 자동 검사 준수율: **${summary.complianceRate}%**`);
  md.push(`- 위반: 규칙 ${rules.length}종 · 요소 ${summary.totalViolationNodes}개`);
  md.push(
    `- 심각도별 요소: ${IMPACT_ORDER.map((k) => `${IMPACT_LABEL[k].split(" ")[0]} ${summary.byImpact[k]}`).join(" · ")}`,
  );
  md.push(`- 기준: WCAG 2.2 AA + KWCAG 2.2 (axe-core v${AXE_VERSION} + 자체 규칙)`);
  md.push("");
  if (rules.length > 0) {
    md.push("| 심각도 | 규칙 | 요소 수 | 기준 |");
    md.push("|---|---|---:|---|");
    for (const r of rules) {
      const refs = [
        r.entry.wcag.length ? `WCAG ${r.entry.wcag.join(", ")}` : "",
        r.entry.kwcag.length ? `KWCAG ${r.entry.kwcag.join(", ")}` : "",
      ]
        .filter(Boolean)
        .join(" · ");
      md.push(`| ${IMPACT_LABEL[r.impact]} | ${r.entry.title.ko} (\`${r.ruleId}\`) | ${r.nodes} | ${refs} |`);
    }
  } else {
    md.push("자동 검사 위반이 없습니다. 🎉 (자동 도구는 일부 기준만 검출합니다 — 수동 점검 병행 권장)");
  }
  if (failedUrls.length > 0) {
    md.push("");
    md.push("### 열지 못한 페이지");
    for (const f of failedUrls) md.push(`- ${f.url} — ${f.reason}`);
  }
  md.push("");
  md.push(
    "사이트 단위 검사·수동 판정 워크플로·인증 준비 보고서는 [a11ychk.com](https://www.a11ychk.com)에서 이용할 수 있습니다.",
  );
  const markdown = md.join("\n");

  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, markdown + "\n");
  }
  console.log("\n" + markdown + "\n");

  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(
      process.env.GITHUB_OUTPUT,
      `compliance-rate=${summary.complianceRate}\nviolation-nodes=${summary.totalViolationNodes}\nviolation-rules=${rules.length}\n`,
    );
  }

  // ── 실패 판정 ──
  const gate =
    failOn === "none"
      ? 0
      : failOn === "any"
        ? summary.totalViolationNodes
        : failOn === "critical"
          ? summary.byImpact.critical
          : summary.byImpact.critical + summary.byImpact.serious;
  if (gate > 0) {
    console.error(`::error::접근성 위반 기준(fail-on: ${failOn}) 초과 — 해당 요소 ${gate}개. 위 요약을 확인하세요.`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error("::error::검사 실행 실패:", (e as Error).message ?? e);
  process.exit(1);
});
