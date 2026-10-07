import type { SupabaseClient } from "@supabase/supabase-js";
import {
  MAX_PAGES_PER_SCAN,
  PLAN_RANK,
  TIERS,
  TIER_LIMIT_KEYS,
  getCustomInt,
  getCustomLimits,
  getCustomPages,
  getEarnedPlan,
  getPlan,
  getResets,
  type PlanId,
  type QuotaWindow,
  type TierLimits,
} from "@/lib/quota";

/**
 * 이용 권한(엔타이틀먼트) — 사용자에게 실제로 적용되는 한도를 한 곳에서 계산한다.
 *
 * 근거(grant)를 모은 뒤 등급표(TIERS) 행을 필드마다 최댓값으로 합친다. free는 항상
 * 근거에 들어가므로, 관리자가 숫자를 직접 낮추지 않는 한 누구도 free 아래로 내려가지 않는다.
 * 관리자 배정 등급은 기한(until) 안이면 즉시 모든 한도에 적용된다.
 * 순서: 근거 병합 → 초대 가입 보너스(daily) → 관리자 수치 개별값(덮어씀) → 표본 상한.
 */
export type GrantSource = "free" | "earned" | "admin";

export interface Grant {
  tier: PlanId;
  source: GrantSource;
}

export interface Entitlement {
  /** 표시 등급 — 근거 중 서열이 가장 높은 등급 */
  tier: PlanId;
  source: GrantSource;
  grants: Grant[];
  limits: TierLimits;
  resets: Partial<Record<QuotaWindow, string>>;
}

/** profiles에서 권한 계산에 쓰는 열 */
export interface ProfileQuotaFields {
  scan_limit_override?: unknown;
  earned_plan?: unknown;
  referral_daily_bonus?: unknown;
}

export const PROFILE_QUOTA_COLUMNS = "scan_limit_override, earned_plan, referral_daily_bonus";

/** 서열이 같을 때 표시 우선순위 — 초대 등급을 관리자 배정보다 먼저 보여 주던 기존 동작 유지 */
const TIE_ORDER: Record<GrantSource, number> = { free: 0, admin: 1, earned: 2 };

export function resolveEntitlement(p: ProfileQuotaFields | null | undefined): Entitlement {
  const override = p?.scan_limit_override;
  const grants: Grant[] = [{ tier: "free", source: "free" }];
  const earned = getEarnedPlan(p?.earned_plan);
  if (earned) grants.push({ tier: earned, source: "earned" });
  const assigned = getPlan(override);
  if (assigned !== "free") grants.push({ tier: assigned, source: "admin" });

  const limits: TierLimits = { ...TIERS.free };
  for (const g of grants) {
    for (const k of TIER_LIMIT_KEYS) limits[k] = Math.max(limits[k], TIERS[g.tier][k]);
  }

  const bonus = p?.referral_daily_bonus;
  if (typeof bonus === "number" && bonus > 0) limits.daily += bonus;

  Object.assign(limits, getCustomLimits(override));
  const verifiedDomains = getCustomInt(override, "verifiedDomains");
  if (verifiedDomains !== undefined) limits.verifiedDomains = verifiedDomains;
  const extDaily = getCustomInt(override, "extDaily");
  if (extDaily !== undefined) limits.extDaily = extDaily;
  const pages = getCustomPages(override);
  if (pages !== undefined) {
    limits.sampleUnverified = pages;
    limits.sampleVerified = pages * 2;
  }
  limits.sampleUnverified = Math.min(limits.sampleUnverified, MAX_PAGES_PER_SCAN);
  limits.sampleVerified = Math.min(limits.sampleVerified, MAX_PAGES_PER_SCAN);

  const top = grants.reduce((a, b) => {
    const diff = PLAN_RANK[b.tier] - PLAN_RANK[a.tier];
    return diff > 0 || (diff === 0 && TIE_ORDER[b.source] > TIE_ORDER[a.source]) ? b : a;
  });
  return { tier: top.tier, source: top.source, grants, limits, resets: getResets(override) };
}

/** 검사당 구조 표본 페이지 수 — 소유 확인 도메인은 더 크다 */
export function sampleFor(ent: Entitlement, verified: boolean): number {
  return verified ? ent.limits.sampleVerified : ent.limits.sampleUnverified;
}

/**
 * 사용자 권한 로더. 사용자 세션 클라이언트(RLS — 자기 profiles 행)와 service role 모두 받는다.
 * 조회 실패·행 없음은 free로 계산한다(높은 한도를 잘못 주는 쪽보다 안전).
 */
export async function loadEntitlement(db: SupabaseClient, userId: string): Promise<Entitlement> {
  const { data } = await db.from("profiles").select(PROFILE_QUOTA_COLUMNS).eq("id", userId).maybeSingle();
  return resolveEntitlement(data as ProfileQuotaFields | null);
}
