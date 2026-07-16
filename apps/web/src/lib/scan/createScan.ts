import "server-only";
import type { EvaluationScope } from "@a11ychk/core";
import { createAdminClient } from "@/lib/supabase/admin";
import { QUOTA_WINDOWS, checkQuota, getResets, getSampleSize, resolveLimits } from "@/lib/quota";
import { getPlansActive } from "@/lib/appSettings";

export type CreateScanResult = { ok: true; id: string } | { ok: false; status: number; error: string };

interface CreateScanOptions {
  /** true면 직접 입력 표본이 한도를 초과할 때 잘라내지 않고 오류를 반환 (신규 검사) */
  strictManualLimit?: boolean;
}

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
    .select("blocked, scan_limit_override")
    .eq("id", userId)
    .single();
  if (!profile || profile.blocked) {
    return { ok: false, status: 403, error: "검사를 실행할 수 없는 계정입니다." };
  }

  const plansActive = await getPlansActive(admin);
  const quota = await checkQuota(
    admin,
    userId,
    resolveLimits(profile.scan_limit_override, plansActive),
    getResets(profile.scan_limit_override),
  );
  if (!quota.ok) {
    const windowLabel = { daily: "일간", weekly: "주간", monthly: "월간" }[quota.exceeded!];
    return {
      ok: false,
      status: 429,
      error: `${windowLabel} 검사 한도(${quota.limits[quota.exceeded!]}회)를 모두 사용했습니다.`,
    };
  }

  // 동시 실행 제한 — 사용자당 1건 (빠른 사전 검사; 원자적 보장은 아래
  // 부분 유니크 인덱스 scans_one_active_per_user가 담당 — migration 0011)
  const { count: runningCount } = await admin
    .from("scans")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .in("status", ["queued", "running"]);
  if ((runningCount ?? 0) > 0) {
    return { ok: false, status: 409, error: "이미 진행 중인 검사가 있습니다. 완료 후 다시 시도해 주세요." };
  }

  // 도메인 연결 + 요금제·소유확인 기반 표본 크기
  const { data: domain } = await admin
    .from("domains")
    .select("id, verified")
    .eq("user_id", userId)
    .eq("hostname", url.hostname)
    .maybeSingle();

  const pageLimit = getSampleSize({
    override: profile.scan_limit_override,
    verified: domain?.verified ?? false,
    plansActive,
  });

  // 직접 입력 표본이 한도를 초과하면: 신규 검사는 명확히 거부, 재검사는 조용히 절단
  if (options.strictManualLimit && scope.manualPages && scope.manualPages.length > pageLimit) {
    const verifyHint = domain?.verified
      ? ""
      : " 도메인 소유를 확인하면 더 많은 페이지를 검사할 수 있습니다.";
    return {
      ok: false,
      status: 400,
      error: `직접 입력한 페이지가 ${scope.manualPages.length}개인데, 이 도메인의 검사 한도는 ${pageLimit}페이지입니다.${verifyHint}`,
    };
  }

  const finalScope: EvaluationScope = {
    ...scope,
    manualPages: scope.manualPages?.slice(0, pageLimit),
  };

  const { data: scan, error: insertError } = await admin
    .from("scans")
    .insert({
      user_id: userId,
      domain_id: domain?.id ?? null,
      root_url: url.toString(),
      status: "queued",
      page_limit: pageLimit,
      scope: finalScope,
    })
    .select("id")
    .single();
  if (insertError || !scan) {
    // 23505 = 유니크 위반 — 동시 요청이 사전 검사를 함께 통과한 경우(TOCTOU)
    if (insertError?.code === "23505") {
      return { ok: false, status: 409, error: "이미 진행 중인 검사가 있습니다. 완료 후 다시 시도해 주세요." };
    }
    return { ok: false, status: 500, error: "검사 생성에 실패했습니다." };
  }

  // 한도 이중 검증 — 동시 삽입으로 한도를 넘었으면 이번 행을 회수 (TOCTOU 보정).
  // 카운트는 삽입 후 기준이므로 '초과'는 limit을 넘어선 경우다.
  const recheck = await checkQuota(
    admin,
    userId,
    resolveLimits(profile.scan_limit_override, plansActive),
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
      };
    }
  }
  return { ok: true, id: scan.id };
}
