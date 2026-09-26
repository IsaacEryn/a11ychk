import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getRuleEntry, type ScanSummary } from "@a11ychk/core/catalog";
import { sendScanAlert } from "@/lib/notify";
import { mailLocale } from "@/lib/profileLocale";
import { logAppError } from "@/lib/logs";

/** 회귀 알림 판정에 필요한 검사 행 필드 */
export interface AlertScanRow {
  status: string | null;
  source?: string | null;
  domain_id: string | null;
}

/**
 * 알림 대상 검사인가 — 완료된 **정기 검사**(source='scheduled', 0029)이고 도메인에 연결돼 있어야 한다.
 *
 * 예전에는 "scope가 null이면 크론 생성"으로 판별했지만, 크론이 createScanForUser로 DEFAULT_SCOPE를
 * 저장하게 바뀐 뒤(2026-07-22)로는 정기 검사도 항상 scope를 가져 알림이 한 통도 나가지 않았다.
 * 생성 주체는 scope 유무 같은 부수 효과가 아니라 source 컬럼으로만 판별한다.
 */
export function isAlertCandidate(scan: AlertScanRow | null | undefined): boolean {
  return scan?.status === "done" && scan.source === "scheduled" && !!scan.domain_id;
}

/**
 * 회귀 판정 — 자동 준수율이 0.5%p 넘게 떨어졌거나 직전 검사에 없던 위반 규칙이 생겼으면 회귀.
 *
 * 비교가 공정할 때만 판정한다(아니면 오경보가 알림 전체의 신뢰를 깎는다).
 * - 준수율은 통합이 아니라 자동 준수율 — 점검자 판정 유무만으로 오르내리지 않게.
 *   어느 한쪽이 자동 평가 0건이거나 scores가 없는 옛 요약이면 준수율 비교는 건너뛴다.
 * - 신규 위반 규칙은 표본 조건(페이지 수·범위·제외 규칙)이 같을 때만 본다 — 표본이 다르면
 *   처음 보는 페이지의 규칙이 "새 위반"으로 잡힌다. 모범 사례 권고(준수율 밖)는 제외.
 */
export function detectRegression(
  prev: ScanSummary,
  cur: ScanSummary,
  opts: { sameSample: boolean } = { sameSample: true },
): { regressed: boolean; prevRate: number; newRate: number; newRuleIds: string[]; rateCompared: boolean } {
  const rateOf = (s: ScanSummary) => s.scores?.automated.rate ?? s.complianceRate;
  const prevRate = rateOf(prev);
  const newRate = rateOf(cur);
  const comparableRate =
    !!prev.scores && !!cur.scores && prev.scores.automated.evaluated > 0 && cur.scores.automated.evaluated > 0;
  const bestPractice = new Set((cur.bestPractice ?? []).map((b) => b.ruleId));
  const newRuleIds = opts.sameSample
    ? Object.keys(cur.byRule ?? {}).filter((r) => !(prev.byRule ?? {})[r] && !bestPractice.has(r))
    : [];
  const rateDropped = comparableRate && newRate < prevRate - 0.5;
  return {
    regressed: rateDropped || newRuleIds.length > 0,
    prevRate,
    newRate,
    newRuleIds,
    rateCompared: comparableRate,
  };
}

/** 표본 조건 비교용 — 페이지 수·평가 범위(제외 경로 포함)·제외 규칙이 같으면 같은 표본 조건 */
export function sampleKey(row: { page_limit?: unknown; scope?: unknown; summary?: unknown }): string {
  const excluded = ((row.summary as { excludedRules?: string[] } | null)?.excludedRules ?? []).slice().sort();
  return JSON.stringify([row.page_limit ?? null, row.scope ?? null, excluded]);
}

/** 표본의 모든 페이지를 끝까지 검사했는가 — 시간 초과로 일부만 끝난 검사와 비교하면 가짜 "새 위반"이 나온다 */
export function isCompleteScan(summary: ScanSummary | null | undefined): boolean {
  return !!summary && summary.scannedPageCount >= summary.pageCount;
}

/**
 * 정기(자동) 검사 회귀 알림 — 완료된 정기 검사가 같은 도메인의 직전 정기 검사보다 나빠졌으면 소유자에게 메일.
 *
 * 크론은 큐(drainQueue)에 등록만 하므로 완료 시점을 모른다. 검사 실행 인보케이션(run-scan
 * 엔드포인트, 로컬은 drain의 인프로세스 폴백)이 완료 직후 호출한다. 도메인 notify가 꺼져 있으면 보내지 않는다.
 * 비교 대상을 직전 정기 검사로 한정하는 이유: 사용자가 페이지 몇 개만 직접 지정해 돌린 검사나
 * 점검자 판정이 들어간 검사와 비교하면 표본·점수 정의가 달라 가짜 회귀가 나온다.
 */
export async function sendAutoAlertIfNeeded(admin: SupabaseClient, scanId: string): Promise<void> {
  const { data: cur, error: curErr } = await admin
    .from("scans")
    .select("status, summary, source, domain_id, user_id, created_at, page_limit, scope")
    .eq("id", scanId)
    .maybeSingle();
  if (curErr) {
    // source 컬럼(0029)이 없으면 여기서 실패하고 알림이 영구히 멈춘다 — 무음이면 모르고 지나간다
    await logAppError(admin, `auto alert lookup failed: ${curErr.message.slice(0, 200)}`, { path: "autoAlert" });
    return;
  }
  const curSummary = (cur?.summary ?? null) as ScanSummary | null;
  if (!cur || !isAlertCandidate(cur) || !curSummary) return;

  const { data: domain } = await admin
    .from("domains")
    .select("hostname, notify")
    .eq("id", cur.domain_id)
    .maybeSingle();
  if (!domain || domain.notify === false) return;

  const { data: prev } = await admin
    .from("scans")
    .select("summary, page_limit, scope")
    .eq("domain_id", cur.domain_id)
    .eq("source", "scheduled")
    .eq("status", "done")
    .lt("created_at", cur.created_at)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const prevSummary = (prev?.summary ?? null) as ScanSummary | null;
  if (!prevSummary) return; // 첫 검사 — 비교 대상 없음

  const { regressed, prevRate, newRate, newRuleIds, rateCompared } = detectRegression(prevSummary, curSummary, {
    sameSample:
      sampleKey(prev ?? {}) === sampleKey(cur) && isCompleteScan(prevSummary) && isCompleteScan(curSummary),
  });
  if (!regressed) return;

  const { data: userData } = await admin.auth.admin.getUserById(cur.user_id as string);
  const email = userData?.user?.email;
  if (!email) return;
  const { data: owner } = await admin.from("profiles").select("locale").eq("id", cur.user_id).maybeSingle();
  const locale = mailLocale(owner?.locale);

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.a11ychk.com";
  await sendScanAlert({
    to: email,
    hostname: domain.hostname as string,
    prevRate,
    newRate,
    newRules: newRuleIds.map((r) => {
      const title = getRuleEntry(r, []).title;
      return title[locale] ?? title.ko;
    }),
    reportUrl: `${siteUrl}/${locale}/scans/${scanId}/report`,
    locale,
    rateCompared,
  });
}
