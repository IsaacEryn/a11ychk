import { NextResponse } from "next/server";
import { assertPublicHttpUrl } from "@a11ychk/core";
import { getRuleEntry, type ScanSummary } from "@a11ychk/core/catalog";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkQuota, getResets, getSampleSize, resolveLimits } from "@/lib/quota";
import { getPlansActive } from "@/lib/appSettings";
import { runScan } from "@/lib/scan/runScan";
import { drainQueue } from "@/lib/scan/drain";
import { sendScanAlert } from "@/lib/notify";
import { isAuthorizedCron } from "@/lib/cronAuth";

export const maxDuration = 300;

// 한 번의 크론 실행에서 처리할 최대 도메인 수 (함수 시간 제한 보호)
const BATCH = 3;

/**
 * 주기별 "검사 실행 간격"(시간). 하루 1회 크론이 이 간격 이상 지난 도메인만 검사한다.
 * 주기보다 살짝 짧게 잡아 드리프트로 하루씩 밀리는 것을 방지(예: weekly는 6.5일 후 검사).
 * 미적용(컬럼 없음)·미지정 도메인은 daily로 폴백.
 */
const FREQUENCY_HOURS: Record<string, number> = {
  daily: 20,
  weekly: 6.5 * 24,
  monthly: 27 * 24,
};
const dueIntervalHours = (freq: unknown): number =>
  FREQUENCY_HOURS[typeof freq === "string" ? freq : "daily"] ?? FREQUENCY_HOURS.daily;

/**
 * 정기 스캔 크론 (Vercel Cron, 하루 1회).
 * auto_scan이 켜진 도메인 중 오래된 것부터 한도 내에서 자동 검사한다.
 * Vercel은 CRON_SECRET 환경변수를 Authorization 헤더로 자동 전송한다.
 */
export async function GET(request: Request) {
  if (!isAuthorizedCron(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  const plansActive = await getPlansActive(admin);
  const now = Date.now();

  // 후보: 최소 간격(daily=20h)을 넘긴 도메인 전부. 주기별(매주·매월) 필터는 아래 JS에서.
  const minCutoff = new Date(now - FREQUENCY_HOURS.daily * 3600_000).toISOString();
  // select * — notify·scan_frequency 컬럼 미적용 환경에서도 조회가 깨지지 않게
  const { data: candidates } = await admin
    .from("domains")
    .select("*")
    .eq("auto_scan", true)
    .or(`last_auto_scan_at.is.null,last_auto_scan_at.lt.${minCutoff}`)
    .order("last_auto_scan_at", { ascending: true, nullsFirst: true })
    .limit(30);

  // 도메인별 주기 간격을 넘긴 것만 실제 대상으로(null=한 번도 안 함=즉시 대상), 오래된 순 BATCH개
  const domains = (candidates ?? [])
    .filter((d) => {
      const last = d.last_auto_scan_at ? new Date(d.last_auto_scan_at as string).getTime() : 0;
      return now - last >= dueIntervalHours(d.scan_frequency) * 3600_000;
    })
    .slice(0, BATCH);

  // ── 로그 보존 정책: 90일 지난 로그인 기록(IP 포함)·서버 오류 삭제 (best-effort) ──
  // 관리자 행위 감사(audit_logs)는 감사 목적상 보존한다.
  const logCutoff = new Date(Date.now() - 90 * 24 * 3600_000).toISOString();
  const cleaned: Record<string, number> = {};
  for (const table of ["login_logs", "app_errors"] as const) {
    try {
      const { count } = await admin.from(table).delete({ count: "exact" }).lt("created_at", logCutoff);
      cleaned[table] = count ?? 0;
    } catch {
      // 테이블 미적용(마이그레이션 전) 환경은 건너뜀
    }
  }

  const results: { hostname: string; status: string }[] = [];

  for (const d of domains ?? []) {
    // 마지막 실행 시각을 먼저 갱신 (동시 크론 중복 방지)
    await admin.from("domains").update({ last_auto_scan_at: new Date().toISOString() }).eq("id", d.id);

    // 사용자 상태·한도 확인
    const { data: profile } = await admin
      .from("profiles")
      .select("blocked, scan_limit_override")
      .eq("id", d.user_id)
      .single();
    if (!profile || profile.blocked) {
      results.push({ hostname: d.hostname, status: "skipped-blocked" });
      continue;
    }
    const quota = await checkQuota(
      admin,
      d.user_id,
      resolveLimits(profile.scan_limit_override, plansActive),
      getResets(profile.scan_limit_override),
    );
    if (!quota.ok) {
      results.push({ hostname: d.hostname, status: "skipped-quota" });
      continue;
    }

    const rootUrl = `https://${d.hostname}/`;
    try {
      await assertPublicHttpUrl(rootUrl);
    } catch {
      results.push({ hostname: d.hostname, status: "skipped-unreachable" });
      continue;
    }

    const { data: scan } = await admin
      .from("scans")
      .insert({
        user_id: d.user_id,
        domain_id: d.id,
        root_url: rootUrl,
        status: "queued",
        page_limit: getSampleSize({ override: profile.scan_limit_override, verified: d.verified, plansActive }),
      })
      .select("id")
      .single();
    if (!scan) {
      results.push({ hostname: d.hostname, status: "failed-create" });
      continue;
    }

    // 순차 실행 (배치가 작아 함수 시간 내 처리)
    await runScan(scan.id);
    results.push({ hostname: d.hostname, status: "scanned" });

    // 회귀 알림 — 직전 완료 검사 대비 준수율 하락 또는 새 위반 발견 시 (best-effort)
    if (d.notify !== false) {
      try {
        await maybeSendAlert(admin, scan.id, d.user_id as string, d.hostname as string, rootUrl);
      } catch {
        // 알림 실패는 스캔 성공에 영향 없음
      }
    }
  }

  // 백스톱: 트리거(생성·완료·좀비회수)를 모두 놓친 정지 큐를 최후로 소진.
  // 트래픽 없는 조용한 큐도 하루 1회 크론이 반드시 흘려보낸다.
  await drainQueue();

  return NextResponse.json({ processed: results.length, results, cleaned });
}

/** 새 검사가 직전 검사보다 나빠졌으면 소유자에게 이메일 알림 */
async function maybeSendAlert(
  admin: ReturnType<typeof createAdminClient>,
  scanId: string,
  userId: string,
  hostname: string,
  rootUrl: string,
): Promise<void> {
  const { data: cur } = await admin.from("scans").select("status, summary, created_at").eq("id", scanId).single();
  const curSummary = (cur?.summary ?? null) as ScanSummary | null;
  if (cur?.status !== "done" || !curSummary) return;

  const { data: prev } = await admin
    .from("scans")
    .select("summary")
    .eq("user_id", userId)
    .eq("root_url", rootUrl)
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

  const { data: userData } = await admin.auth.admin.getUserById(userId);
  const email = userData?.user?.email;
  if (!email) return;

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.a11ychk.com";
  await sendScanAlert({
    to: email,
    hostname,
    prevRate,
    newRate,
    newRules: newRuleIds.map((r) => getRuleEntry(r, []).title.ko),
    reportUrl: `${siteUrl}/ko/scans/${scanId}/report`,
  });
}
