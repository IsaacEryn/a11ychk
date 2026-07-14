import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

/** 기본 검사 한도 — 트래픽·자원 보호. 관리자가 profiles.scan_limit_override로 사용자별 조정 가능 */
export const DEFAULT_SCAN_LIMITS = {
  daily: 3,
  weekly: 10,
  monthly: 20,
} as const;

export interface ScanLimits {
  daily: number;
  weekly: number;
  monthly: number;
}

export interface QuotaResult {
  ok: boolean;
  /** 초과된 윈도우 (ok=false일 때) */
  exceeded?: "daily" | "weekly" | "monthly";
  used: { daily: number; weekly: number; monthly: number };
  limits: ScanLimits;
}

export function resolveLimits(override: unknown): ScanLimits {
  const base: ScanLimits = { ...DEFAULT_SCAN_LIMITS };
  if (override && typeof override === "object") {
    const o = override as Record<string, unknown>;
    for (const key of ["daily", "weekly", "monthly"] as const) {
      const v = o[key];
      if (typeof v === "number" && Number.isFinite(v) && v >= 0) base[key] = v;
    }
  }
  return base;
}

/**
 * 관리자가 "일 한도 초기화"를 누른 시각.
 * scan_limit_override.dailyResetAt(ISO)에 저장한다. 이 시각 이전의 검사는
 * 일간 사용량 집계에서 제외되어 사용자가 그 즉시 다시 검사할 수 있다.
 */
export function getDailyResetAt(override: unknown): string | undefined {
  if (override && typeof override === "object") {
    const v = (override as Record<string, unknown>).dailyResetAt;
    if (typeof v === "string" && !Number.isNaN(Date.parse(v))) return v;
  }
  return undefined;
}

/** 롤링 윈도우(24시간/7일/30일) 기준 사용량 확인. dailyResetAt 이후로만 일간 집계 */
export async function checkQuota(
  admin: SupabaseClient,
  userId: string,
  limits: ScanLimits,
  dailyResetAt?: string,
): Promise<QuotaResult> {
  const now = Date.now();
  const dailyStart = new Date(now - 24 * 3600_000).toISOString();
  const windows = {
    // 일간은 롤링 24시간과 관리자 리셋 시각 중 더 나중(=더 짧은 기간)을 하한으로
    daily: dailyResetAt && dailyResetAt > dailyStart ? dailyResetAt : dailyStart,
    weekly: new Date(now - 7 * 24 * 3600_000).toISOString(),
    monthly: new Date(now - 30 * 24 * 3600_000).toISOString(),
  };

  const counts = { daily: 0, weekly: 0, monthly: 0 };
  for (const key of ["daily", "weekly", "monthly"] as const) {
    const { count, error } = await admin
      .from("scans")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .gte("created_at", windows[key]);
    if (error) throw new Error(`사용량 조회 실패: ${error.message}`);
    counts[key] = count ?? 0;
  }

  for (const key of ["daily", "weekly", "monthly"] as const) {
    if (counts[key] >= limits[key]) {
      return { ok: false, exceeded: key, used: counts, limits };
    }
  }
  return { ok: true, used: counts, limits };
}
