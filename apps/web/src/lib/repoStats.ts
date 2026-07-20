import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

const REPO = "IsaacEryn/a11ychk";

interface TrafficPoint {
  timestamp: string;
  count: number;
  uniques: number;
}

export interface RepoStatsResult {
  days: number;
  traffic: boolean;
  stars: number | null;
  forks: number | null;
}

/**
 * GitHub 저장소 통계 수집 — 트래픽(조회·클론)은 최근 14일치를 date 기준 upsert해
 * 히스토리를 무기한 축적하고, 스타·포크는 오늘 날짜 행에 스냅샷한다.
 * 크론과 관리자 수동 새로고침이 공유한다.
 *
 * GITHUB_STATS_TOKEN(Administration read 또는 repo scope)이 없으면 트래픽은
 * 건너뛰고 스타·포크만 기록한다.
 */
export async function collectRepoStats(): Promise<RepoStatsResult> {
  const token = process.env.GITHUB_STATS_TOKEN;
  const headers: Record<string, string> = {
    accept: "application/vnd.github+json",
    "user-agent": "a11ychk-stats",
    ...(token ? { authorization: `Bearer ${token}` } : {}),
  };

  const byDate = new Map<string, { views: number; unique_views: number; clones: number; unique_clones: number }>();
  const row = (date: string) => {
    const cur = byDate.get(date) ?? { views: 0, unique_views: 0, clones: 0, unique_clones: 0 };
    byDate.set(date, cur);
    return cur;
  };

  let traffic = false;
  if (token) {
    try {
      const [viewsRes, clonesRes] = await Promise.all([
        fetch(`https://api.github.com/repos/${REPO}/traffic/views?per=day`, { headers, cache: "no-store" }),
        fetch(`https://api.github.com/repos/${REPO}/traffic/clones?per=day`, { headers, cache: "no-store" }),
      ]);
      if (viewsRes.ok) {
        const data = (await viewsRes.json()) as { views?: TrafficPoint[] };
        for (const p of data.views ?? []) {
          const r = row(p.timestamp.slice(0, 10));
          r.views = p.count;
          r.unique_views = p.uniques;
        }
        traffic = true;
      }
      if (clonesRes.ok) {
        const data = (await clonesRes.json()) as { clones?: TrafficPoint[] };
        for (const p of data.clones ?? []) {
          const r = row(p.timestamp.slice(0, 10));
          r.clones = p.count;
          r.unique_clones = p.uniques;
        }
        traffic = true;
      }
    } catch {
      // 트래픽 수집 실패 — 스타·포크 스냅샷은 계속 진행
    }
  }

  let stars: number | null = null;
  let forks: number | null = null;
  try {
    const repoRes = await fetch(`https://api.github.com/repos/${REPO}`, { headers, cache: "no-store" });
    if (repoRes.ok) {
      const repo = (await repoRes.json()) as { stargazers_count?: number; forks_count?: number };
      stars = repo.stargazers_count ?? null;
      forks = repo.forks_count ?? null;
    }
  } catch {
    // 무시
  }

  const today = new Date().toISOString().slice(0, 10);
  row(today); // 트래픽이 없어도 오늘 행 생성 (스타·포크 스냅샷용)

  const rows = [...byDate.entries()].map(([date, v]) => ({
    date,
    ...v,
    ...(date === today ? { stars, forks } : {}),
    updated_at: new Date().toISOString(),
  }));

  const admin = createAdminClient();
  await admin.from("repo_stats").upsert(rows, { onConflict: "date" });

  return { days: rows.length, traffic, stars, forks };
}
