import { NextResponse } from "next/server";
import { assertPublicHttpUrl } from "@a11ychk/core";
import { createAdminClient } from "@/lib/supabase/admin";
import { drainQueue } from "@/lib/scan/drain";
import { DEFAULT_SCOPE, createScanForUser } from "@/lib/scan/createScan";
import { markReferralValidOnFirstScan } from "@/lib/referral/validate";
import { reevaluateEarnedPlan } from "@/lib/referral/promote";
import { isAuthorizedCron } from "@/lib/cronAuth";
import { FREQUENCY_HOURS, dueIntervalHours } from "@/lib/scan/schedule";

export const maxDuration = 300;

// 한 번의 크론 실행에서 처리할 최대 도메인 수.
// 큐 위임 구조라 도메인당 작업은 DB 쿼리 수 회뿐 — 실행 부하는 claim_scans의
// 전역 동시 상한이 제어하므로 후보 상한(30)에 가깝게 잡아도 안전하다.
// (예전 3은 함수 내 순차 runScan 시절의 보호값 — 도메인 4개만 돼도 하루 주기가 밀렸다)
const BATCH = 20;


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
  // 맛보기 검사 어뷰즈 카운터 — 일 단위라 2일 지난 행은 무의미(개인정보 최소화: 해시도 짧게 보존)
  try {
    const dayCutoff = new Date(Date.now() - 2 * 24 * 3600_000).toISOString().slice(0, 10);
    const { count } = await admin.from("teaser_usage").delete({ count: "exact" }).lt("day", dayCutoff);
    cleaned["teaser_usage"] = count ?? 0;
  } catch {
    // 0025 미적용 환경은 건너뜀
  }

  const results: { hostname: string; status: string }[] = [];

  for (const d of domains ?? []) {
    // 마지막 실행 시각을 먼저 갱신 (동시 크론 중복 방지)
    await admin.from("domains").update({ last_auto_scan_at: new Date().toISOString() }).eq("id", d.id);

    const rootUrl = `https://${d.hostname}/`;
    let url: URL;
    try {
      url = await assertPublicHttpUrl(rootUrl);
    } catch {
      results.push({ hostname: d.hostname, status: "skipped-unreachable" });
      continue;
    }

    // 신규 검사와 동일한 생성 정책 재사용 — 계정 상태·한도·좀비 회수·동시 실행 가드·
    // 도메인 연결(hostname 정확 일치로 같은 domain_id)·표본 크기·scope 저장까지 공통 처리.
    // 예전 직접 insert는 reclaim을 건너뛰고 유니크 충돌 시 last_auto_scan_at만 갱신돼
    // 도메인이 한 주기 통째로 밀렸다(scope도 null로 저장됨).
    const created = await createScanForUser(d.user_id, url, DEFAULT_SCOPE);
    if (created.ok) {
      // 직접 실행하지 않고 큐에 남긴다(queued 상태로 생성됨) — 아래 drainQueue가 전역 상한
      // 내에서 분리 인보케이션으로 소진하고, 회귀 알림은 각 검사 완료 시 run-scan 엔드포인트가
      // sendAutoAlertIfNeeded로 보낸다.
      results.push({ hostname: d.hostname, status: "enqueued" });
      continue;
    }
    const status = created.code.startsWith("quota_")
      ? "skipped-quota"
      : created.code === "blocked"
        ? "skipped-blocked"
        : created.code === "concurrent"
          ? "skipped-concurrent"
          : "failed-create";
    results.push({ hostname: d.hostname, status });
  }

  // 등록한 자동 검사 + 트리거를 놓친 정지 큐를 전역 상한 내에서 소진 시작.
  // 상한 초과분은 각 검사 완료 시 run-scan 엔드포인트의 재드레인이 이어서 처리한다.
  await drainQueue();

  // ── 초대 시스템 일일 보정 (migration 0024 — 미적용 환경은 조용히 건너뜀, best-effort) ──
  const referral = { revalidated: 0, plus2Checked: 0, ipPurged: 0 };
  try {
    // 1) velocity로 미뤄진 pending 재처리 — 이미 검사를 실행한 피초대자만 성립 재시도
    const { data: pendings } = await admin
      .from("referrals")
      .select("invitee_id")
      .eq("status", "pending")
      .not("invitee_id", "is", null)
      .limit(50);
    for (const p of pendings ?? []) {
      const inviteeId = p.invitee_id as string;
      const { count } = await admin
        .from("scans")
        .select("id", { count: "exact", head: true })
        .eq("user_id", inviteeId);
      if ((count ?? 0) > 0) {
        await markReferralValidOnFirstScan(admin, inviteeId);
        referral.revalidated++;
      }
    }

    // 2) plus2 조건 보정 — 훅 누락(레이스·과거 데이터) 대비 일일 재평가
    const { data: publicDomains } = await admin
      .from("domains")
      .select("user_id")
      .eq("verified", true)
      .eq("public_listed", true)
      .limit(200);
    const ownerIds = [...new Set((publicDomains ?? []).map((d) => d.user_id as string))];
    if (ownerIds.length > 0) {
      const { data: owners } = await admin
        .from("profiles")
        .select("id, earned_plan")
        .in("id", ownerIds)
        .or("earned_plan.is.null,earned_plan.eq.plus1");
      for (const o of owners ?? []) {
        await reevaluateEarnedPlan(admin, o.id as string);
        referral.plus2Checked++;
      }
    }

    // 3) 가입 IP 스냅샷 90일 파기 — 판정 근거 보존 기간 종료(개인정보처리방침과 일관)
    const { data: purged } = await admin
      .from("referrals")
      .update({ signup_ip: null })
      .lt("created_at", logCutoff)
      .not("signup_ip", "is", null)
      .select("id");
    referral.ipPurged = purged?.length ?? 0;
  } catch {
    // 테이블 부재(0024 미적용) 등 — 다음 크론에서 재시도
  }

  return NextResponse.json({ processed: results.length, results, cleaned, referral });
}
