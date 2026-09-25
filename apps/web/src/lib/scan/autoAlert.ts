import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getRuleEntry, type ScanSummary } from "@a11ychk/core/catalog";
import { sendScanAlert } from "@/lib/notify";

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

/** 회귀 판정 — 통합 준수율이 0.5%p 넘게 떨어졌거나 직전 검사에 없던 위반 규칙이 생겼으면 회귀 */
export function detectRegression(
  prev: ScanSummary,
  cur: ScanSummary,
): { regressed: boolean; prevRate: number; newRate: number; newRuleIds: string[] } {
  const rateOf = (s: ScanSummary) => s.scores?.combined.rate ?? s.complianceRate;
  const prevRate = rateOf(prev);
  const newRate = rateOf(cur);
  const newRuleIds = Object.keys(cur.byRule ?? {}).filter((r) => !(prev.byRule ?? {})[r]);
  return { regressed: newRate < prevRate - 0.5 || newRuleIds.length > 0, prevRate, newRate, newRuleIds };
}

/**
 * 정기(자동) 검사 회귀 알림 — 완료된 정기 검사가 직전 완료 검사보다 나빠졌으면 소유자에게 메일.
 *
 * 크론은 큐(drainQueue)에 등록만 하므로 완료 시점을 모른다. 검사 실행 인보케이션(run-scan
 * 엔드포인트, 로컬은 drain의 인프로세스 폴백)이 완료 직후 호출한다. 도메인 notify가 꺼져 있으면 보내지 않는다.
 */
export async function sendAutoAlertIfNeeded(admin: SupabaseClient, scanId: string): Promise<void> {
  const { data: cur } = await admin
    .from("scans")
    .select("status, summary, source, domain_id, user_id, root_url, created_at")
    .eq("id", scanId)
    .maybeSingle();
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
    .select("summary")
    .eq("user_id", cur.user_id)
    .eq("root_url", cur.root_url)
    .eq("status", "done")
    .lt("created_at", cur.created_at)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const prevSummary = (prev?.summary ?? null) as ScanSummary | null;
  if (!prevSummary) return; // 첫 검사 — 비교 대상 없음

  const { regressed, prevRate, newRate, newRuleIds } = detectRegression(prevSummary, curSummary);
  if (!regressed) return;

  const { data: userData } = await admin.auth.admin.getUserById(cur.user_id as string);
  const email = userData?.user?.email;
  if (!email) return;

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.a11ychk.com";
  await sendScanAlert({
    to: email,
    hostname: domain.hostname as string,
    prevRate,
    newRate,
    newRules: newRuleIds.map((r) => getRuleEntry(r, []).title.ko),
    reportUrl: `${siteUrl}/ko/scans/${scanId}/report`,
  });
}
