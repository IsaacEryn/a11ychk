import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getRuleEntry, type ScanSummary } from "@a11ychk/core/catalog";
import { sendScanAlert } from "@/lib/notify";

/**
 * 정기(자동) 검사 회귀 알림 — 완료된 자동 검사가 직전 완료 검사보다 나빠졌으면 소유자에게 메일.
 *
 * 예전에는 크론이 runScan을 직접 기다린 뒤 호출했지만, 크론이 큐(drainQueue)에 등록만 하도록
 * 바뀌면서 완료 시점을 모르게 됐다. 이제 검사 실행 인보케이션(run-scan 엔드포인트)이 완료 직후
 * 호출한다. **자동 검사만** 대상: 크론 생성 검사는 scope가 null(수동 검사는 항상 scope 보유)이고
 * domain_id가 있으며 도메인 notify가 꺼져 있지 않아야 한다.
 */
export async function sendAutoAlertIfNeeded(admin: SupabaseClient, scanId: string): Promise<void> {
  const { data: cur } = await admin
    .from("scans")
    .select("status, summary, scope, domain_id, user_id, root_url, created_at")
    .eq("id", scanId)
    .maybeSingle();
  const curSummary = (cur?.summary ?? null) as ScanSummary | null;
  if (cur?.status !== "done" || !curSummary) return;
  if (cur.scope !== null || !cur.domain_id) return; // 수동 검사(scope 보유) 또는 도메인 미연결 → 알림 없음

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

  const rateOf = (s: ScanSummary) => s.scores?.combined.rate ?? s.complianceRate;
  const prevRate = rateOf(prevSummary);
  const newRate = rateOf(curSummary);
  const newRuleIds = Object.keys(curSummary.byRule ?? {}).filter((r) => !(prevSummary.byRule ?? {})[r]);
  const regressed = newRate < prevRate - 0.5 || newRuleIds.length > 0;
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
