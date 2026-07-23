import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { logAdminAction } from "@/lib/logs";
import { sendPlanUpgradeEmail } from "@/lib/notify";
import { REFERRAL_VALID_GOAL } from "./constants";

/** 유효 초대 성립 수 조회 — 미션1(플러스1) 조건이자 플러스2의 선행 조건 */
async function validReferralCount(admin: SupabaseClient, userId: string): Promise<number> {
  const { count } = await admin
    .from("referrals")
    .select("id", { count: "exact", head: true })
    .eq("referrer_id", userId)
    .eq("status", "valid");
  return count ?? 0;
}

/**
 * 달성 등급 자동 승급 — 조건부 update(WHERE earned_plan 제약)로 정확히 1회만
 * 전환되게 해 동시 호출에서도 중복 승급·중복 메일이 없다. 모두 best-effort.
 */

async function notifyUpgrade(admin: SupabaseClient, userId: string, plan: "plus1" | "plus2") {
  await logAdminAction(admin, userId, "referral.promote", userId, { plan });
  try {
    const { data } = await admin.auth.admin.getUserById(userId);
    const email = data.user?.email;
    const locale = (data.user?.user_metadata?.locale as string | undefined) === "en" ? "en" : "ko";
    if (email) await sendPlanUpgradeEmail(email, plan, locale);
  } catch {
    // 메일 실패는 무시 — 마이페이지 배지로도 확인 가능
  }
}

/** 유효 초대 목표 달성 → plus1 (이미 달성 등급이 있으면 유지) */
export async function maybePromoteToPlus1(admin: SupabaseClient, userId: string): Promise<void> {
  try {
    const { data } = await admin
      .from("profiles")
      .update({ earned_plan: "plus1" })
      .eq("id", userId)
      .is("earned_plan", null)
      .select("id");
    if (data && data.length > 0) await notifyUpgrade(admin, userId, "plus1");
  } catch {
    // best-effort
  }
}

/**
 * 플러스2 조건 — 플러스1 조건(유효 초대 5명)을 충족하면서 소유확인 도메인 ≥1
 * AND 보고서 공개 ≥1. 즉 플러스1을 만족한 위에 도메인 미션을 마쳐야 상향된다.
 * (plus1에서 상향 포함)
 */
export async function maybePromoteToPlus2(admin: SupabaseClient, userId: string): Promise<void> {
  try {
    // 선행: 플러스1 조건(초대 5명)도 만족해야 한다
    if ((await validReferralCount(admin, userId)) < REFERRAL_VALID_GOAL) return;

    const { count: verified } = await admin
      .from("domains")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("verified", true);
    if (!verified) return;
    const { count: published } = await admin
      .from("domains")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("public_listed", true);
    if (!published) return;

    const { data } = await admin
      .from("profiles")
      .update({ earned_plan: "plus2" })
      .eq("id", userId)
      .or("earned_plan.is.null,earned_plan.eq.plus1")
      .select("id");
    if (data && data.length > 0) await notifyUpgrade(admin, userId, "plus2");
  } catch {
    // best-effort
  }
}

/**
 * 달성 등급 재평가 — 플러스2를 먼저 시도(모든 조건 충족 시 바로 상향)하고,
 * 걸리지 않았으면 플러스1을 시도한다. 이 순서 덕분에 조건을 한꺼번에 만족한
 * 사용자도 승급 메일을 1통만 받는다(플러스2가 걸리면 earned_plan이 채워져
 * 이후 플러스1 조건부 update가 no-op이 됨). 모든 승급 트리거 지점의 단일 진입점.
 */
export async function reevaluateEarnedPlan(admin: SupabaseClient, userId: string): Promise<void> {
  await maybePromoteToPlus2(admin, userId);
  await maybePromoteToPlus1(admin, userId);
}
