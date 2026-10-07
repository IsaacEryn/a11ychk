import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { logAppError } from "@/lib/logs";

export type QuotaWindow = "daily" | "weekly" | "monthly";
export const QUOTA_WINDOWS: QuotaWindow[] = ["daily", "weekly", "monthly"];

export interface ScanLimits {
  daily: number;
  weekly: number;
  monthly: number;
}

/**
 * 등급(요금제) 목록. 한도 수치는 아래 TIERS가 단일 소스다. 관리자가 사용자별로 개별 한도를
 * 지정하면 그 값이 우선한다(lib/entitlements.ts가 합산).
 * free/pro/enterprise만 요금제 페이지에 공개 — plus(우수 사용자·파트너 보상)와
 * unlimited(운영자 전용)는 관리자 배정으로만 부여하는 내부 등급이고, plus1/plus2는
 * 초대·활동으로 자동 달성하는 등급(profiles.earned_plan)이라 관리자 배정 대상이 아니다.
 */
export const PLAN_IDS = ["free", "plus1", "plus2", "plus", "pro", "enterprise", "unlimited"] as const;
export type PlanId = (typeof PLAN_IDS)[number];
export const DEFAULT_PLAN: PlanId = "free";

/** 초대·활동으로 달성하는 등급 (profiles.earned_plan) */
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

/**
 * 등급별 한도 — 한 등급의 모든 한도를 한 행에 둔다. 실효 한도는 lib/entitlements.ts가
 * 근거(free·초대 등급·관리자 배정)별 행을 필드마다 최댓값으로 합쳐 계산한다.
 * free 행이 바닥이므로 어떤 등급도 free보다 낮은 값을 가지면 안 된다(테스트로 고정).
 * 표본은 미확인/소유 확인 도메인을 따로 둔다 — 소유 확인 도메인은 더 많이 검사할 수 있다.
 */
export interface TierLimits extends ScanLimits {
  /** 소유 확인 전 도메인의 검사당 구조 표본 페이지 수 */
  sampleUnverified: number;
  /** 소유 확인 도메인의 검사당 구조 표본 페이지 수 */
  sampleVerified: number;
  /** 소유 확인할 수 있는 도메인 수 */
  verifiedDomains: number;
  /** 크롬 확장 검사 일일 한도 */
  extDaily: number;
  /** 검사 옵션 프리셋 저장 개수 */
  presets: number;
}

export const TIER_LIMIT_KEYS = [
  "daily",
  "weekly",
  "monthly",
  "sampleUnverified",
  "sampleVerified",
  "verifiedDomains",
  "extDaily",
  "presets",
] as const satisfies readonly (keyof TierLimits)[];

export const TIERS: Record<PlanId, TierLimits> = {
  free: { daily: 3, weekly: 5, monthly: 10, sampleUnverified: 5, sampleVerified: 10, verifiedDomains: 1, extDaily: 10, presets: 3 },
  plus1: { daily: 5, weekly: 6, monthly: 15, sampleUnverified: 5, sampleVerified: 10, verifiedDomains: 1, extDaily: 12, presets: 20 },
  plus2: { daily: 5, weekly: 8, monthly: 20, sampleUnverified: 8, sampleVerified: 10, verifiedDomains: 2, extDaily: 15, presets: 20 },
  plus: { daily: 5, weekly: 8, monthly: 20, sampleUnverified: 8, sampleVerified: 10, verifiedDomains: 2, extDaily: 15, presets: 20 },
  pro: { daily: 5, weekly: 10, monthly: 30, sampleUnverified: 10, sampleVerified: 20, verifiedDomains: 3, extDaily: 20, presets: 20 },
  enterprise: { daily: 20, weekly: 30, monthly: 100, sampleUnverified: 20, sampleVerified: 30, verifiedDomains: 10, extDaily: 30, presets: 20 },
  // 사실상 무제한 — 집계·표시 로직을 단순하게 유지하기 위해 큰 유한값 사용
  unlimited: { daily: 1000, weekly: 5000, monthly: 20000, sampleUnverified: 30, sampleVerified: 30, verifiedDomains: 100, extDaily: 1000, presets: 20 },
};

/** 스캔 1회당 절대 최대 표본 페이지 수 (하드 캡) — Vercel 함수 실행 시간 한도 고려 */
export const MAX_PAGES_PER_SCAN = 30;

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

/** 관리자 지정 정수 개별값(0 이상) — 소유 확인 도메인 수·확장 일일 한도. 기한이 지나면 undefined */
export function getCustomInt(override: unknown, key: "verifiedDomains" | "extDaily"): number | undefined {
  const v = asRecord(override)[key];
  return typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : undefined;
}

/** 관리자 배정의 적용 기한(scan_limit_override.until, ISO). 없으면 undefined — 관리자 UI 프리필용 */
export function getOverrideUntil(override: unknown): string | undefined {
  const v = override && typeof override === "object" ? (override as Record<string, unknown>).until : undefined;
  return typeof v === "string" && !Number.isNaN(Date.parse(v)) ? v : undefined;
}

/** 배정 기한이 지났는지 — 한시 증량(문의 대응)을 되돌리는 걸 사람이 기억하지 않아도 되게 */
export function isOverrideExpired(override: unknown, now = Date.now()): boolean {
  const until = getOverrideUntil(override);
  return until !== undefined && Date.parse(until) < now;
}

/**
 * override 접근자 — 모든 한도 계산이 이 함수를 거치므로 기한 만료도 여기서 한 번만 처리한다.
 * 만료되면 요금제·개별 숫자는 무시하고 `*ResetAt`(한도 초기화 시각)만 남긴다 — 그건 배정이
 * 아니라 사용량 집계 기준이라 기한과 무관하다. 저장값은 건드리지 않아 관리자 화면에서 "만료됨"으로 보인다.
 */
function asRecord(override: unknown): Record<string, unknown> {
  if (!override || typeof override !== "object") return {};
  const o = override as Record<string, unknown>;
  if (!isOverrideExpired(o)) return o;
  return Object.fromEntries(Object.entries(o).filter(([k]) => k.endsWith("ResetAt")));
}

export function getPlan(override: unknown): PlanId {
  const p = asRecord(override).plan;
  return typeof p === "string" && (PLAN_IDS as readonly string[]).includes(p) ? (p as PlanId) : DEFAULT_PLAN;
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
    // 관리자 재검사(admin_retry, 0028)와 정기 검사(source='scheduled', 0029)는 사용자 한도에서 제외.
    // 정기 검사는 소유 확인 도메인에만, 사용자당 활성 검사 1건 가드 때문에 계정당 하루 1건까지만
    // 돈다(크론). 이걸 한도에 넣으면 매일 검사만으로 주간 한도가 바닥나 수동 검사까지 막혔다.
    // 컬럼 미적용 환경(0028·0029)에서는 필터 없이 폴백해 검사 생성이 깨지지 않게 한다.
    let { count, error } = await admin
      .from("scans")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("admin_retry", false)
      .neq("source", "scheduled")
      .gte("created_at", lowerBound);
    if (error) {
      // 폴백은 정기 검사·관리자 재검사를 다시 한도에 넣는다 — 컬럼 부재(0028·0029 미적용)일 때만
      // 기록한다(일시 장애마다 화면 렌더 한 번에 여러 줄씩 쌓이지 않게)
      if (/column/i.test(error.message)) {
        await logAppError(admin, `checkQuota fallback — scans column missing: ${error.message.slice(0, 200)}`, {
          path: "quota.checkQuota",
        });
      }
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
