import { NextResponse } from "next/server";
import { assertPublicHttpUrl } from "@a11ychk/core";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkQuota, getResets, resolveLimits } from "@/lib/quota";
import { runScan } from "@/lib/scan/runScan";

export const maxDuration = 300;

// 한 번의 크론 실행에서 처리할 최대 도메인 수 (함수 시간 제한 보호)
const BATCH = 3;
// 마지막 자동 스캔 이후 최소 간격(시간) — 하루 1회 크론에서 중복 실행 방지
const MIN_INTERVAL_HOURS = 20;

/**
 * 정기 스캔 크론 (Vercel Cron, 하루 1회).
 * auto_scan이 켜진 도메인 중 오래된 것부터 한도 내에서 자동 검사한다.
 * Vercel은 CRON_SECRET 환경변수를 Authorization 헤더로 자동 전송한다.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const authz = request.headers.get("authorization");
  if (!secret || authz !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  const cutoff = new Date(Date.now() - MIN_INTERVAL_HOURS * 3600_000).toISOString();

  const { data: domains } = await admin
    .from("domains")
    .select("id, user_id, hostname, verified, last_auto_scan_at")
    .eq("auto_scan", true)
    .or(`last_auto_scan_at.is.null,last_auto_scan_at.lt.${cutoff}`)
    .order("last_auto_scan_at", { ascending: true, nullsFirst: true })
    .limit(BATCH);

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
      resolveLimits(profile.scan_limit_override),
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
        page_limit: d.verified ? 10 : 5,
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
  }

  return NextResponse.json({ processed: results.length, results });
}
