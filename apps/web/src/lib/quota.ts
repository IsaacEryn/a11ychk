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

/** 롤링 윈도우(24시간/7일/30일) 기준 사용량 확인 */
export async function checkQuota(
  admin: SupabaseClient,
  userId: string,
  limits: ScanLimits,
): Promise<QuotaResult> {
  const now = Date.now();
  const windows = {
    daily: new Date(now - 24 * 3600_000).toISOString(),
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
