import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { getDomainPublicScan } from "@/lib/host";
import { gradeOf, DIRECTORY_MIN_RATE, type Grade } from "@/lib/badgeGrade";
import type { ScanSummary } from "@a11ychk/core";

export interface ListedSite {
  hostname: string;
  siteName: string | null;
  rate: number;
  grade: Grade;
  lastScannedAt: string | null;
}

/**
 * 공개 디렉터리에 등재된(opt-in) 사이트 목록.
 * 소유확인 + public_listed 도메인의 최신 완료 검사 준수율을 집계하고,
 * 최소 준수율 미만은 목록에서 보류한다(품질 보증 인상 방지).
 * migration 0018 미적용 환경에서는 빈 목록으로 안전하게 폴백한다.
 */
export async function collectListedSites(): Promise<ListedSite[]> {
  const admin = createAdminClient();
  const { data: domains } = await admin
    .from("domains")
    .select("id, hostname, user_id, public_scan_id")
    .eq("verified", true)
    .eq("public_listed", true)
    .then((r) => r, () => ({ data: null }));

  if (!domains || domains.length === 0) return [];

  const sites: ListedSite[] = [];
  for (const d of domains) {
    // 공개 지정 검사(있으면) 또는 www/apex 무관 최신 완료 검사
    const scan = await getDomainPublicScan<{
      summary: unknown;
      finished_at: string | null;
      title: string | null;
      root_url: string | null;
    }>(
      admin,
      { user_id: d.user_id as string, hostname: d.hostname as string, public_scan_id: d.public_scan_id as string | null },
      "summary, finished_at, root_url, title:report_meta->>title",
    );
    const summary = scan?.summary as ScanSummary | null;
    if (!summary) continue;
    const rate = summary.complianceRate;
    if (rate < DIRECTORY_MIN_RATE) continue; // 임계 미만 보류
    sites.push({
      hostname: d.hostname as string,
      siteName: (scan?.title as string | null) ?? null,
      rate,
      grade: gradeOf(rate),
      lastScannedAt: (scan?.finished_at as string | null) ?? null,
    });
  }
  // 준수율 높은 순
  sites.sort((a, b) => b.rate - a.rate);
  return sites;
}

export interface ListedSiteDetail extends ListedSite {
  /** 검사된 표본 페이지 수 (summary 기준) */
  scannedPages: number | null;
  totalViolations: number;
  /** 자동 검사에서 위반이 걸린 KWCAG 항목 id (매트릭스 순서) — 상세 페이지가 가이드로 연결 */
  failedItemIds: string[];
}

/**
 * 디렉터리 상세(/directory/[hostname])용 단건 조회.
 * 등재 기준은 목록과 동일 — 미등재·소유 미확인·임계 미만이면 null(페이지는 notFound).
 */
export async function getListedSiteDetail(hostname: string): Promise<ListedSiteDetail | null> {
  const admin = createAdminClient();
  const { data: domain } = await admin
    .from("domains")
    .select("id, hostname, user_id, public_scan_id")
    .eq("verified", true)
    .eq("public_listed", true)
    .eq("hostname", hostname)
    .maybeSingle()
    .then((r) => r, () => ({ data: null }));
  if (!domain) return null;

  const scan = await getDomainPublicScan<{
    summary: unknown;
    finished_at: string | null;
    root_url: string | null;
    title: string | null;
  }>(
    admin,
    { user_id: domain.user_id as string, hostname: domain.hostname as string, public_scan_id: domain.public_scan_id as string | null },
    "summary, finished_at, root_url, title:report_meta->>title",
  );
  const summary = scan?.summary as ScanSummary | null;
  if (!summary) return null;
  const rate = summary.complianceRate;
  if (rate < DIRECTORY_MIN_RATE) return null;

  const failedItemIds = (summary.kwcagMatrix ?? [])
    .filter((r) => r.status === "fail")
    .map((r) => r.itemId);
  return {
    hostname: domain.hostname as string,
    siteName: (scan?.title as string | null) ?? null,
    rate,
    grade: gradeOf(rate),
    lastScannedAt: (scan?.finished_at as string | null) ?? null,
    scannedPages: summary.sample
      ? summary.sample.structuredCount + summary.sample.randomCount + summary.sample.processCount
      : null,
    totalViolations: summary.totalViolations,
    failedItemIds,
  };
}
