import "server-only";
import { notFound, redirect } from "next/navigation";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  getRuleEntry,
  type EvaluationScope,
  type Impact,
  type ReportMeta,
  type ScanSummary,
} from "@a11ychk/core/catalog";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { verifyReportToken } from "@/lib/reportToken";
import { fetchAllRows } from "@/lib/scan/fetchAll";
import type { ReviewValue } from "./ReviewCell";

export interface FindingRow {
  rule_id: string;
  impact: Impact;
  tags: string[];
  help_url: string | null;
  selector: string;
  html_snippet: string;
  failure_summary: string;
  scan_pages: { url: string } | null;
}

export interface RuleGroup {
  ruleId: string;
  rows: FindingRow[];
  entry: ReturnType<typeof getRuleEntry>;
  impact: Impact;
}

export interface CompareData {
  prevDate: string;
  rateDelta: number; // 통합(없으면 자동) 준수율 변화 %p
  nodesDelta: number; // 위반 요소 수 변화
  resolvedRules: string[]; // 이전엔 위반, 지금은 아님
  newRules: string[]; // 이번에 새로 위반
}

/** scan_pages 행 (select * — 마이그레이션 미적용 컬럼은 undefined) */
export type PageRow = Record<string, unknown> & { id: string; url: string; status: string };

const IMPACT_ORDER: Impact[] = ["critical", "serious", "moderate", "minor"];

/** 공유 토큰 일치 확인 (0012 미적용이면 컬럼 부재 → false) */
async function matchesShareToken(scanId: string, token: string): Promise<boolean> {
  // 공유 토큰은 64자 hex — HMAC 토큰(exp.sig)과 형식이 달라 오인 없음
  if (!/^[0-9a-f]{64}$/.test(token)) return false;
  const admin = createAdminClient();
  const { data, error } = await admin.from("scans").select("share_token").eq("id", scanId).maybeSingle();
  if (error || !data?.share_token) return false;
  return data.share_token === token;
}

/**
 * 보고서 데이터 로더 — 접근 제어(토큰/세션)와 모든 조회·그룹화를 담당한다.
 * page.tsx는 이 결과를 렌더만 한다.
 */
export async function loadReport(locale: string, id: string, token: string | undefined, compareId?: string) {
  // 접근 제어 — 3경로:
  //   1) PDF 생성용 단기 HMAC 토큰 (스캔 1건, 10분)
  //   2) 공유 토큰 (소유자가 켠 읽기 전용 링크 — scans.share_token, migration 0012)
  //   3) 로그인 사용자 (RLS — 소유자/관리자, 편집 가능)
  let db: SupabaseClient;
  let canEdit = false; // 판정 기입·보고서 정보 편집 가능 여부 (토큰 접근은 읽기 전용)
  if (token && verifyReportToken(id, token)) {
    db = createAdminClient();
  } else if (token && (await matchesShareToken(id, token))) {
    db = createAdminClient();
  } else {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) redirect(`/${locale}/login`);
    db = supabase as unknown as SupabaseClient;
    canEdit = true; // RLS 통과 = 소유자 또는 관리자
  }

  // select("*")로 조회해 migration 0003 적용 전에도 scope 컬럼 부재로 깨지지 않게 한다
  const { data: scan } = await db.from("scans").select("*").eq("id", id).maybeSingle();
  if (!scan || scan.status !== "done" || !scan.summary) notFound();

  const summary = scan.summary as ScanSummary;
  const scope = (scan.scope ?? null) as EvaluationScope | null;
  const meta = (scan.report_meta ?? null) as ReportMeta | null;

  // 점검자 판정 (migration 0004 전에는 테이블이 없어 실패 → 빈 목록으로 진행)
  // pages 컬럼(0010) 미적용이어도 깨지지 않게 별도 시도
  let reviewRows: { standard: string; item_id: string; outcome: string; note: string; pages?: unknown }[] | null =
    null;
  {
    const withPages = await db.from("scan_reviews").select("standard, item_id, outcome, note, pages").eq("scan_id", id);
    if (withPages.error) {
      const basic = await db.from("scan_reviews").select("standard, item_id, outcome, note").eq("scan_id", id);
      reviewRows = basic.data;
    } else {
      reviewRows = withPages.data;
    }
  }
  const wcagReviews = new Map<string, ReviewValue>();
  const kwcagReviews = new Map<string, ReviewValue>();
  for (const r of reviewRows ?? []) {
    const target = r.standard === "wcag" ? wcagReviews : kwcagReviews;
    const pages = Array.isArray(r.pages) ? (r.pages as string[]) : undefined;
    target.set(r.item_id, { outcome: r.outcome, note: r.note, pages });
  }

  const { data: pagesData } = await db.from("scan_pages").select("*").eq("scan_id", id).order("url");
  const pages = (pagesData ?? []) as PageRow[];

  // 이미 로드한 pages의 id 재사용 + 페이지네이션 전량 조회 (절단 방지)
  const findings = (await fetchAllRows((from, to) =>
    db
      .from("findings")
      .select("rule_id, impact, tags, help_url, selector, html_snippet, failure_summary, scan_pages(url)")
      .in("scan_page_id", pages.map((p) => p.id))
      .order("id")
      .range(from, to),
  )) as unknown as FindingRow[];

  // 규칙별 그룹화 (심각도순)
  const byRule = new Map<string, FindingRow[]>();
  for (const f of findings) {
    const list = byRule.get(f.rule_id) ?? [];
    list.push(f);
    byRule.set(f.rule_id, list);
  }
  const ruleGroups: RuleGroup[] = [...byRule.entries()]
    .map(([ruleId, rows]) => ({
      ruleId,
      rows,
      entry: getRuleEntry(ruleId, rows[0]?.tags ?? []),
      impact: rows[0]?.impact ?? ("moderate" as Impact),
    }))
    .sort((a, b) => IMPACT_ORDER.indexOf(a.impact) - IMPACT_ORDER.indexOf(b.impact));

  // ── 전후 비교: 같은 사용자·같은 대상의 이전 완료 검사와 비교 (기본: 직전, ?compare=로 선택) ──
  let compare: CompareData | null = null;
  let compareOptions: { id: string; created_at: string }[] = [];
  {
    // 같은 사용자·대상으로 한정해 조회하므로 compareId로 타인 검사를 지정해도 매칭되지 않는다
    const { data: prevList } = await db
      .from("scans")
      .select("id, summary, created_at")
      .eq("user_id", scan.user_id)
      .eq("root_url", scan.root_url)
      .eq("status", "done")
      .lt("created_at", scan.created_at)
      .order("created_at", { ascending: false })
      .limit(12);
    compareOptions = (prevList ?? []).map((p) => ({ id: p.id as string, created_at: p.created_at as string }));
    const prev = (prevList ?? []).find((p) => p.id === compareId) ?? (prevList ?? [])[0] ?? null;
    const prevSummary = (prev?.summary ?? null) as ScanSummary | null;
    if (prev && prevSummary) {
      const rateOf = (s: ScanSummary) => s.scores?.combined.rate ?? s.complianceRate;
      const prevRules = Object.keys(prevSummary.byRule ?? {});
      const curRules = Object.keys(summary.byRule ?? {});
      compare = {
        prevDate: prev.created_at,
        rateDelta: Math.round((rateOf(summary) - rateOf(prevSummary)) * 10) / 10,
        nodesDelta: summary.totalViolationNodes - prevSummary.totalViolationNodes,
        resolvedRules: prevRules.filter((r) => !curRules.includes(r)),
        newRules: curRules.filter((r) => !prevRules.includes(r)),
      };
    }
  }

  return { scan, summary, scope, meta, wcagReviews, kwcagReviews, pages, ruleGroups, compare, compareOptions, canEdit };
}
