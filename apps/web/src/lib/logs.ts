/**
 * 로그인 기록 + 관리자 행위 감사 로그 (migration 0006).
 * 모두 best-effort — 테이블 미적용·insert 실패가 로그인이나 관리 동작을 깨지 않도록
 * 오류를 삼킨다. RLS상 두 테이블 모두 service role로만 기록한다.
 */
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

export interface LoginLogEntry {
  userId: string;
  email?: string;
  provider?: string;
  ip?: string;
  userAgent?: string;
}

/**
 * 삼켜지던 백그라운드 실패의 관측 지점 — app_errors에 best-effort 기록.
 * instrumentation.onRequestError는 미처리 throw만 잡으므로, 의도적으로 삼키는
 * catch(알림 발송 실패·드레인 오류 등)는 이 함수로 흔적을 남긴다.
 */
export async function logAppError(
  admin: SupabaseClient,
  message: string,
  opts: { path?: string; digest?: string } = {},
): Promise<void> {
  try {
    await admin.from("app_errors").insert({
      message: message.slice(0, 2000),
      path: opts.path ?? null,
      digest: opts.digest ?? null,
      method: "internal",
    });
  } catch {
    // 로그 실패는 무시 (관측 자체가 best-effort)
  }
}

/** 로그인 성공 기록 (auth 스키마는 PostgREST 미노출이라 앱 레벨에서 기록) */
export async function logLogin(admin: SupabaseClient, entry: LoginLogEntry): Promise<void> {
  try {
    await admin.from("login_logs").insert({
      user_id: entry.userId,
      email: entry.email ?? null,
      provider: entry.provider ?? null,
      ip: entry.ip ?? null,
      user_agent: entry.userAgent ?? null,
    });
  } catch {
    // 마이그레이션 미적용 등 — 무시
  }
}

/** 관리자 행위 감사 기록 */
export async function logAdminAction(
  admin: SupabaseClient,
  actorId: string,
  action: string,
  target?: string,
  detail?: Record<string, unknown>,
): Promise<void> {
  try {
    await admin.from("audit_logs").insert({
      actor_id: actorId,
      action,
      target: target ?? null,
      detail: detail ?? null,
    });
  } catch {
    // 마이그레이션 미적용 등 — 무시
  }
}
