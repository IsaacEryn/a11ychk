import type { SupabaseClient } from "@supabase/supabase-js";
import { entitlementLivemodes } from "@/lib/billing/config";
import { logAppError } from "@/lib/logs";
import {
  MAX_PAGES_PER_SCAN,
  PLAN_IDS,
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
import { createAdminClient } from "@/lib/supabase/admin";

export type GrantSource = "free" | "earned" | "admin" | "contract" | "subscription";

export interface Grant {
  tier: PlanId;
  source: GrantSource;
  /** 구독·기관 계약 근거의 기간 종료 시각(ISO) */
  until?: string;
}

export interface Entitlement {
  /** 표시 등급 — 근거 중 서열이 가장 높은 등급 */
  tier: PlanId;
  source: GrantSource;
  /** 표시 근거가 구독·기관 계약이면 그 기간 종료 시각 */
  until?: string;
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

/** 이용 권한 계산에 쓰는 subscriptions 열 */
export interface SubscriptionGrantRow {
  plan_code: string;
  provider: "toss" | "mor" | "manual";
  status: "active" | "past_due" | "ended";
  current_period_start: string;
  current_period_end: string;
  grace_until: string | null;
  cancel_at_period_end: boolean;
}

export const SUBSCRIPTION_GRANT_COLUMNS =
  "plan_code, provider, status, current_period_start, current_period_end, grace_until, cancel_at_period_end";

/** 정기결제 갱신 크론·결제사 웹훅이 늦어도 권한이 끊기지 않게 주는 여유 */
export const RENEWAL_GRACE_MS = 48 * 3600_000;

/** 서열이 같을 때 표시 우선순위 — 돈을 낸 근거를 먼저, 초대 등급은 관리자 배정보다 먼저(M1 동작 유지) */
const TIE_ORDER: Record<GrantSource, number> = { free: 0, admin: 1, earned: 2, contract: 3, subscription: 4 };

/**
 * 구독이 지금 권한을 주는가 — status가 아니라 기간 시각으로 판정한다. 갱신 크론·웹훅이
 * 늦거나 실패해도 권한이 잘못 남거나 잘못 끊기지 않게 하기 위해서다.
 * - 시작 전(기관 계약의 미래 시작일)·종료·날짜 오류는 무효
 * - 미납(past_due)은 유예 기한(grace_until)까지
 * - 기관 계약·해지 예약은 기간 끝까지, 그 밖의 active는 기간 끝 + 48시간
 */
export function isSubscriptionEntitled(sub: SubscriptionGrantRow, now: number = Date.now()): boolean {
  const start = Date.parse(sub.current_period_start);
  const end = Date.parse(sub.current_period_end);
  if (Number.isNaN(start) || Number.isNaN(end) || now < start) return false;
  if (sub.status === "ended") return false;
  if (sub.status === "past_due") {
    const grace = sub.grace_until ? Date.parse(sub.grace_until) : NaN;
    return !Number.isNaN(grace) && now < grace;
  }
  if (sub.provider === "manual" || sub.cancel_at_period_end) return now < end;
  return now < end + RENEWAL_GRACE_MS;
}

/**
 * 이용 권한(엔타이틀먼트) — 사용자에게 실제로 적용되는 한도를 한 곳에서 계산한다.
 *
 * 근거(grant: 초대 등급·관리자 배정·구독·기관 계약)를 모은 뒤 등급표(TIERS) 행을 필드마다 최댓값으로 합친다. free는 항상
 * 근거에 들어가므로, 관리자가 숫자를 직접 낮추지 않는 한 누구도 free 아래로 내려가지 않는다.
 * 관리자 배정 등급은 기한(until) 안이면 즉시 모든 한도에 적용된다.
 * 순서: 근거 병합 → 초대 가입 보너스(daily) → 관리자 수치 개별값(덮어씀) → 표본 상한.
 */
export function resolveEntitlement(
  p: ProfileQuotaFields | null | undefined,
  subscriptions: SubscriptionGrantRow[] = [],
  now: number = Date.now(),
): Entitlement {
  const override = p?.scan_limit_override;
  const grants: Grant[] = [{ tier: "free", source: "free" }];
  const earned = getEarnedPlan(p?.earned_plan);
  if (earned) grants.push({ tier: earned, source: "earned" });
  const assigned = getPlan(override);
  if (assigned !== "free") grants.push({ tier: assigned, source: "admin" });
  for (const sub of subscriptions) {
    if (!(PLAN_IDS as readonly string[]).includes(sub.plan_code)) continue;
    if (!isSubscriptionEntitled(sub, now)) continue;
    grants.push({
      tier: sub.plan_code as PlanId,
      source: sub.provider === "manual" ? "contract" : "subscription",
      until: sub.current_period_end,
    });
  }

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
  return { tier: top.tier, source: top.source, until: top.until, grants, limits, resets: getResets(override) };
}

/** 검사당 구조 표본 페이지 수 — 소유 확인 도메인은 더 크다 */
export function sampleFor(ent: Entitlement, verified: boolean): number {
  return verified ? ent.limits.sampleVerified : ent.limits.sampleUnverified;
}

/** 0041 미적용 환경 — 구독 테이블이 없으면 조용히 구독 없음으로 본다 */
function isMissingTable(error: { code?: string }): boolean {
  return error.code === "42P01" || error.code === "PGRST205";
}

/**
 * 조회 실패 기록 — 권한은 free로 계산한다(높은 한도를 잘못 주는 쪽보다 안전).
 * 사용자 세션 클라이언트는 app_errors에 쓸 수 없으므로 기록만 service role로 한다.
 */
async function reportLoadError(table: string, error: { message: string }): Promise<void> {
  try {
    await logAppError(createAdminClient(), `loadEntitlement ${table} failed: ${error.message.slice(0, 200)}`, {
      path: "entitlements.loadEntitlement",
    });
  } catch {
    // 기록은 best-effort — service role 환경변수가 없는 환경에서도 권한 계산은 계속한다
  }
}

/**
 * 여러 사용자의 진행 중 구독(권한 근거 후보). 관리자 목록·상세와 loadEntitlement가 함께 쓴다.
 * 사용자 세션 클라이언트(RLS — 자기 행)와 service role 모두 받는다. 실패하면 빈 목록.
 */
export async function loadSubscriptionGrants(
  db: SupabaseClient,
  userIds: string[],
): Promise<Map<string, SubscriptionGrantRow[]>> {
  const byUser = new Map<string, SubscriptionGrantRow[]>();
  if (userIds.length === 0) return byUser;
  const { data, error } = await db
    .from("subscriptions")
    .select(`user_id, ${SUBSCRIPTION_GRANT_COLUMNS}`)
    .in("user_id", userIds)
    .in("status", ["active", "past_due"])
    .in("livemode", entitlementLivemodes());
  if (error) {
    if (!isMissingTable(error)) await reportLoadError("subscriptions", error);
    return byUser;
  }
  for (const row of (data ?? []) as unknown as (SubscriptionGrantRow & { user_id: string })[]) {
    byUser.set(row.user_id, [...(byUser.get(row.user_id) ?? []), row]);
  }
  return byUser;
}

/**
 * 사용자 권한 로더 — 프로필(초대 등급·관리자 배정)과 진행 중 구독을 함께 읽는다.
 * 사용자 세션 클라이언트(RLS — 자기 행)와 service role 모두 받는다.
 */
export async function loadEntitlement(db: SupabaseClient, userId: string): Promise<Entitlement> {
  const [profile, subs] = await Promise.all([
    db.from("profiles").select(PROFILE_QUOTA_COLUMNS).eq("id", userId).maybeSingle(),
    loadSubscriptionGrants(db, [userId]),
  ]);
  if (profile.error) await reportLoadError("profiles", profile.error);
  return resolveEntitlement(profile.data as ProfileQuotaFields | null, subs.get(userId) ?? []);
}
