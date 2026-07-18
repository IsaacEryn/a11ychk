import { NextResponse } from "next/server";
import { z } from "zod";
import {
  KWCAG_BY_ID,
  getRuleEntry,
  type Impact,
  type KwcagMatrixRow,
  type ScanSummary,
} from "@a11ychk/core/catalog";
import { createClient } from "@/lib/supabase/server";
import { fetchAllRows } from "@/lib/scan/fetchAll";
import { computeKwcagPageRates } from "@/app/[locale]/scans/[id]/report/kwcagPageRate";
import { computeCertReadiness } from "@/app/[locale]/scans/[id]/report/certReadiness";
import type { ReviewValue } from "@/app/[locale]/scans/[id]/report/ReviewCell";

/**
 * CSV 내보내기 — 국내 실무(엑셀 보고)용.
 *   GET ?type=findings(기본)|kwcag & lang=ko(기본)|en
 * - findings: 위반 목록 전체 (페이지·항목·규칙·심각도·선택자·코드·진단)
 * - kwcag: KWCAG 33항목 매트릭스 + 페이지 준수율
 * 한글 엑셀 호환을 위해 UTF-8 BOM을 붙인다. 소유자(또는 관리자)만 접근(RLS).
 */
const IdSchema = z.string().uuid();

const IMPACT_KO: Record<Impact, string> = { critical: "치명적", serious: "심각", moderate: "보통", minor: "경미" };
const IMPACT_EN: Record<Impact, string> = { critical: "Critical", serious: "Serious", moderate: "Moderate", minor: "Minor" };
const STATUS_KO: Record<string, string> = {
  pass: "통과", fail: "위반", review: "확인 필요", manual: "수동 검사", "not-applicable": "해당 없음",
};
const STATUS_EN: Record<string, string> = {
  pass: "Pass", fail: "Fail", review: "Needs review", manual: "Manual check", "not-applicable": "N/A",
};

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

/** CSV 필드 이스케이프 — 쌍따옴표·쉼표·줄바꿈 안전 처리 */
function esc(v: string | number | null | undefined): string {
  const s = String(v ?? "");
  return /[",\n\r]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!IdSchema.safeParse(id).success) {
    return NextResponse.json({ error: "잘못된 요청입니다." }, { status: 400 });
  }
  const sp = new URL(request.url).searchParams;
  const type = sp.get("type") === "kwcag" ? "kwcag" : "findings";
  const lang = sp.get("lang") === "en" ? "en" : "ko";

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });

  // RLS로 소유자/관리자만 조회됨
  const { data: scan } = await supabase
    .from("scans")
    .select("id, root_url, status, summary")
    .eq("id", id)
    .maybeSingle();
  if (!scan || scan.status !== "done" || !scan.summary) {
    return NextResponse.json({ error: "완료된 보고서를 찾을 수 없습니다." }, { status: 404 });
  }
  const summary = scan.summary as ScanSummary;

  const { data: pages } = await supabase.from("scan_pages").select("id, status").eq("scan_id", id);
  const donePageCount = (pages ?? []).filter((p) => p.status === "done").length;
  const findings = (await fetchAllRows((from, to) =>
    supabase
      .from("findings")
      .select("rule_id, impact, tags, help_url, selector, html_snippet, failure_summary, scan_pages(url)")
      .in("scan_page_id", (pages ?? []).map((p) => p.id))
      .order("id")
      .range(from, to),
  )) as unknown as FindingRow[];

  const pickText = (t: { ko: string; en?: string }) => (lang === "en" && t.en ? t.en : t.ko);
  const impactLabel = lang === "en" ? IMPACT_EN : IMPACT_KO;
  const rows: string[] = [];

  if (type === "findings") {
    rows.push(
      (lang === "en"
        ? ["Page URL", "KWCAG item", "WCAG SC", "Rule", "Severity", "CSS selector", "Code", "Diagnosis", "Reference"]
        : ["페이지 URL", "KWCAG 항목", "WCAG 성공기준", "규칙", "심각도", "CSS 선택자", "해당 코드", "자동 진단", "참고 링크"]
      ).map(esc).join(","),
    );
    for (const f of findings) {
      const entry = getRuleEntry(f.rule_id, f.tags ?? []);
      rows.push(
        [
          f.scan_pages?.url ?? "",
          entry.kwcag.join(" / "),
          entry.wcag.join(" / "),
          pickText(entry.title),
          impactLabel[f.impact] ?? f.impact,
          f.selector,
          f.html_snippet,
          f.failure_summary,
          f.help_url ?? "",
        ].map(esc).join(","),
      );
    }
  } else {
    const statusLabel = lang === "en" ? STATUS_EN : STATUS_KO;
    const matrix = (summary.kwcagMatrix ?? []) as KwcagMatrixRow[];
    const rates = computeKwcagPageRates(matrix, findings, donePageCount);
    // 점검자 판정 — 인증 준비 요약 평균이 보고서 화면과 일치하도록 동일 입력 사용
    const kwcagReviews = new Map<string, ReviewValue>();
    {
      const { data: reviewRows } = await supabase
        .from("scan_reviews")
        .select("standard, item_id, outcome, note, pages")
        .eq("scan_id", id)
        .eq("standard", "kwcag");
      for (const r of reviewRows ?? []) {
        const p = Array.isArray(r.pages) ? (r.pages as string[]) : undefined;
        kwcagReviews.set(r.item_id, { outcome: r.outcome, note: r.note, pages: p });
      }
    }
    rows.push(
      (lang === "en"
        ? ["Item ID", "Item", "Status", "Violation elements", "Affected pages", "Page compliance rate (%)"]
        : ["항목 번호", "검사항목", "판정", "위반 요소 수", "영향 페이지 수", "페이지 준수율(%)"]
      ).map(esc).join(","),
    );
    for (const row of matrix) {
      const item = KWCAG_BY_ID.get(row.itemId);
      if (!item) continue;
      const r = rates.get(row.itemId);
      const rateApplicable = row.status === "pass" || row.status === "fail" || row.status === "review";
      rows.push(
        [
          row.itemId,
          pickText(item.name),
          statusLabel[row.status] ?? row.status,
          row.violationCount,
          r?.violatedPages ?? 0,
          rateApplicable && r?.rate != null ? r.rate : "",
        ].map(esc).join(","),
      );
    }
    // 인증 준비 요약 — 평가 항목 평균 준수율 (보고서 화면과 동일 계산)
    const cert = computeCertReadiness(matrix, rates, kwcagReviews, donePageCount);
    if (cert.averageRate != null) {
      rows.push("");
      rows.push(
        (lang === "en"
          ? ["Average (certification readiness)", `${cert.evaluatedCount}/${cert.totalCount} checkpoints`, "", "", "", cert.averageRate]
          : ["평균(인증 준비 요약)", `${cert.evaluatedCount}/${cert.totalCount}개 항목 기준`, "", "", "", cert.averageRate]
        ).map(esc).join(","),
      );
    }
  }

  // UTF-8 BOM — 한글 엑셀이 BOM 없으면 인코딩을 잘못 추정한다
  const csv = "\uFEFF" + rows.join("\r\n") + "\r\n";
  const hostname = (() => {
    try {
      return new URL(scan.root_url as string).hostname;
    } catch {
      return "site";
    }
  })();
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="a11ychk-${type}-${hostname}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
