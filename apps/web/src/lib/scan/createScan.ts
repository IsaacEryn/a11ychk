import "server-only";
import type { EvaluationScope } from "@a11ychk/core";
import { createAdminClient } from "@/lib/supabase/admin";
import { QUOTA_WINDOWS, checkQuota, getEarnedPlan, getResets, getSampleSize, resolveLimits, clampRequestedPages } from "@/lib/quota";
import { getPlansActive } from "@/lib/appSettings";
import { foldHost } from "@/lib/host";
import { markReferralValidOnFirstScan } from "@/lib/referral/validate";
import { reclaimStaleScans } from "./reclaimStale";

export type CreateScanResult =
  | { ok: true; id: string }
  | {
      ok: false;
      status: number;
      /** 사용자 노출용 한국어 폴백 (구버전 클라이언트 호환) */
      error: string;
      /** i18n 코드 — 클라이언트가 로케일에 맞게 번역 */
      code: string;
      params?: Record<string, string | number>;
    };

interface CreateScanOptions {
  /** true면 직접 입력 표본이 한도를 초과할 때 잘라내지 않고 오류를 반환 (신규 검사) */
  strictManualLimit?: boolean;
  /**
   * 자동 수집 시 검사할 페이지 수(사용자 선택). 서버가 항상 사용자 한도(getSampleSize)로
   * 클램프하므로 클라이언트 값을 그대로 신뢰하지 않는다. 미지정이면 한도 최대.
   */
  requestedPages?: number;
  /**
   * 관리자 재검사 — 한도 검사(사전·TOCTOU 재검증)를 건너뛰고 scans.admin_retry=true로
   * 기록한다(0028). 사용자 한도 카운트에서 제외되며, done일 때만 사용자에게 노출된다.
   * 차단 계정·동시 실행 가드·유니크 인덱스는 그대로 적용.
   */
  adminRetry?: boolean;
  /** 생성 주체(0029) — 정기 검사 크론만 "scheduled"를 넘긴다. 미지정 = 사용자 직접 실행. */
  source?: "scheduled";
}

/** 한국 기본 접근성 지원 기준 (WCAG-EM 2.0 Step 1.3 프리셋) — 신규 검사·정기 검사 공용 */
export const DEFAULT_BASELINE = [
  "NVDA + Chrome (Windows)",
  "VoiceOver + Safari (macOS/iOS)",
  "센스리더 + Chrome (Windows)",
  "TalkBack + Chrome (Android)",
];

/** scope 미지정 경로(정기 검사 등)의 기본 평가 범위 */
export const DEFAULT_SCOPE: EvaluationScope = {
  conformanceTarget: "AA",
  accessibilitySupportBaseline: DEFAULT_BASELINE,
};

/**
 * 스캔 생성 공통 정책 — 신규 검사와 동일 조건 재검사가 공유한다.
 * 계정 상태·한도·동시 실행을 검증하고 scans 행(queued)을 만든다.
 * (호출자는 성공 시 after(() => runScan(id))로 실행을 예약할 것)
 */
export async function createScanForUser(
  userId: string,
  url: URL,
  scope: EvaluationScope,
  options: CreateScanOptions = {},
): Promise<CreateScanResult> {
  const admin = createAdminClient();

  // 계정 상태·한도
  const { data: profile } = await admin
    .from("profiles")
    .select("blocked, scan_limit_override, earned_plan, referral_daily_bonus")
    .eq("id", userId)
    .single();
  if (!profile || profile.blocked) {
    return { ok: false, status: 403, error: "검사를 실행할 수 없는 계정입니다.", code: "blocked" };
  }
  // 달성 등급·피초대 보너스 — migration 0024 미적용 환경에선 컬럼 부재로 undefined → 기본 동작
  const p = profile as { earned_plan?: unknown; referral_daily_bonus?: unknown };
  const earned = getEarnedPlan(p.earned_plan);
  const dailyBonus = typeof p.referral_daily_bonus === "number" ? p.referral_daily_bonus : 0;

  const plansActive = await getPlansActive(admin);
  // 관리자 재검사는 한도 검사를 건너뛴다(사용자 잔여 횟수 미차감 — checkQuota 카운트에서도 제외됨)
  if (!options.adminRetry) {
    const quota = await checkQuota(
      admin,
      userId,
      resolveLimits(profile.scan_limit_override, plansActive, earned, dailyBonus),
      getResets(profile.scan_limit_override),
    );
    if (!quota.ok) {
      const windowLabel = { daily: "일간", weekly: "주간", monthly: "월간" }[quota.exceeded!];
      return {
        ok: false,
        status: 429,
        error: `${windowLabel} 검사 한도(${quota.limits[quota.exceeded!]}회)를 모두 사용했습니다.`,
        code: `quota_${quota.exceeded!}`,
        params: { limit: quota.limits[quota.exceeded!] },
      };
    }
  }

  // 좀비 검사 회수 — 함수 강제 종료로 running/queued에 멈춘 검사가 있으면 먼저 failed로
  // 정리한다. 이게 없으면 아래 동시 실행 가드·유니크 인덱스가 새 검사를 영구 차단한다.
  await reclaimStaleScans(admin, { userId });

  // 동시 실행 제한 — 사용자당 1건 (빠른 사전 검사; 원자적 보장은 아래
  // 부분 유니크 인덱스 scans_one_active_per_user가 담당 — migration 0011)
  const { count: runningCount } = await admin
    .from("scans")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .in("status", ["queued", "running"]);
  if ((runningCount ?? 0) > 0) {
    return { ok: false, status: 409, error: "이미 진행 중인 검사가 있습니다. 완료 후 다시 시도해 주세요.", code: "concurrent" };
  }

  // 도메인 연결 + 요금제·소유확인 기반 표본 크기.
  // www/apex 무관 매칭 — 등록 도메인(codeslog.com)과 검사 URL(www.codeslog.com)이 어긋나도
  // 같은 사이트로 연결(domain_id·소유확인 보너스 정상 적용). 정확 일치를 우선하고, 없으면 접어서.
  const { data: userDomains } = await admin
    .from("domains")
    .select("id, verified, hostname")
    .eq("user_id", userId);
  const domain =
    (userDomains ?? []).find((x) => x.hostname === url.hostname) ??
    (userDomains ?? []).find((x) => foldHost(x.hostname as string) === foldHost(url.hostname)) ??
    null;

  const sampleSize = getSampleSize({
    earned,
    override: profile.scan_limit_override,
    verified: domain?.verified ?? false,
    plansActive,
  });
  // 자동 수집 페이지 수(사용자 선택) — 항상 사용자 한도로 클램프 (클라이언트 값 불신)
  const pageLimit = clampRequestedPages(sampleSize, options.requestedPages);

  // 직접 입력 표본이 한도를 초과하면: 신규 검사는 명확히 거부, 재검사는 조용히 절단
  if (options.strictManualLimit && scope.manualPages && scope.manualPages.length > pageLimit) {
    const verifyHint = domain?.verified
      ? ""
      : " 도메인 소유를 확인하면 더 많은 페이지를 검사할 수 있습니다.";
    return {
      ok: false,
      status: 400,
      error: `직접 입력한 페이지가 ${scope.manualPages.length}개인데, 이 도메인의 검사 한도는 ${pageLimit}페이지입니다.${verifyHint}`,
      code: domain?.verified ? "manualOverLimit" : "manualOverLimitVerify",
      params: { count: scope.manualPages.length, limit: pageLimit },
    };
  }

  const finalScope: EvaluationScope = {
    ...scope,
    manualPages: scope.manualPages?.slice(0, pageLimit),
  };

  const baseRow = {
    user_id: userId,
    domain_id: domain?.id ?? null,
    root_url: url.toString(),
    status: "queued",
    page_limit: pageLimit,
    scope: finalScope,
    // 관리자 재검사 표식(0028) — 일반 검사는 컬럼 기본값(false)에 맡겨 미적용 환경 호환
    ...(options.adminRetry ? { admin_retry: true } : {}),
  };
  let { data: scan, error: insertError } = await admin
    .from("scans")
    // 생성 주체 표식(0029) — 정기 검사만 scheduled
    .insert({ ...baseRow, ...(options.source ? { source: options.source } : {}) })
    .select("id")
    .single();
  // 0029 미적용 환경에서 크론이 source를 넘기면 컬럼 부재(PGRST204)로 실패 — 표식 없이 재시도
  if (insertError?.code === "PGRST204" && options.source) {
    ({ data: scan, error: insertError } = await admin
      .from("scans")
      .insert(baseRow)
      .select("id")
      .single());
  }
  if (insertError || !scan) {
    // 23505 = 유니크 위반 — 동시 요청이 사전 검사를 함께 통과한 경우(TOCTOU)
    if (insertError?.code === "23505") {
      return { ok: false, status: 409, error: "이미 진행 중인 검사가 있습니다. 완료 후 다시 시도해 주세요.", code: "concurrent" };
    }
    return { ok: false, status: 500, error: "검사 생성에 실패했습니다.", code: "createFailed" };
  }

  // 한도 이중 검증 — 동시 삽입으로 한도를 넘었으면 이번 행을 회수 (TOCTOU 보정).
  // 카운트는 삽입 후 기준이므로 '초과'는 limit을 넘어선 경우다. (관리자 재검사는 한도 무관)
  if (!options.adminRetry) {
    const recheck = await checkQuota(
      admin,
      userId,
      resolveLimits(profile.scan_limit_override, plansActive, earned, dailyBonus),
      getResets(profile.scan_limit_override),
    );
    for (const key of QUOTA_WINDOWS) {
      if (recheck.used[key] > recheck.limits[key]) {
        await admin.from("scans").delete().eq("id", scan.id);
        const windowLabel = { daily: "일간", weekly: "주간", monthly: "월간" }[key];
        return {
          ok: false,
          status: 429,
          error: `${windowLabel} 검사 한도(${recheck.limits[key]}회)를 모두 사용했습니다.`,
          code: `quota_${key}`,
          params: { limit: recheck.limits[key] },
        };
      }
    }
  }

  // 초대 성립 훅 — 이 사용자가 초대받아 가입한 경우 첫 검사 실행으로 성립 전환.
  // TOCTOU 회수(위 recheck) 통과 후라 회수된 검사로는 성립되지 않는다. best-effort·멱등.
  // 관리자 재검사는 사용자의 자발적 검사가 아니므로 성립 트리거에서 제외.
  if (!options.adminRetry) {
    await markReferralValidOnFirstScan(admin, userId);
  }

  return { ok: true, id: scan.id };
}
