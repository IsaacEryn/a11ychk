import { NextResponse } from "next/server";
import { assertPublicHttpUrl } from "@a11ychk/core";
import { createAdminClient } from "@/lib/supabase/admin";
import { drainQueue } from "@/lib/scan/drain";
import { reclaimStaleScans } from "@/lib/scan/reclaimStale";
import { DEFAULT_SCOPE, createScanForUser } from "@/lib/scan/createScan";
import { markReferralValidOnFirstScan } from "@/lib/referral/validate";
import { reevaluateEarnedPlan } from "@/lib/referral/promote";
import { isAuthorizedCron } from "@/lib/cronAuth";
import { logAppError } from "@/lib/logs";
import { CRON_STALE_HOURS, isCronStale, lastCronOkAt, withCronRun } from "@/lib/cronRun";
import { sendCronStaleAlert } from "@/lib/notify";
import {
  FREQUENCY_HOURS,
  pickScheduledDomains,
  retryNextDayAt,
  type ScheduleCandidate,
} from "@/lib/scan/schedule";

export const maxDuration = 300;

// 한 번의 크론 실행에서 처리할 최대 도메인 수.
// 큐 위임 구조라 도메인당 작업은 DB 쿼리 수 회뿐 — 실행 부하는 claim_scans의
// 전역 동시 상한이 제어한다. 계정당 1개라 하루 최대 BATCH개 계정이 정기 검사를 받는다.
// (예전 3은 함수 내 순차 runScan 시절의 보호값 — 도메인 4개만 돼도 하루 주기가 밀렸다)
const BATCH = 20;
/** 폴백 경로(0038 미적용)의 후보 조회 창 — 계정당 1개로 줄이기 전의 행 수 */
const CANDIDATE_WINDOW = 500;


/**
 * 정기 스캔 크론 (Vercel Cron, 하루 1회).
 * auto_scan이 켜진 도메인 중 오래된 것부터 한도 내에서 자동 검사한다.
 * Vercel은 CRON_SECRET 환경변수를 Authorization 헤더로 자동 전송한다.
 */
export async function GET(request: Request) {
  if (!isAuthorizedCron(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  // 실행 기록(0030) — 성공/실패/요약을 cron_runs에 남기고, 미처리 예외는 기록 후 재던져
  // 크론 실패로 표면화한다. 본문은 runScheduledScans로 분리.
  const summary = await withCronRun("scheduled-scans", runScheduledScans);
  return NextResponse.json(summary);
}

async function runScheduledScans(): Promise<Record<string, unknown>> {
  const admin = createAdminClient();
  const now = Date.now();

  // 전역 좀비 회수 백스톱 — reclaimStale은 평소 검사 생성·상태조회(사용자/검사 단위)로만
  // 호출되므로, 소유자가 다시 접속하지 않는 다른 사용자의 좀비는 회수되지 못한다. 일일 크론에서
  // 사용자 무관 전역 회수를 돌려 running/queued에 영구히 멈춘 검사를 매일 정리한다.
  const reclaimed = await reclaimStaleScans(admin, {});

  // 후보: 주기별 기한이 지난 소유 확인 도메인, 계정당 1개, 기한을 가장 많이 넘긴 순(pickScheduledDomains).
  // 소유 확인 도메인만 — 남의 사이트를 매일 자동 크롤하지 않는다. 정기 검사는 사용자 한도를 쓰지
  // 않지만(createScanForUser의 skipQuota) 사용자당 활성 검사 1건 가드 때문에 계정당 하루 1건이 상한이다.
  // 예전에 미확인 상태로 켜 둔 도메인은 소유 확인 전까지 건너뛴다(pausedUnverified로 집계).
  // 1순위: 0038 RPC가 SQL에서 기한 판정·계정 중복 제거까지 해서 BATCH개만 준다(창 포화 없음).
  // 폴백(0038 미적용): 20h 지난 행을 오래된 순으로 창만큼 가져와 JS에서 고른다 — 한 계정의 형제나
  // 기한 전 주간·월간 도메인이 창을 채우면 다른 계정이 밀리므로, 창이 차면 기록을 남긴다.
  type Candidate = ScheduleCandidate & { hostname: string } & Record<string, unknown>;
  let domains: Candidate[];
  // 기한이 됐지만 이번에 못 고른 수 — RPC 경로는 BATCH개만 받아 알 수 없으므로 null
  let deferred: number | null = null;
  let candidateWindowFull = false;
  const rpc = await admin.rpc("scheduled_scan_candidates", { p_limit: BATCH });
  if (!rpc.error) {
    domains = (rpc.data ?? []) as Candidate[];
  } else {
    const minCutoff = new Date(now - FREQUENCY_HOURS.daily * 3600_000).toISOString();
    // select * — notify·scan_frequency 컬럼 미적용 환경에서도 조회가 깨지지 않게
    const { data: candidates } = await admin
      .from("domains")
      .select("*")
      .eq("auto_scan", true)
      .eq("verified", true)
      .or(`last_auto_scan_at.is.null,last_auto_scan_at.lt.${minCutoff}`)
      .order("last_auto_scan_at", { ascending: true, nullsFirst: true })
      .limit(CANDIDATE_WINDOW);
    candidateWindowFull = (candidates?.length ?? 0) >= CANDIDATE_WINDOW;
    if (candidateWindowFull) {
      await logAppError(admin, `scheduled-scans candidate window full (${CANDIDATE_WINDOW}) — apply 0038`, {
        path: "cron.scheduled-scans",
      });
    }
    ({ picked: domains, deferred } = pickScheduledDomains((candidates ?? []) as Candidate[], now, BATCH));
  }
  const { count: pausedUnverified } = await admin
    .from("domains")
    .select("id", { count: "exact", head: true })
    .eq("auto_scan", true)
    .eq("verified", false);

  // ── 로그 보존 정책: 90일 지난 로그인 기록(IP 포함)·서버 오류 삭제 (best-effort) ──
  // 관리자 행위 감사(audit_logs)는 감사 목적상 보존한다.
  const logCutoff = new Date(Date.now() - 90 * 24 * 3600_000).toISOString();
  const cleaned: Record<string, number> = {};
  // supabase-js는 쿼리 실패를 throw하지 않고 { error }로 돌려준다 — try/catch가 아니라
  // error를 직접 봐야 삭제 실패가 "0건 삭제"로 위장되지 않는다(보존 정책 미이행이 무증상이 된다).
  for (const table of ["login_logs", "app_errors", "cron_runs"] as const) {
    const { count, error } = await admin.from(table).delete({ count: "exact" }).lt("created_at", logCutoff);
    if (error) {
      // 정리 실패는 크론을 멈추지 않되, 무증상이 되지 않게 기록
      await logAppError(admin, `log cleanup failed: ${table}: ${error.message.slice(0, 300)}`, {
        path: "cron.scheduled-scans",
      });
      continue;
    }
    cleaned[table] = count ?? 0;
  }
  // 맛보기 검사 어뷰즈 카운터 — 일 단위라 2일 지난 행은 무의미(개인정보 최소화: 해시도 짧게 보존)
  {
    const dayCutoff = new Date(Date.now() - 2 * 24 * 3600_000).toISOString().slice(0, 10);
    const { count, error } = await admin.from("teaser_usage").delete({ count: "exact" }).lt("day", dayCutoff);
    if (error) {
      await logAppError(admin, `teaser_usage cleanup failed: ${error.message.slice(0, 300)}`, {
        path: "cron.scheduled-scans",
      });
    } else {
      cleaned["teaser_usage"] = count ?? 0;
    }
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
      // 일시적 DNS 실패일 수 있어 다음 날 다시 — 기한 초과 시간 순이라 영구 불가 도메인도
      // 오래 밀린 다른 도메인을 앞지르지 않는다
      await admin
        .from("domains")
        .update({ last_auto_scan_at: retryNextDayAt(d.scan_frequency, now) })
        .eq("id", d.id);
      results.push({ hostname: d.hostname, status: "skipped-unreachable" });
      continue;
    }

    // 신규 검사와 동일한 생성 정책 재사용 — 계정 상태·한도·좀비 회수·동시 실행 가드·
    // 도메인 연결(hostname 정확 일치로 같은 domain_id)·표본 크기·scope 저장까지 공통 처리.
    // 예전 직접 insert는 reclaim을 건너뛰고 유니크 충돌 시 last_auto_scan_at만 갱신돼
    // 도메인이 한 주기 통째로 밀렸다(scope도 null로 저장됨).
    // 도메인에 지정된 제외 경로(0032)를 정기 검사 표본에서 뺀다 (컬럼 미적용 환경은 undefined → 무시)
    const excludePaths = Array.isArray(d.excluded_paths) ? (d.excluded_paths as string[]) : [];
    const scheduledScope = excludePaths.length > 0 ? { ...DEFAULT_SCOPE, excludePatterns: excludePaths } : DEFAULT_SCOPE;
    const created = await createScanForUser(d.user_id, url, scheduledScope, { source: "scheduled" });
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
    // 일시적인 이유(사용자가 마침 수동 검사를 돌리는 중·생성 실패)로 못 만들었으면 위에서 당겨 둔
    // 실행 시각을 다음 날 다시 잡히는 값으로 고친다 — 그대로 두면 주간·월간 도메인은 한 주기를
    // 통째로 건너뛴다.
    if (status === "skipped-concurrent" || status === "failed-create") {
      await admin
        .from("domains")
        .update({ last_auto_scan_at: retryNextDayAt(d.scan_frequency, now) })
        .eq("id", d.id);
    }
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
  } catch (e) {
    // 다음 크론이 자연 재시도하지만, 어느 단계 실패인지 알 수 있게 기록 (진행 카운터 포함)
    await logAppError(
      admin,
      `referral daily correction failed after ${JSON.stringify(referral)}: ${String(e).slice(0, 300)}`,
      { path: "cron.scheduled-scans" },
    );
  }

  // ── 상호 감시: repo-stats·billing 크론이 26h 넘게 성공 기록이 없으면 관리자에게 경보 ──
  // (이 크론은 repo-stats 쪽이 지켜본다. 모두 죽으면 대시보드가 마지막 안전망)
  // billing은 결제 모드가 off여도 실행 기록을 남기므로 멈춤과 꺼짐을 구분할 수 있다
  for (const job of ["repo-stats", "billing"] as const) {
    try {
      const lastOk = await lastCronOkAt(admin, job);
      if (isCronStale(lastOk, CRON_STALE_HOURS)) await sendCronStaleAlert(job, lastOk);
    } catch {
      // 감시 실패가 본 작업을 막지 않게 — 0030 미적용 환경 포함
    }
  }

  // 운영 지표 — 상태별 합계, 소유 확인 전이라 멈춘 도메인 수, 기한이 됐지만 이번에 못 고른 수
  // (계정당 1개·배치 상한). 호스트별 results만으로는 멈춤·적체가 안 보였다.
  const counts: Record<string, number> = {};
  for (const r of results) counts[r.status] = (counts[r.status] ?? 0) + 1;
  return {
    processed: results.length,
    counts,
    pausedUnverified: pausedUnverified ?? 0,
    deferred,
    candidateWindowFull,
    results,
    cleaned,
    referral,
    reclaimed,
  };
}
