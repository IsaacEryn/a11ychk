import "server-only";
import { KWCAG_BY_ID, pickLocale, type KwcagMatrixRow } from "@a11ychk/core/catalog";
import type { SupabaseClient } from "@supabase/supabase-js";
import { foldHost } from "@/lib/host";

/**
 * 대시보드 파생 데이터 계산 — 페이지 컴포넌트에서 분리해 테스트·재사용이 가능하게 한다.
 * 원본은 최근 완료 검사(trendRows) 한 벌이고, 여기서 추이·항목 변화·총괄·공개 후보를 함께 뽑는다.
 * 예전에는 같은 배열을 네 번 각각 순회했다.
 */

/** 추이·총괄 계산에 쓰는 최소 필드 (scans에서 점수만 뽑아온 행) */
export interface TrendRow {
  id: string;
  root_url: string;
  created_at: string;
  title: string | null;
  combined: string | null;
  auto: string | null;
  nodes: string | null;
}

export interface ItemChange {
  itemId: string;
  name: string;
  /** 위반 수 변화 (음수 = 개선) */
  delta: number;
}

export interface HostOverview {
  host: string;
  scanId: string;
  date: string;
  rate: number;
  nodes: number;
}

export interface PublicReportOption {
  id: string;
  date: string;
  rate: number;
  title: string | null;
}

export interface DashboardDerived {
  /** 호스트별 준수율 추이 (오래된 순, 최대 12점) */
  trendByHost: Map<string, { date: string; rate: number }[]>;
  /** 호스트별 최신 완료 검사 요약 (호스트명 오름차순) */
  overview: HostOverview[];
  /** 호스트별 공개 보고서 후보 (최신순, 도메인당 15건) */
  reportsByHost: Map<string, PublicReportOption[]>;
  /** 호스트별 최신 2개 검사 id — KWCAG 항목 변화 계산용 */
  latestTwoByHost: Map<string, string[]>;
}

const TREND_POINTS = 12;
const REPORT_OPTIONS_PER_HOST = 15;

/** 등록 도메인(codeslog.com)과 검사 URL(www.codeslog.com)을 잇도록 www.은 접어서 비교 */
function hostOf(rootUrl: string): string | null {
  try {
    return foldHost(new URL(rootUrl).hostname);
  } catch {
    return null; // root_url 파싱 실패 — 해당 행은 건너뜀
  }
}

/** 최근 완료 검사 목록에서 대시보드가 쓰는 파생 자료를 한 번의 순회로 만든다. */
export function deriveDashboard(trendRows: TrendRow[]): DashboardDerived {
  const trendByHost = new Map<string, { date: string; rate: number }[]>();
  const latestByHost = new Map<string, HostOverview>();
  const reportsByHost = new Map<string, PublicReportOption[]>();
  const latestTwoByHost = new Map<string, string[]>();

  // trendRows는 최신순 — 각 호스트에서 먼저 만나는 행이 최신이다.
  for (const row of trendRows) {
    const host = hostOf(row.root_url);
    if (!host) continue;

    // 항목 변화는 점수 유무와 무관하게 최신 2건이 필요하다
    const ids = latestTwoByHost.get(host) ?? [];
    if (ids.length < 2) ids.push(row.id);
    latestTwoByHost.set(host, ids);

    const rate = Number(row.combined ?? row.auto);
    if (!Number.isFinite(rate)) continue;
    const rounded = Math.round(rate * 10) / 10;

    const trend = trendByHost.get(host) ?? [];
    if (trend.length < TREND_POINTS) trend.push({ date: row.created_at, rate: rounded });
    trendByHost.set(host, trend);

    if (!latestByHost.has(host)) {
      latestByHost.set(host, {
        host,
        scanId: row.id,
        date: row.created_at,
        rate: rounded,
        nodes: Number(row.nodes) || 0,
      });
    }

    const reports = reportsByHost.get(host) ?? [];
    if (reports.length < REPORT_OPTIONS_PER_HOST) {
      reports.push({ id: row.id, date: row.created_at, rate: rounded, title: row.title });
    }
    reportsByHost.set(host, reports);
  }

  // 그래프는 오래된 순으로 그린다
  for (const list of trendByHost.values()) list.reverse();

  return {
    trendByHost,
    overview: [...latestByHost.values()].sort((a, b) => a.host.localeCompare(b.host)),
    reportsByHost,
    latestTwoByHost,
  };
}

/** 호스트별 KWCAG 항목 변화 — 최신·직전 검사의 kwcagMatrix를 비교(마이그레이션 불요) */
const MAX_DIFF_HOSTS = 20;
const TOP_CHANGES = 3;

export async function loadItemChanges(
  supabase: SupabaseClient,
  latestTwoByHost: Map<string, string[]>,
  locale: string,
): Promise<Map<string, { improved: ItemChange[]; worsened: ItemChange[] }>> {
  const result = new Map<string, { improved: ItemChange[]; worsened: ItemChange[] }>();
  const pairHosts = [...latestTwoByHost.entries()]
    .filter(([, ids]) => ids.length === 2)
    .slice(0, MAX_DIFF_HOSTS);
  if (pairHosts.length === 0) return result;

  const { data: matrixRows } = await supabase
    .from("scans")
    .select("id, matrix:summary->kwcagMatrix")
    .in("id", pairHosts.flatMap(([, ids]) => ids));
  const matrixById = new Map((matrixRows ?? []).map((r) => [r.id as string, r.matrix]));

  const countsOf = (scanId: string): Map<string, number> | null => {
    const rows = matrixById.get(scanId);
    if (!Array.isArray(rows)) return null; // 구버전 스캔 — kwcagMatrix 부재
    return new Map((rows as unknown as KwcagMatrixRow[]).map((r) => [r.itemId, r.violationCount ?? 0]));
  };

  for (const [host, [latestId, prevId]] of pairHosts) {
    const latest = countsOf(latestId!);
    const prev = countsOf(prevId!);
    if (!latest || !prev) continue;
    const changes: ItemChange[] = [];
    for (const [itemId, count] of latest) {
      const delta = count - (prev.get(itemId) ?? 0);
      if (delta === 0) continue;
      const item = KWCAG_BY_ID.get(itemId);
      changes.push({ itemId, name: item ? pickLocale(item.name, locale) : itemId, delta });
    }
    if (changes.length === 0) continue;
    result.set(host, {
      improved: changes.filter((c) => c.delta < 0).sort((a, b) => a.delta - b.delta).slice(0, TOP_CHANGES),
      worsened: changes.filter((c) => c.delta > 0).sort((a, b) => b.delta - a.delta).slice(0, TOP_CHANGES),
    });
  }
  return result;
}
