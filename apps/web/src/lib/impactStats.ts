import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { foldHost } from "@/lib/host";

export interface HostSeries {
  firstRate: number;
  lastRate: number;
  count: number;
}

/**
 * 사이트 개선 판정 — **준수율(%)만** 사용한다 (순수 함수, 테스트 대상).
 *
 * 위반 노드 수(lastNodes < firstNodes)는 표본 페이지 수가 줄면 자연 감소해
 * 허위 "개선"으로 집계될 수 있어 제외한다. 준수율은 페이지·항목 단위로 정규화된
 * 지표라 표본 크기 변화에 강건하다. 부동소수 잡음 방지로 +0.1%p 이상만 개선으로 인정.
 * (공적 지표로 쓰이는 수치 — 과대 집계 금지)
 */
export function summarizeImprovement(hosts: Iterable<HostSeries>): {
  improvedSites: number;
  rescannedSites: number;
  avgRateGain: number;
} {
  let improvedSites = 0;
  let rescannedSites = 0;
  let rateGainSum = 0;
  for (const v of hosts) {
    if (v.count < 2) continue;
    rescannedSites += 1;
    const gain = v.lastRate - v.firstRate;
    if (gain >= 0.1) {
      improvedSites += 1;
      rateGainSum += gain;
    }
  }
  return {
    improvedSites,
    rescannedSites,
    avgRateGain: improvedSites === 0 ? 0 : Math.round((rateGainSum / improvedSites) * 10) / 10,
  };
}

export interface ImpactStats {
  scans: number;
  pages: number;
  findings: number;
  sites: number;
  scans30d: number;
  /** 2회 이상 검사한 사이트 중 위반이 줄거나 준수율이 오른 사이트 수 */
  improvedSites: number;
  /** 재검사 사이트 수 (개선 여부 무관) */
  rescannedSites: number;
  /** 개선 사이트들의 평균 준수율 상승(%p) */
  avgRateGain: number;
  github: { stars: number; forks: number } | null;
  /** 저장소 누적 트래픽 (repo_stats 크론 축적분 — migration 0007 전엔 null) */
  traffic: { views: number; uniqueViews: number; clones: number; since: string } | null;
  /** 공유 링크가 켜진 보고서 수 (migration 0012 전엔 0) */
  sharedReports: number;
  /** AI 수정 요청 다운로드 수 (usage_counters — migration 0014 전엔 0) */
  aiFixDownloads: number;
  computedAt: string;
}

/** 임팩트 지표 수집 — impact 페이지와 월간 스냅샷 메일이 공유한다 */
export async function collectImpactStats(): Promise<ImpactStats> {
  const admin = createAdminClient();
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 3600_000).toISOString();

  const [scans, pages, findings, scans30d, scanRows] = await Promise.all([
    admin.from("scans").select("id", { count: "exact", head: true }).eq("status", "done"),
    admin.from("scan_pages").select("id", { count: "exact", head: true }).eq("status", "done"),
    admin.from("findings").select("id", { count: "exact", head: true }),
    admin
      .from("scans")
      .select("id", { count: "exact", head: true })
      .eq("status", "done")
      .gte("created_at", thirtyDaysAgo),
    admin
      .from("scans")
      .select("root_url, created_at, rate:summary->complianceRate")
      .eq("status", "done")
      .order("created_at", { ascending: true })
      .limit(5000),
  ]);

  // 사이트(호스트) 단위 집계 — www/apex를 접어 같은 사이트로 취급(대시보드·배지와 일관)
  const byHost = new Map<string, HostSeries>();
  for (const s of scanRows.data ?? []) {
    let host: string;
    try {
      host = foldHost(new URL(s.root_url as string).hostname);
    } catch {
      continue;
    }
    const rate = typeof s.rate === "number" ? s.rate : Number(s.rate ?? 0);
    const cur = byHost.get(host);
    if (!cur) byHost.set(host, { firstRate: rate, lastRate: rate, count: 1 });
    else {
      cur.lastRate = rate;
      cur.count += 1;
    }
  }
  const { improvedSites, rescannedSites, avgRateGain } = summarizeImprovement(byHost.values());

  // 저장소 누적 트래픽 (repo-stats 크론이 쌓은 일별 데이터 합산 — 테이블 미적용 시 생략)
  let traffic: ImpactStats["traffic"] = null;
  const { data: statRows } = await admin
    .from("repo_stats")
    .select("date, views, unique_views, clones")
    .order("date", { ascending: true })
    .limit(3660)
    .then(
      (r) => r,
      () => ({ data: null }),
    );
  if (statRows && statRows.length > 0) {
    traffic = {
      views: statRows.reduce((sum, r) => sum + (r.views ?? 0), 0),
      uniqueViews: statRows.reduce((sum, r) => sum + (r.unique_views ?? 0), 0),
      clones: statRows.reduce((sum, r) => sum + (r.clones ?? 0), 0),
      since: statRows[0]!.date as string,
    };
  }

  // 오픈소스 지표 (실패해도 페이지는 정상)
  let github: ImpactStats["github"] = null;
  try {
    const res = await fetch("https://api.github.com/repos/IsaacEryn/a11ychk", {
      headers: { accept: "application/vnd.github+json" },
      next: { revalidate: 3600 },
    });
    if (res.ok) {
      const repo = (await res.json()) as { stargazers_count?: number; forks_count?: number };
      github = { stars: repo.stargazers_count ?? 0, forks: repo.forks_count ?? 0 };
    }
  } catch {
    // GitHub API 실패 — 생략
  }

  // 활용 지표 (컬럼/테이블 미적용 시 0으로 폴백)
  const { count: sharedCount } = await admin
    .from("scans")
    .select("id", { count: "exact", head: true })
    .not("share_token", "is", null)
    .then((r) => r, () => ({ count: 0 }));
  const { data: counterRow } = await admin
    .from("usage_counters")
    .select("count")
    .eq("key", "ai_fix_download")
    .maybeSingle()
    .then((r) => r, () => ({ data: null }));

  return {
    scans: scans.count ?? 0,
    pages: pages.count ?? 0,
    findings: findings.count ?? 0,
    sites: byHost.size,
    scans30d: scans30d.count ?? 0,
    improvedSites,
    rescannedSites,
    avgRateGain,
    github,
    traffic,
    sharedReports: sharedCount ?? 0,
    aiFixDownloads: Number(counterRow?.count ?? 0),
    computedAt: new Date().toISOString(),
  };
}

