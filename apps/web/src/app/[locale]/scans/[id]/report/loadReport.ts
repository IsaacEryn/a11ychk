import "server-only";
import { notFound, redirect } from "next/navigation";
import { unstable_cache } from "next/cache";
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
import { getCachedUser } from "@/lib/supabase/user";
import { logAdminAction } from "@/lib/logs";
import { verifyReportToken } from "@/lib/reportToken";
import { fetchAllRows } from "@/lib/scan/fetchAll";
import type { ReviewValue } from "./ReviewCell";

/**
 * 스캔의 대량·열람자 무관 데이터(페이지·위반 전량)를 (scanId, version) 키로 캐시한다.
 * findings 전량 페이지네이션이 보고서 로딩의 지배적 비용이라, view/std/compare
 * 토글마다 재페치되던 것을 캐시로 없앤다. 소유권 검증은 상위(loadReport)의 RLS
 * scan 조회가 이미 담당하므로, 여기서는 admin으로 조회해도 안전하다.
 *
 * version에는 scan.finished_at을 넘긴다 — rescanPage→reaggregate가 재검사 때마다
 * finished_at을 갱신하므로 findings가 바뀌면 캐시 키가 달라져 자동으로 재조회된다
 * (별도 revalidateTag 불필요). 이전 버전 키 항목은 자연히 LRU로 밀려난다.
 */
function loadScanBulk(scanId: string, version: string): Promise<{ pages: PageRow[]; findings: FindingRow[] }> {
  return unstable_cache(
    async () => {
      const admin = createAdminClient();
      const { data: pagesData } = await admin.from("scan_pages").select("*").eq("scan_id", scanId).order("url");
      const pages = (pagesData ?? []) as PageRow[];
      const findings = (await fetchAllRows((from, to) =>
        admin
          .from("findings")
          .select("rule_id, impact, tags, help_url, selector, html_snippet, failure_summary, scan_pages(url)")
          .in("scan_page_id", pages.map((p) => p.id))
          .order("id")
          .range(from, to),
      )) as unknown as FindingRow[];
      return { pages, findings };
    },
    ["report-bulk", scanId, version],
    { revalidate: false },
  )();
}

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
  let sessionUserId: string | null = null; // 세션 접근 시 열람자 id — 관리자 열람 감사 기록용
  // 열람자의 우선 표준 설정 — 세션 접근에서만 조회 가능 (토큰 접근은 locale 폴백)
  let preferredStandard: "wcag" | "kwcag" | null = null;
  if (token && verifyReportToken(id, token)) {
    db = createAdminClient();
  } else if (token && (await matchesShareToken(id, token))) {
    db = createAdminClient();
  } else {
    // 렌더 스코프 캐시 — 헤더와 getUser 왕복 공유
    const user = await getCachedUser();
    if (!user) redirect(`/${locale}/login`);
    sessionUserId = user.id;
    const supabase = await createClient();
    db = supabase as unknown as SupabaseClient;
    canEdit = true; // RLS 통과 = 소유자 또는 관리자
    // migration 0017 미적용 시 컬럼 부재로 실패 → null 관용
    const { data: pref } = await supabase
      .from("profiles")
      .select("preferred_standard")
      .eq("id", user.id)
      .maybeSingle()
      .then((r) => r, () => ({ data: null }));
    const value = (pref as { preferred_standard?: string } | null)?.preferred_standard;
    if (value === "wcag" || value === "kwcag") preferredStandard = value;
  }

  // select("*")로 조회해 migration 0003 적용 전에도 scope 컬럼 부재로 깨지지 않게 한다
  const { data: scan } = await db.from("scans").select("*").eq("id", id).maybeSingle();
  if (!scan || scan.status !== "done" || !scan.summary) notFound();

  // 세션 열람자가 소유자가 아닌데 RLS를 통과했다 = 관리자 열람 (scans_select_own의 is_admin 경로).
  // 개인정보 처리방침 고지에 따라 감사 로그를 남긴다. best-effort — 실패해도 열람은 진행.
  if (sessionUserId && sessionUserId !== scan.user_id) {
    await logAdminAction(createAdminClient(), sessionUserId, "report.view", scan.user_id as string, {
      url: scan.root_url as string,
    }).catch(() => {});
  }

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

  // 대량·열람자 무관 데이터(페이지·위반 전량)는 (scanId, finished_at) 키로 캐시 —
  // 토글마다 재페치 방지. 소유권은 위 scan 조회(RLS)가 이미 검증하므로 admin 조회 안전.
  const version = String(scan.finished_at ?? scan.created_at ?? "");
  const { pages, findings } = await loadScanBulk(id, version);

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
  // 토큰(공유·PDF) 접근은 읽기 전용이며, 소유자의 다른 시점 검사 이력까지 노출할
  // 이유가 없으므로 로그인 소유자/관리자(canEdit)에게만 전후 비교를 제공한다.
  let compare: CompareData | null = null;
  let compareOptions: { id: string; created_at: string }[] = [];
  if (canEdit) {
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

  return { scan, summary, scope, meta, wcagReviews, kwcagReviews, pages, ruleGroups, compare, compareOptions, canEdit, preferredStandard };
}
