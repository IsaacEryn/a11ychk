import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

export type QuotaWindow = "daily" | "weekly" | "monthly";
export const QUOTA_WINDOWS: QuotaWindow[] = ["daily", "weekly", "monthly"];

export interface ScanLimits {
  daily: number;
  weekly: number;
  monthly: number;
}

export interface PlanConfig extends ScanLimits {
  /** WCAG-EM 2.0 구조 표본 페이지 수 (무작위 표본은 이의 10%가 추가됨 — Step 3.2) */
  sampleSize: number;
}

/**
 * 요금제(그룹). 추후 유료화 시 사용자를 이 그룹에 배정하고, 그룹별 한도를
 * 여기서 일괄 관리한다. 관리자가 사용자별로 개별 한도를 지정하면 그 값이 우선한다.
 * 요금제 시행은 app_settings의 plans.active로 켜기 전까지 비활성(전원 free).
 */
export const PLANS = {
  // 2026-07-22 개정: 일/주/월 3중 창 + 검사당 표본 페이지 수 (소유 확인 수는 DOMAIN_VERIFY_LIMITS)
  // free/pro/enterprise만 요금제 페이지에 공개 — plus(우수 사용자·파트너 보상)와
  // unlimited(운영자 전용)는 관리자 배정으로만 부여하는 내부 등급.
  free: { daily: 3, weekly: 5, monthly: 10, sampleSize: 5 },
  // plus1/plus2 — 초대·활동으로 자동 달성하는 등급(profiles.earned_plan).
  // 관리자 배정(plan 키) 대상이 아니므로 ASSIGNABLE_PLAN_IDS에서 제외된다.
  plus1: { daily: 5, weekly: 6, monthly: 15, sampleSize: 5 },
  plus2: { daily: 5, weekly: 8, monthly: 20, sampleSize: 8 },
  // plus — 관리자 배정용 내부 등급(한도는 plus2와 동일, 하위 호환 유지)
  plus: { daily: 5, weekly: 8, monthly: 20, sampleSize: 8 },
  pro: { daily: 5, weekly: 10, monthly: 30, sampleSize: 10 },
  enterprise: { daily: 20, weekly: 30, monthly: 100, sampleSize: 20 },
  // 사실상 무제한 — 집계·표시 로직을 단순하게 유지하기 위해 큰 유한값 사용.
  // sampleSize 30 = MAX_PAGES_PER_SCAN(아래 선언 — 선언 순서상 리터럴 사용)과 일치.
  unlimited: { daily: 1000, weekly: 5000, monthly: 20000, sampleSize: 30 },
} as const satisfies Record<string, PlanConfig>;

export type PlanId = keyof typeof PLANS;
export const PLAN_IDS = Object.keys(PLANS) as PlanId[];
export const DEFAULT_PLAN: PlanId = "free";

/** 초대·활동으로 달성하는 등급 (profiles.earned_plan) — plansActive와 무관하게 항상 적용 */
export const EARNED_PLAN_IDS = ["plus1", "plus2"] as const;
export type EarnedPlanId = (typeof EARNED_PLAN_IDS)[number];

/** profiles.earned_plan 값 검증 — 그 외 값(구 'plus' 포함)은 null */
export function getEarnedPlan(value: unknown): EarnedPlanId | null {
  return typeof value === "string" && (EARNED_PLAN_IDS as readonly string[]).includes(value)
    ? (value as EarnedPlanId)
    : null;
}

/** 관리자 배정 select용 등급 목록 — 달성 전용(plus1/plus2)은 제외 */
export const ASSIGNABLE_PLAN_IDS = PLAN_IDS.filter(
  (p) => !(EARNED_PLAN_IDS as readonly string[]).includes(p),
);

/** 등급 서열 (표시·미션 노출 판단용). 배정 등급과 달성 등급 중 높은 쪽이 유효 등급 */
export const PLAN_RANK: Record<PlanId, number> = {
  free: 0,
  plus1: 1,
  plus2: 2,
  plus: 2,
  pro: 3,
  enterprise: 4,
  unlimited: 5,
};

/** 기본 한도 = free 요금제 */
export const DEFAULT_SCAN_LIMITS: ScanLimits = {
  daily: PLANS.free.daily,
  weekly: PLANS.free.weekly,
  monthly: PLANS.free.monthly,
};

/** 소유 확인된 도메인의 free 등급 보너스 표본 수 (현행 동작 유지) */
export const VERIFIED_FREE_SAMPLE_SIZE = 10;

/**
 * 등급(요금제)별 소유 확인 가능한 도메인 수 상한.
 * 실제 요금제 시행(plansActive) 전이라도 관리자가 배정한 등급(getPlan)에 따라 즉시 적용된다
 * — 스캔 횟수 한도와 달리 도메인 소유 확인 수는 등급 자체로 관리(운영 정책). 더 필요하면 관리자 문의.
 */
export const DOMAIN_VERIFY_LIMITS: Record<PlanId, number> = {
  free: 1,
  plus1: 1,
  plus2: 2,
  plus: 2,
  pro: 3,
  enterprise: 10,
  unlimited: 100,
};

/**
 * 사용자가 소유 확인할 수 있는 도메인 수.
 * 우선순위: 관리자 지정 개별 숫자(scan_limit_override.verifiedDomains)
 * > max(배정 등급 기본값, 달성 등급(earned) 기본값 — plansActive 무관 항상 적용).
 */
export function getVerifiedDomainLimit(override: unknown, earned: EarnedPlanId | null = null): number {
  const v = asRecord(override).verifiedDomains;
  if (typeof v === "number" && Number.isInteger(v) && v >= 0) return v;
  const base = DOMAIN_VERIFY_LIMITS[getPlan(override)];
  return earned ? Math.max(base, DOMAIN_VERIFY_LIMITS[earned]) : base;
}

/** 스캔 1회당 절대 최대 표본 페이지 수 (하드 캡) — Vercel 함수 실행 시간 한도 고려 */
export const MAX_PAGES_PER_SCAN = 30;

/**
 * 크롬 확장 검사 등급별 일일 한도 (웹 검사 한도와 분리, 로그인 사용자).
 * 소유 확인 수와 마찬가지로 요금제 시행(plansActive) 여부와 무관하게 배정 등급으로 즉시 적용.
 */
export const EXT_DAILY_LIMITS: Record<PlanId, number> = {
  free: 10,
  plus1: 12,
  plus2: 15,
  plus: 15,
  pro: 20,
  enterprise: 30,
  unlimited: 1000,
};

/** 확장 일일 한도 — 관리자 지정 개별값(scan_limit_override.extDaily) > max(배정, 달성 등급) */
export function getExtDailyLimit(override: unknown, earned: EarnedPlanId | null = null): number {
  const v = asRecord(override).extDaily;
  if (typeof v === "number" && Number.isInteger(v) && v >= 0) return v;
  const base = EXT_DAILY_LIMITS[getPlan(override)];
  return earned ? Math.max(base, EXT_DAILY_LIMITS[earned]) : base;
}

export interface ExtUsageResult {
  ok: boolean;
  used: number;
  limit: number;
  /** 인프라 오류 — 호출자는 429가 아닌 500으로 응답할 것 (fail-closed) */
  error?: boolean;
}

const extDay = () => new Date().toISOString().slice(0, 10);

/** 확장 검사 사용량 조회 전용 (extension_usage — migration 0009). 테이블 미적용 시 0으로 폴백 */
export async function getExtUsage(admin: SupabaseClient, userId: string, limit: number): Promise<ExtUsageResult> {
  try {
    const { data, error } = await admin
      .from("extension_usage")
      .select("count")
      .eq("user_id", userId)
      .eq("day", extDay())
      .maybeSingle();
    if (error) return { ok: true, used: 0, limit }; // 마이그레이션 미적용 — 차단하지 않음
    const used = data?.count ?? 0;
    return { ok: used < limit, used, limit };
  } catch {
    return { ok: true, used: 0, limit };
  }
}

/**
 * 확장 검사 사용량 원자 소비 — increment_ext_usage RPC(migration 0011)로
 * 한도 검사와 증가를 한 문장에서 처리한다 (read-then-write 레이스 없음).
 * 0011 적용 확정 — 예전의 비원자 레거시 폴백은 제거. RPC 오류는 fail-closed.
 */
export async function consumeExtUsage(admin: SupabaseClient, userId: string, limit: number): Promise<ExtUsageResult> {
  try {
    const { data, error } = await admin.rpc("increment_ext_usage", {
      p_user_id: userId,
      p_day: extDay(),
      p_limit: limit,
    });
    if (error) return { ok: false, used: 0, limit, error: true };
    const result = typeof data === "number" ? data : -1;
    if (result < 0) return { ok: false, used: limit, limit };
    return { ok: true, used: result, limit };
  } catch {
    return { ok: false, used: 0, limit, error: true };
  }
}

/** 관리자가 지정한 사용자별 기본 페이지 한도 (scan_limit_override.pages). 없으면 undefined */
export function getCustomPages(override: unknown): number | undefined {
  const v = asRecord(override).pages;
  return typeof v === "number" && Number.isInteger(v) && v >= 1 ? v : undefined;
}

/**
 * 유효 표본 크기(구조 표본). 우선순위:
 * 1. 사용자별 pages override — 소유 확인 도메인은 ×2
 * 2. 요금제 활성 시 배정 요금제의 sampleSize
 * 3. free 기본 — 소유확인 10p / 그 외 5p (현행 유지)
 * 모두 MAX_PAGES_PER_SCAN(30)으로 클램프.
 */
export function getSampleSize(opts: {
  override: unknown;
  verified: boolean;
  plansActive: boolean;
  /** 달성 등급 — plansActive 무관하게 max로 병합 (free 소유확인 10p vs plus1 5p 등은 max가 자연 해결) */
  earned?: EarnedPlanId | null;
}): number {
  const pages = getCustomPages(opts.override);
  let size: number;
  if (pages !== undefined) size = opts.verified ? pages * 2 : pages;
  else {
    if (opts.plansActive) size = PLANS[getPlan(opts.override)].sampleSize;
    else size = opts.verified ? VERIFIED_FREE_SAMPLE_SIZE : PLANS.free.sampleSize;
    if (opts.earned) size = Math.max(size, PLANS[opts.earned].sampleSize);
  }
  return Math.min(size, MAX_PAGES_PER_SCAN);
}

function asRecord(override: unknown): Record<string, unknown> {
  return override && typeof override === "object" ? (override as Record<string, unknown>) : {};
}

export function getPlan(override: unknown): PlanId {
  const p = asRecord(override).plan;
  return typeof p === "string" && (PLAN_IDS as string[]).includes(p) ? (p as PlanId) : DEFAULT_PLAN;
}

/**
 * 최종 한도 계산 (우선순위): 사용자별 개별 숫자 override > 요금제/달성 등급 한도 > 기본값.
 * - 배정 요금제는 plansActive=false(기본)면 무시(free) — 유료화 전 게이트
 * - 달성 등급(earned — 초대·활동 자동 승급)은 plansActive와 무관하게 항상 창별 max로 병합
 * - dailyBonus(초대받은 가입 보너스)는 daily에만 가산 — 단 daily 개별 override가 있으면
 *   관리자 명시값을 존중해 가산하지 않는다
 */
export function resolveLimits(
  override: unknown,
  plansActive = false,
  earned: EarnedPlanId | null = null,
  dailyBonus = 0,
): ScanLimits {
  const o = asRecord(override);
  const plan = plansActive ? PLANS[getPlan(override)] : PLANS.free;
  const base: ScanLimits = { daily: plan.daily, weekly: plan.weekly, monthly: plan.monthly };
  if (earned) {
    const e = PLANS[earned];
    for (const key of QUOTA_WINDOWS) base[key] = Math.max(base[key], e[key]);
  }
  if (dailyBonus > 0) base.daily += dailyBonus;
  for (const key of QUOTA_WINDOWS) {
    const v = o[key];
    if (typeof v === "number" && Number.isFinite(v) && v >= 0) base[key] = v;
  }
  return base;
}

/**
 * 관리자가 한도를 초기화한 시각 (윈도우별).
 * scan_limit_override.{daily,weekly,monthly}ResetAt(ISO). 이 시각 이전의 검사는
 * 해당 윈도우 사용량 집계에서 제외되어 사용자가 즉시 다시 검사할 수 있다.
 */
export function getResets(override: unknown): Partial<Record<QuotaWindow, string>> {
  const o = asRecord(override);
  const out: Partial<Record<QuotaWindow, string>> = {};
  for (const key of QUOTA_WINDOWS) {
    const v = o[`${key}ResetAt`];
    if (typeof v === "string" && !Number.isNaN(Date.parse(v))) out[key] = v;
  }
  return out;
}

/** 사용자별로 명시 지정된 개별 한도(요금제와 별개). 관리자 UI 프리필용 */
export function getCustomLimits(override: unknown): Partial<ScanLimits> {
  const o = asRecord(override);
  const out: Partial<ScanLimits> = {};
  for (const key of QUOTA_WINDOWS) {
    const v = o[key];
    if (typeof v === "number" && Number.isFinite(v) && v >= 0) out[key] = v;
  }
  return out;
}

export interface QuotaResult {
  ok: boolean;
  exceeded?: QuotaWindow;
  used: Record<QuotaWindow, number>;
  limits: ScanLimits;
}

const WINDOW_MS: Record<QuotaWindow, number> = {
  daily: 24 * 3600_000,
  weekly: 7 * 24 * 3600_000,
  monthly: 30 * 24 * 3600_000,
};

/**
 * 자동 수집 페이지 수(사용자 선택)를 한도로 클램프. 미지정이면 한도 최대.
 * 서버가 항상 이 함수를 거치므로 클라이언트 값을 그대로 신뢰하지 않는다.
 */
export function clampRequestedPages(sampleSize: number, requested?: number): number {
  if (requested === undefined || !Number.isFinite(requested)) return sampleSize;
  return Math.max(1, Math.min(sampleSize, Math.floor(requested)));
}

/** 롤링 윈도우 기준 사용량 확인. 각 윈도우는 리셋 시각 이후로만 집계 */
export async function checkQuota(
  admin: SupabaseClient,
  userId: string,
  limits: ScanLimits,
  resets: Partial<Record<QuotaWindow, string>> = {},
): Promise<QuotaResult> {
  const now = Date.now();
  const counts: Record<QuotaWindow, number> = { daily: 0, weekly: 0, monthly: 0 };

  for (const key of QUOTA_WINDOWS) {
    const windowStart = new Date(now - WINDOW_MS[key]).toISOString();
    const reset = resets[key];
    // 롤링 윈도우 시작과 리셋 시각 중 더 나중(=더 짧은 기간)을 하한으로
    const lowerBound = reset && reset > windowStart ? reset : windowStart;
    // 관리자 재검사(admin_retry, 0028)는 사용자 한도에서 제외.
    // 0028 미적용 환경(컬럼 부재)에서는 필터 없이 폴백해 검사 생성이 깨지지 않게 한다.
    let { count, error } = await admin
      .from("scans")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("admin_retry", false)
      .gte("created_at", lowerBound);
    if (error) {
      ({ count, error } = await admin
        .from("scans")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId)
        .gte("created_at", lowerBound));
    }
    if (error) throw new Error(`사용량 조회 실패: ${error.message}`);
    counts[key] = count ?? 0;
  }

  for (const key of QUOTA_WINDOWS) {
    if (counts[key] >= limits[key]) {
      return { ok: false, exceeded: key, used: counts, limits };
    }
  }
  return { ok: true, used: counts, limits };
}
