import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { REFERRAL_VALID_CAP, REFERRAL_VALID_GOAL, REFERRAL_VELOCITY_PER_DAY } from "./constants";
import { reevaluateEarnedPlan } from "./promote";

/**
 * 초대 성립 전환 — 피초대자의 첫 검사 실행 시 호출 (createScanForUser 성공,
 * 확장 결과 저장 API). 멱등: pending 기록이 없으면 인덱스 조회 1회로 즉시 반환.
 *
 * 판정 순서:
 * 1. 초대자 총 성립 ≥ CAP(20) → rejected('cap')
 * 2. 피초대자 가입 IP = 초대자 최근 30일 로그인 IP → suspect('same_ip') — 소명·관리자 심사
 * 3. 초대자 오늘 성립 ≥ VELOCITY(2) → pending 유지 (다음날 크론이 재처리)
 * 4. 통과 → `where status='pending'` 조건부 update + select 확인(동시 호출 이중 카운트 방지)
 * 5. 성립 수가 목표(5)에 닿으면 plus1 승급 시도
 */
export async function markReferralValidOnFirstScan(admin: SupabaseClient, inviteeId: string): Promise<void> {
  try {
    const { data: ref, error } = await admin
      .from("referrals")
      .select("id, referrer_id, signup_ip")
      .eq("invitee_id", inviteeId)
      .eq("status", "pending")
      .maybeSingle();
    if (error || !ref) return; // 기록 없음·테이블 부재(0024 미적용)

    const referrerId = ref.referrer_id as string;

    // 1) 총 성립 상한
    const { count: totalValid } = await admin
      .from("referrals")
      .select("id", { count: "exact", head: true })
      .eq("referrer_id", referrerId)
      .eq("status", "valid");
    if ((totalValid ?? 0) >= REFERRAL_VALID_CAP) {
      await admin
        .from("referrals")
        .update({ status: "rejected", suspect_reason: "cap" })
        .eq("id", ref.id)
        .eq("status", "pending");
      return;
    }

    // 2) 자가 초대 의심 — 가입 IP가 초대자의 최근 로그인 IP와 일치하면 보류(소명 절차)
    if (typeof ref.signup_ip === "string" && ref.signup_ip) {
      const since = new Date(Date.now() - 30 * 24 * 3600_000).toISOString();
      const { count: sameIp } = await admin
        .from("login_logs")
        .select("id", { count: "exact", head: true })
        .eq("user_id", referrerId)
        .eq("ip", ref.signup_ip)
        .gte("created_at", since);
      if ((sameIp ?? 0) > 0) {
        await admin
          .from("referrals")
          .update({ status: "suspect", suspect_reason: "same_ip" })
          .eq("id", ref.id)
          .eq("status", "pending");
        return;
      }
    }

    // 3) 일일 반영 속도 제한 — 초과분은 pending으로 두고 다음날 크론이 재시도
    const todayStart = new Date().toISOString().slice(0, 10) + "T00:00:00.000Z";
    const { count: todayValid } = await admin
      .from("referrals")
      .select("id", { count: "exact", head: true })
      .eq("referrer_id", referrerId)
      .eq("status", "valid")
      .gte("validated_at", todayStart);
    if ((todayValid ?? 0) >= REFERRAL_VELOCITY_PER_DAY) return;

    // 4) 성립 전환 — 조건부 update로 동시 호출 레이스 차단
    const { data: updated } = await admin
      .from("referrals")
      .update({ status: "valid", validated_at: new Date().toISOString() })
      .eq("id", ref.id)
      .eq("status", "pending")
      .select("id");
    if (!updated || updated.length === 0) return;

    // 5) 목표 도달 시 승급
    const { count: validNow } = await admin
      .from("referrals")
      .select("id", { count: "exact", head: true })
      .eq("referrer_id", referrerId)
      .eq("status", "valid");
    if ((validNow ?? 0) >= REFERRAL_VALID_GOAL) {
      // 초대 완료 시점에 도메인·공개 조건까지 이미 충족했으면 바로 플러스2로 (아니면 플러스1)
      await reevaluateEarnedPlan(admin, referrerId);
    }
  } catch {
    // best-effort — 검사 흐름 보호
  }
}
