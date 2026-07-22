import { NextResponse } from "next/server";
import { z } from "zod";
import { AXE_VERSION, aggregateScan, assertHttpUrl, categorizePage, type PageScanResult } from "@a11ychk/core";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireExtensionUser } from "@/lib/apiAuth";
import { markReferralValidOnFirstScan } from "@/lib/referral/validate";
import { apiError, resolveApiLocale } from "@/lib/apiError";
import { consumeExtUsage, getEarnedPlan, getExtDailyLimit } from "@/lib/quota";
import { reaggregate } from "@/lib/scan/runScan";

// via 컬럼(migration 0009) 존재 여부 — 모듈 스코프 캐시로 요청당 프로브 쿼리 제거
let viaColumnCache: boolean | null = null;
async function hasViaColumn(admin: ReturnType<typeof createAdminClient>): Promise<boolean> {
  if (viaColumnCache !== null) return viaColumnCache;
  const { error } = await admin.from("scan_pages").select("via").limit(1);
  viaColumnCache = !error;
  return viaColumnCache;
}

export const maxDuration = 60;

const NodeSchema = z.object({
  selector: z.string().max(2000),
  html: z.string().max(2000),
  failureSummary: z.string().max(2000).default(""),
});
const FindingSchema = z.object({
  ruleId: z.string().max(200),
  impact: z.enum(["critical", "serious", "moderate", "minor"]),
  tags: z.array(z.string().max(80)).max(50).default([]),
  helpUrl: z.string().max(500).default(""),
  nodes: z.array(NodeSchema).max(50),
});
const PageSchema = z.object({
  url: z.string().min(1).max(2000),
  violations: z.array(FindingSchema).max(300),
  passes: z.array(z.string().max(200)).max(300),
  incomplete: z.array(z.string().max(200)).max(300),
  scannedAt: z.string().max(40),
});
const ReviewSchema = z.object({
  standard: z.enum(["wcag", "kwcag"]),
  itemId: z.string().min(1).max(20),
  outcome: z.enum(["passed", "failed", "cannotTell", "notPresent", "notChecked"]),
  note: z.string().max(2000).default(""),
  pages: z.array(z.string().max(2000)).max(50).optional(),
});
const BodySchema = z.object({
  page: PageSchema,
  manual: z.array(z.string().max(20)).max(60).optional(),
  /** 확장에서 기입한 전문가 판정 → scan_reviews에 반영 */
  reviews: z.array(ReviewSchema).max(60).optional(),
  /** WCAG-EM: 이 페이지가 다단계 프로세스의 한 단계인지 표시 */
  sampleType: z.enum(["structured", "random", "process"]).optional(),
  /**
   * 저장 위치 지정:
   * - "new": 무조건 새 보고서 생성
   * - 스캔 ID: 해당 기존 보고서에 이 페이지를 추가
   * - 생략: 같은 호스트 최근 보고서에 자동 병합(기존 동작, 하위호환)
   */
  target: z.string().max(60).optional(),
});

/** 크롬 확장에서 이미 실행한 단일 페이지 검사 결과를 사용자 계정에 저장 */
export async function POST(request: Request) {
  const locale = resolveApiLocale(request);
  // 1) 인증 + 계정 상태 (공통 헬퍼)
  const auth = await requireExtensionUser(request);
  if (auth instanceof NextResponse) return auth;
  const { admin, user, profile } = auth;

  // 2) 입력 검증
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError(locale, "invalidBody", 400);
  }
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) return apiError(locale, "invalidScanData", 400);

  let url: URL;
  try {
    url = assertHttpUrl(parsed.data.page.url);
  } catch {
    return apiError(locale, "invalidTargetUrl", 400);
  }

  // 3) 확장 한도 — 웹 검사 한도와 분리된 확장 전용 한도.
  //    저장이 서버 자원을 소비하는 지점이므로 여기서 원자적으로 소비한다
  //    (클라이언트가 별도 소비 호출을 생략해도 한도를 우회할 수 없음).
  const extLimit = getExtDailyLimit(profile.scan_limit_override, getEarnedPlan(profile.earned_plan));
  const usage = await consumeExtUsage(admin, user.id, extLimit);
  if (usage.error) {
    return apiError(locale, "usageFailed", 500);
  }
  if (!usage.ok) {
    return apiError(locale, "extQuotaExceeded", 429, { params: { limit: usage.limit } });
  }

  const page = parsed.data.page as PageScanResult;
  const counts: Record<string, number> = { critical: 0, serious: 0, moderate: 0, minor: 0 };
  for (const v of page.violations) counts[v.impact] = (counts[v.impact] ?? 0) + v.nodes.length;
  const nowIso = new Date().toISOString();

  // via 컬럼(migration 0009) 미적용 환경에서도 저장이 깨지지 않도록 조건부 사용
  const viaField = (await hasViaColumn(admin)) ? { via: "extension" } : {};

  const findingRowsFor = (pageRowId: string) =>
    page.violations.flatMap((v) =>
      v.nodes.map((n) => ({
        scan_page_id: pageRowId,
        rule_id: v.ruleId,
        impact: v.impact,
        tags: v.tags,
        help_url: v.helpUrl,
        selector: n.selector,
        html_snippet: n.html,
        failure_summary: n.failureSummary,
      })),
    );

  // 4-a) 저장 위치 결정
  //   - target === "new"     → 병합하지 않고 새 보고서 생성(아래 4-b)
  //   - target === 스캔 ID    → 소유·존재 확인 후 그 보고서에 추가
  //   - target 생략           → 같은 호스트 최근 보고서에 자동 병합(하위호환)
  const requested = parsed.data.target;
  let target: { id: string; root_url: string; created_at: string } | null = null;

  if (requested && requested !== "new") {
    const { data: chosen } = await admin
      .from("scans")
      .select("id, root_url, created_at")
      .eq("id", requested)
      .eq("user_id", user.id)
      .maybeSingle();
    if (!chosen) {
      return apiError(locale, "extReportNotFound", 404);
    }
    target = chosen;
  } else if (!requested) {
    const { data: candidates } = await admin
      .from("scans")
      .select("id, root_url, created_at")
      .eq("user_id", user.id)
      .eq("status", "done")
      .gte("created_at", new Date(Date.now() - 30 * 24 * 3600_000).toISOString())
      .order("created_at", { ascending: false })
      .limit(20);
    target =
      (candidates ?? []).find((s) => {
        try {
          return new URL(s.root_url).hostname === url.hostname;
        } catch {
          return false;
        }
      }) ?? null;
  }

  if (target) {
    // 같은 URL 페이지가 이미 있으면 결과 교체, 없으면 새 페이지 추가
    const { data: existing } = await admin
      .from("scan_pages")
      .select("id")
      .eq("scan_id", target.id)
      .eq("url", page.url)
      .maybeSingle();

    let pageRowId: string | null = null;
    if (existing) {
      await admin.from("findings").delete().eq("scan_page_id", existing.id);
      await admin
        .from("scan_pages")
        .update({
          status: "done",
          error: null,
          ...viaField,
          sample_type: parsed.data.sampleType ?? "structured",
          violation_counts: counts,
          passes: page.passes,
          incomplete: page.incomplete,
          scanned_at: page.scannedAt,
        })
        .eq("id", existing.id);
      pageRowId = existing.id;
    } else {
      const { data: inserted } = await admin
        .from("scan_pages")
        .insert({
          scan_id: target.id,
          url: page.url,
          status: "done",
          ...viaField,
          category: categorizePage(page.url, false),
          sample_type: parsed.data.sampleType ?? "structured",
          violation_counts: counts,
          passes: page.passes,
          incomplete: page.incomplete,
          scanned_at: page.scannedAt,
        })
        .select("id")
        .single();
      pageRowId = inserted?.id ?? null;
    }
    if (!pageRowId) return apiError(locale, "saveFailed", 500);
    if (page.violations.length > 0) await admin.from("findings").insert(findingRowsFor(pageRowId));

    await saveReviews(admin, target.id, parsed.data.reviews);
    // 보고서 요약 재집계 (확장 페이지 + 판정 포함)
    await reaggregate(admin, target.id);
    // 초대 성립 훅 — 확장 검사 저장도 첫 실사용으로 인정 (멱등·best-effort)
    await markReferralValidOnFirstScan(admin, user.id);
    return NextResponse.json({ id: target.id, merged: true, rootUrl: target.root_url }, { status: 201 });
  }

  // 4-b) 기존 보고서 없음 — 단일 페이지 보고서 생성 (확장 검사는 이미 완료 상태)
  const summary = aggregateScan([page], AXE_VERSION);
  const { data: scan, error: scanErr } = await admin
    .from("scans")
    .insert({
      user_id: user.id,
      root_url: url.toString(),
      status: "done",
      page_limit: 1,
      summary,
      created_at: nowIso,
      started_at: nowIso,
      finished_at: nowIso,
    })
    .select("id")
    .single();
  if (scanErr || !scan) return apiError(locale, "saveFailed", 500);

  const { data: pageRow } = await admin
    .from("scan_pages")
    .insert({
      scan_id: scan.id,
      url: page.url,
      status: "done",
      ...viaField,
      category: categorizePage(page.url, true),
      sample_type: parsed.data.sampleType ?? "structured",
      violation_counts: counts,
      passes: page.passes,
      incomplete: page.incomplete,
      scanned_at: page.scannedAt,
    })
    .select("id")
    .single();

  if (pageRow && page.violations.length > 0) {
    await admin.from("findings").insert(findingRowsFor(pageRow.id));
  }

  await saveReviews(admin, scan.id, parsed.data.reviews);
  // 판정이 있으면 summary.scores 갱신을 위해 재집계
  if (parsed.data.reviews && parsed.data.reviews.length > 0) await reaggregate(admin, scan.id);

  // 초대 성립 훅 — 확장 검사 저장도 첫 실사용으로 인정 (멱등·best-effort)
  await markReferralValidOnFirstScan(admin, user.id);

  return NextResponse.json({ id: scan.id, merged: false }, { status: 201 });
}

/** 저장 위치 선택용 — 로그인 사용자의 최근 보고서 목록(같은 호스트 우선) */
export async function GET(request: Request) {
  const auth = await requireExtensionUser(request);
  if (auth instanceof NextResponse) return auth;
  const { admin, user } = auth;

  // 현재 페이지 호스트(있으면) — 같은 사이트 보고서를 상단에 노출하기 위해 전달
  const host = new URL(request.url).searchParams.get("host") ?? "";

  const { data: scans } = await admin
    .from("scans")
    .select("id, root_url, created_at, scan_pages(count)")
    .eq("user_id", user.id)
    .eq("status", "done")
    .order("created_at", { ascending: false })
    .limit(30);

  const reports = (scans ?? []).map((s) => {
    let sameHost = false;
    try {
      sameHost = host !== "" && new URL(s.root_url).hostname === host;
    } catch {
      sameHost = false;
    }
    const pageCount = Array.isArray(s.scan_pages) ? (s.scan_pages[0]?.count ?? 0) : 0;
    return { id: s.id, rootUrl: s.root_url, createdAt: s.created_at, pageCount, sameHost };
  });
  // 같은 호스트를 우선 정렬(그 외는 최신순 유지)
  reports.sort((a, b) => (a.sameHost === b.sameHost ? 0 : a.sameHost ? -1 : 1));

  return NextResponse.json({ reports });
}

/** 확장 전문가 판정을 scan_reviews에 upsert (best-effort) */
async function saveReviews(
  admin: ReturnType<typeof createAdminClient>,
  scanId: string,
  reviews?: z.infer<typeof ReviewSchema>[],
): Promise<void> {
  if (!reviews || reviews.length === 0) return;
  const rows = reviews.map((r) => ({
    scan_id: scanId,
    standard: r.standard,
    item_id: r.itemId,
    outcome: r.outcome,
    note: r.note,
    pages: r.pages && r.pages.length > 0 ? r.pages : null,
    updated_at: new Date().toISOString(),
  }));
  const { error } = await admin.from("scan_reviews").upsert(rows, { onConflict: "scan_id,standard,item_id" });
  if (error && /pages/.test(error.message)) {
    // pages 컬럼 미적용(0010 전) — 컬럼 없이 재시도
    const bare = rows.map((r) => {
      const { pages, ...rest } = r;
      void pages;
      return rest;
    });
    await admin.from("scan_reviews").upsert(bare, { onConflict: "scan_id,standard,item_id" });
  }
}
