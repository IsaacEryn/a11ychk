import "server-only";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { hashEmail } from "./hash";
import { isDisposableEmailDomain } from "./disposable";
import { REFERRAL_INVITEE_DAILY_BONUS } from "./constants";
import { REFERRAL_CODE_PATTERN } from "./code";

/**
 * 가입 완료 시 초대 기록(pending) 생성 — auth/confirm(이메일 인증)·auth/callback(OAuth)
 * 성공 직후 호출된다. 전 과정 best-effort: 어떤 실패도 로그인 흐름을 막지 않는다.
 *
 * 신규 사용자 판별: user.created_at ≤72h AND login_logs에 기록 0건
 * (이 라우트의 logLogin이 첫 기록이 되기 전 시점이므로 "진짜 첫 로그인"만 통과).
 * 필터: 자기 초대, 일회용 이메일 도메인, 이메일 해시 전역 중복(23505 — 탈퇴 후 재가입 포함).
 * 통과 시 피초대자에게 일 한도 보너스(+1)를 즉시 부여한다.
 */
export async function captureReferral(
  admin: SupabaseClient,
  opts: { code: string; user: User; ip?: string },
): Promise<void> {
  try {
    const { code, user } = opts;
    if (!REFERRAL_CODE_PATTERN.test(code) || !user.email) return;

    // 신규 사용자만 — 재로그인에 남은 쿠키로 기존 계정이 초대되는 것 방지
    const createdAt = Date.parse(user.created_at);
    if (!Number.isFinite(createdAt) || Date.now() - createdAt > 72 * 3600_000) return;
    const { count: loginCount } = await admin
      .from("login_logs")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id);
    if ((loginCount ?? 0) > 0) return;

    if (isDisposableEmailDomain(user.email)) return;

    const { data: referrer } = await admin
      .from("profiles")
      .select("id")
      .eq("referral_code", code)
      .maybeSingle();
    if (!referrer || referrer.id === user.id) return; // 무효 코드·자기 초대

    // 전역 unique(invitee_email_hash) — 이미 초대된 이메일(탈퇴 후 재가입 포함)은 23505로 거부됨
    const { error } = await admin.from("referrals").insert({
      referrer_id: referrer.id,
      invitee_id: user.id,
      invitee_email_hash: hashEmail(user.email),
      status: "pending",
      signup_ip: opts.ip ?? null,
    });
    if (error) return; // 23505(중복)·테이블 부재(0024 미적용) — 조용히 종료

    // 피초대자 가입 보너스 — 초대 링크의 즉시 혜택 (부정 기각 시 관리자 액션이 회수)
    await admin
      .from("profiles")
      .update({ referral_daily_bonus: REFERRAL_INVITEE_DAILY_BONUS })
      .eq("id", user.id);
  } catch {
    // best-effort — 로그인 흐름 보호
  }
}
