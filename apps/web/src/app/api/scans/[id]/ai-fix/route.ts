import { NextResponse } from "next/server";
import { z } from "zod";
import { buildAiFix, type AiFixGroup, type Impact, type ScanSummary } from "@a11ychk/core/catalog";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAllRows } from "@/lib/scan/fetchAll";
import { apiError, resolveApiLocale } from "@/lib/apiError";

/**
 * AI 수정 요청 내보내기 — 보고서의 위반을 AI 도구(Claude/ChatGPT/Copilot)에
 * 그대로 붙여넣어 수정 코드를 받을 수 있는 자기완결 문서로 변환한다.
 *   GET ?format=md(기본)|json & lang=ko(기본)|en
 * 소유자(또는 관리자)만 접근 (RLS) — earl 라우트와 동일 패턴.
 *
 * 문서 조립은 core의 buildAiFix가 담당한다(MCP 서버와 공유) — 여기서는
 * 인증·DB 조회·행→빌더 입력 매핑·다운로드 헤더만 다룬다.
 */
const IdSchema = z.string().uuid();

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

  // DB 행 → 빌더 입력 그룹 (심각도 정렬은 빌더가 담당)
  const byRule = new Map<string, AiFixGroup>();
  for (const f of findings) {
    const group =
      byRule.get(f.rule_id) ??
      (() => {
        const g: AiFixGroup = {
          ruleId: f.rule_id,
          impact: f.impact ?? ("moderate" as Impact),
          tags: f.tags ?? [],
          helpUrl: f.help_url ?? null,
          nodes: [],
        };
        byRule.set(f.rule_id, g);
        return g;
      })();
    group.nodes.push({
      pageUrl: f.scan_pages?.url ?? null,
      selector: f.selector,
      html: f.html_snippet,
      failureSummary: f.failure_summary || null,
    });
  }

  const site = scan.root_url as string;
  const { markdown, json } = buildAiFix({
    site,
    scannedAt: (scan.finished_at ?? scan.created_at) as string,
    axeVersion: summary.engine.axeVersion,
    complianceRate: summary.scores?.combined.rate ?? summary.complianceRate,
    totalViolationNodes: summary.totalViolationNodes,
    lang,
    groups: [...byRule.values()],
    failedReviews: (reviewRows ?? []).map((r) => ({
      standard: r.standard as string,
      itemId: r.item_id as string,
      note: (r.note as string) ?? "",
      pages: Array.isArray(r.pages) ? (r.pages as string[]) : [],
    })),
  });

  if (format === "json") {
    return NextResponse.json(json, {
      headers: {
        "Content-Disposition": `attachment; filename="a11ychk-ai-fix-${hostnameOf(site)}.json"`,
        "Cache-Control": "no-store",
      },
    });
  }

  return new NextResponse(markdown, {
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
