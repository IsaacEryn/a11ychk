import { NextResponse } from "next/server";
import { z } from "zod";
import { KWCAG_BY_ID, getRuleEntry, type Impact, type ScanSummary } from "@a11ychk/core/catalog";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAllRows } from "@/lib/scan/fetchAll";
import { apiError, resolveApiLocale } from "@/lib/apiError";

/**
 * AI 수정 요청 내보내기 — 보고서의 위반을 AI 도구(Claude/ChatGPT/Copilot)에
 * 그대로 붙여넣어 수정 코드를 받을 수 있는 자기완결 문서로 변환한다.
 *   GET ?format=md(기본)|json & lang=ko(기본)|en
 * 소유자(또는 관리자)만 접근 (RLS) — earl 라우트와 동일 패턴.
 */
const IdSchema = z.string().uuid();

const IMPACT_ORDER: Impact[] = ["critical", "serious", "moderate", "minor"];
const IMPACT_KO: Record<Impact, string> = { critical: "치명적", serious: "심각", moderate: "보통", minor: "경미" };
const IMPACT_EN: Record<Impact, string> = { critical: "Critical", serious: "Serious", moderate: "Moderate", minor: "Minor" };

/** 규칙당 프롬프트에 포함할 최대 발생 위치 — 나머지는 "동일 패턴 외 N곳"으로 요약 */
const MAX_NODES_PER_RULE = 10;

interface FindingRow {
  rule_id: string;
  impact: Impact;
  tags: string[];
  help_url: string | null;
  selector: string;
  html_snippet: string;
  failure_summary: string;
  scan_pages: { url: string } | null;
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // ?lang= 우선, 없으면 Accept-Language 협상 — 에러·문서 언어 공통
  const lang = resolveApiLocale(req);
  if (!IdSchema.safeParse(id).success) {
    return apiError(lang, "invalidRequest", 400);
  }
  const sp = new URL(req.url).searchParams;
  const format = sp.get("format") === "json" ? "json" : "md";

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return apiError(lang, "loginRequired", 401);

  // RLS로 소유자/관리자만 조회됨
  const { data: scan } = await supabase
    .from("scans")
    .select("id, root_url, status, summary, finished_at, created_at")
    .eq("id", id)
    .maybeSingle();
  if (!scan || scan.status !== "done" || !scan.summary) {
    return apiError(lang, "reportNotReady", 404);
  }
  const summary = scan.summary as ScanSummary;

  // 활용 지표 — AI 수정 요청 다운로드 수 (0014 미적용/실패 시 무시, best-effort)
  void createAdminClient()
    .rpc("increment_usage_counter", { p_key: "ai_fix_download" })
    .then(() => undefined, () => undefined);

  // 페이지 + findings 전량 (절단 방지 페이지네이션 — loadReport와 동일 패턴)
  const { data: pages } = await supabase.from("scan_pages").select("id").eq("scan_id", id);
  const findings = (await fetchAllRows((from, to) =>
    supabase
      .from("findings")
      .select("rule_id, impact, tags, help_url, selector, html_snippet, failure_summary, scan_pages(url)")
      .in("scan_page_id", (pages ?? []).map((p) => p.id))
      .order("id")
      .range(from, to),
  )) as unknown as FindingRow[];

  // 점검자가 '실패'로 확정한 수동 항목 (0004 미적용 시 빈 목록)
  const { data: reviewRows } = await supabase
    .from("scan_reviews")
    .select("standard, item_id, outcome, note, pages")
    .eq("scan_id", id)
    .eq("outcome", "failed")
    .then((r) => r, () => ({ data: null }));

  // 규칙별 그룹화 (심각도순)
  const byRule = new Map<string, FindingRow[]>();
  for (const f of findings) {
    const list = byRule.get(f.rule_id) ?? [];
    list.push(f);
    byRule.set(f.rule_id, list);
  }
  const groups = [...byRule.entries()]
    .map(([ruleId, rows]) => ({
      ruleId,
      rows,
      entry: getRuleEntry(ruleId, rows[0]?.tags ?? []),
      impact: rows[0]?.impact ?? ("moderate" as Impact),
    }))
    .sort((a, b) => IMPACT_ORDER.indexOf(a.impact) - IMPACT_ORDER.indexOf(b.impact));

  const pickText = (t: { ko: string; en?: string }) => (lang === "en" && t.en ? t.en : t.ko);
  const impactLabel = lang === "en" ? IMPACT_EN : IMPACT_KO;
  const site = scan.root_url as string;
  const scannedAt = (scan.finished_at ?? scan.created_at) as string;
  const rate = summary.scores?.combined.rate ?? summary.complianceRate;

  const failedReviews = (reviewRows ?? []).map((r) => ({
    standard: r.standard as string,
    itemId: r.item_id as string,
    name:
      r.standard === "kwcag"
        ? (KWCAG_BY_ID.get(r.item_id)?.name && pickText(KWCAG_BY_ID.get(r.item_id)!.name)) || r.item_id
        : r.item_id,
    note: (r.note as string) ?? "",
    pages: Array.isArray(r.pages) ? (r.pages as string[]) : [],
  }));

  const instructions =
    lang === "en"
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

  // ── JSON 형식 ──
  if (format === "json") {
    const payload = {
      meta: {
        tool: "A11y Check (a11ychk.com)",
        site,
        scannedAt,
        standard: "WCAG 2.2 AA + KWCAG 2.2",
        engine: `axe-core v${summary.engine.axeVersion} + a11ychk rules`,
        complianceRate: rate,
        totalViolationNodes: summary.totalViolationNodes,
      },
      instructions,
      violations: groups.map(({ ruleId, rows, entry, impact }) => ({
        ruleId,
        title: pickText(entry.title),
        impact,
        level: entry.level,
        wcag: entry.wcag,
        kwcag: entry.kwcag,
        helpUrl: rows[0]?.help_url ?? null,
        guide: pickText(entry.guide),
        totalNodes: rows.length,
        nodes: rows.slice(0, MAX_NODES_PER_RULE).map((r) => ({
          pageUrl: r.scan_pages?.url ?? null,
          selector: r.selector,
          html: r.html_snippet,
          failureSummary: r.failure_summary || null,
        })),
      })),
      failedReviews,
    };
    return NextResponse.json(payload, {
      headers: {
        "Content-Disposition": `attachment; filename="a11ychk-ai-fix-${hostnameOf(site)}.json"`,
        "Cache-Control": "no-store",
      },
    });
  }

  // ── Markdown 형식 ──
  const L = (ko: string, en: string) => (lang === "en" ? en : ko);
  const lines: string[] = [];
  lines.push(`# ${L("웹 접근성 수정 요청", "Web Accessibility Fix Request")} — ${site}`);
  lines.push("");
  lines.push(`- ${L("검사 도구", "Audit tool")}: A11y Check (a11ychk.com)`);
  lines.push(`- ${L("검사 일시", "Scanned at")}: ${scannedAt}`);
  lines.push(`- ${L("검사 기준", "Standard")}: WCAG 2.2 AA · KWCAG 2.2 / axe-core v${summary.engine.axeVersion} + a11ychk rules`);
  lines.push(
    `- ${L("현재 준수율", "Current compliance")}: ${rate}% / ${L("위반", "Violations")}: ${groups.length}${L(
      "종의 규칙, 요소 ",
      " rules, ",
    )}${summary.totalViolationNodes}${L("개", " elements")}`,
  );
  lines.push("");
  lines.push(`## ${L("작업 지침", "Instructions")}`);
  lines.push("");
  lines.push(instructions);
  lines.push("");
  lines.push(`## ${L("위반 목록 (심각도순)", "Violations (by severity)")}`);

  groups.forEach(({ ruleId, rows, entry, impact }, i) => {
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
    if (rows[0]?.help_url) {
      lines.push("");
      lines.push(`${L("참고", "Reference")}: ${rows[0].help_url}`);
    }
    lines.push("");
    lines.push(`**${L("발생 위치", "Occurrences")}** (${rows.length}${L("곳", "")})`);
    for (const r of rows.slice(0, MAX_NODES_PER_RULE)) {
      lines.push("");
      lines.push(`- ${L("페이지", "Page")}: ${r.scan_pages?.url ?? "?"}`);
      lines.push(`  ${L("선택자", "Selector")}: \`${r.selector}\``);
      lines.push(`  ${L("현재 코드", "Current code")}:`);
      lines.push("  ```html");
      lines.push(`  ${r.html_snippet.replaceAll("\n", "\n  ")}`);
      lines.push("  ```");
      if (r.failure_summary) {
        lines.push(`  ${L("자동 진단", "Diagnosis")}: ${r.failure_summary.replaceAll("\n", " / ")}`);
      }
    }
    if (rows.length > MAX_NODES_PER_RULE) {
      lines.push("");
      lines.push(
        `- ${L(`외 ${rows.length - MAX_NODES_PER_RULE}곳 — 동일 패턴이므로 같은 방식으로 수정`, `+${rows.length - MAX_NODES_PER_RULE} more with the same pattern — apply the same fix`)}`,
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

  return new NextResponse(lines.join("\n"), {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Content-Disposition": `attachment; filename="a11ychk-ai-fix-${hostnameOf(site)}.md"`,
      "Cache-Control": "no-store",
    },
  });
}

function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "site";
  }
}
