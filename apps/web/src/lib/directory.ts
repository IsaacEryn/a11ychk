import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
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
    .select("id, hostname")
    .eq("verified", true)
    .eq("public_listed", true)
    .then((r) => r, () => ({ data: null }));

  if (!domains || domains.length === 0) return [];

  const sites: ListedSite[] = [];
  for (const d of domains) {
    const { data: scan } = await admin
      .from("scans")
      .select("summary, finished_at, title:report_meta->>title")
      .eq("domain_id", d.id as string)
      .eq("status", "done")
      .order("finished_at", { ascending: false })
      .limit(1)
      .maybeSingle();
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
