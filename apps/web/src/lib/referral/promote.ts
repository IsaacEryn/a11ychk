import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { logAdminAction } from "@/lib/logs";
import { sendPlanUpgradeEmail } from "@/lib/notify";

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

/** 소유확인 도메인 ≥1 AND 보고서 공개 ≥1 → plus2 (plus1에서 상향 포함) */
export async function maybePromoteToPlus2(admin: SupabaseClient, userId: string): Promise<void> {
  try {
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
