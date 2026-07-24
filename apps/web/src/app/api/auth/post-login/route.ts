import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAdminAction, logLogin } from "@/lib/logs";
import { sendAdminLoginAlert, sendAdminMfaFailureAlert } from "@/lib/notify";
import {
  FAILURE_THRESHOLD,
  FAILURE_WINDOW_MS,
  assessLoginRisk,
  collectLoginHistory,
  deviceFingerprint,
} from "@/lib/security/loginRisk";
import { ADMIN_TS_COOKIE, adminTsCookieOptions, signAdminTs } from "@/lib/adminIdleCookie";

/**
 * 로그인 직후 서버 훅 — 클라이언트 로그인(signInWithPassword)·MFA 검증 완료 후 호출된다.
 * - stage "password": 이메일 로그인 감사 기록(logLogin) — OAuth는 auth/callback이 담당.
 * - stage "mfa": 관리자 AAL2 완성 시에만 ① 다른 기기 세션 전부 철회(동시 로그인 방지,
 *   last-login-wins) ② 이상 징후가 있을 때만 알림 메일 ③ 감사 로그 ④ 무활동 타이머 쿠키 발급.
 * - stage "mfaFailed": 2단계 인증 실패 기록(AAL1 세션 필요 — 비밀번호는 통과한 시도).
 *   짧은 창에서 임계치에 도달하면 경보 1회. 인증된 세션에서만 받으므로 알림 스팸 벡터가 없다.
 *   AAL1 시점에는 철회·알림을 하지 않는다 — 비밀번호만 탈취한 공격자가 MFA를 못 넘겨도
 *   정식 세션을 축출(DoS)하거나 알림을 스팸할 수 있게 되기 때문.
 * 쿠키는 SameSite=Lax라 크로스사이트 POST에 실리지 않아 CSRF로 오발동하지 않고,
 * 효과도 호출자 자신의 세션에 한정된다.
 */
const BodySchema = z.object({ stage: z.enum(["password", "mfa", "mfaFailed"]) });

export async function POST(request: Request) {
  let stage: "password" | "mfa" | "mfaFailed";
  try {
    const parsed = BodySchema.safeParse(await request.json());
    if (!parsed.success) return NextResponse.json({ code: "invalid" }, { status: 400 });
    stage = parsed.data.stage;
  } catch {
    return NextResponse.json({ code: "invalid" }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ code: "unauthorized" }, { status: 401 });

  const admin = createAdminClient();
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
  const userAgent = request.headers.get("user-agent");
  const provider = (user.app_metadata?.provider as string | undefined) ?? "email";

  if (stage === "password") {
    // 이메일 로그인 감사 기록 — OAuth는 auth/callback에서 기록되므로 중복 없음
    await logLogin(admin, { userId: user.id, email: user.email, provider, ip: ip ?? undefined, userAgent: userAgent ?? undefined });
  }

  const { data: me } = await admin.from("profiles").select("role").eq("id", user.id).single();
  const isAdmin = me?.role === "admin";

  // 2단계 인증 실패 — 기록 후 최근 창의 누적이 임계치에 "도달한 순간"에만 경보 1회
  // (3·4회째마다 반복 발송하지 않는다. 창이 지나 다시 임계치에 닿으면 재발송)
  if (stage === "mfaFailed") {
    await logLogin(admin, {
      userId: user.id,
      email: user.email,
      provider,
      ip: ip ?? undefined,
      userAgent: userAgent ?? undefined,
      outcome: "mfa_failed",
    });
    if (isAdmin) {
      const { count } = await admin
        .from("login_logs")
        .select("id", { count: "exact", head: true })
        .eq("user_id", user.id)
        .eq("outcome", "mfa_failed")
        .gte("created_at", new Date(Date.now() - FAILURE_WINDOW_MS).toISOString())
        .then(
          (r) => r,
          () => ({ count: 0 }),
        );
      if ((count ?? 0) === FAILURE_THRESHOLD) {
        await sendAdminMfaFailureAlert({
          email: user.email ?? null,
          ip,
          userAgent,
          failures: count ?? 0,
          windowMinutes: Math.round(FAILURE_WINDOW_MS / 60_000),
        });
      }
    }
    return NextResponse.json({ ok: true });
  }
  const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  const setupRequired = isAdmin && aal?.nextLevel !== "aal2";
  const mfaRequired = isAdmin && !setupRequired && aal?.currentLevel !== "aal2";

  const response = NextResponse.json({ mfaRequired, setupRequired });

  if (isAdmin && stage === "mfa" && aal?.currentLevel === "aal2") {
    // 동시 로그인 방지 — 다른 기기 세션 철회 (updateSession의 매 요청 getUser 검증이
    // 철회된 세션을 다음 요청에서 즉시 로그아웃시킨다)
    await supabase.auth.signOut({ scope: "others" });
    // 이상 징후(처음 보는 IP·기기, 직전 MFA 실패 누적)가 있을 때만 알림 — 익숙한
    // 환경의 로그인은 감사 로그로만 남긴다(알림 피로 방지)
    const history = await collectLoginHistory(admin, user.id);
    const reasons = assessLoginRisk({
      ip,
      device: deviceFingerprint(userAgent),
      knownIps: history.knownIps,
      knownDevices: history.knownDevices,
      recentFailures: history.recentFailures,
    });
    if (reasons.length > 0) {
      await sendAdminLoginAlert({ email: user.email ?? null, provider, ip, userAgent, reasons });
    }
    await logAdminAction(admin, user.id, "auth.login", undefined, { provider, ip, ...(reasons.length > 0 ? { risk: reasons.join(",") } : {}) });
    // 무활동 타이머 시작 — 발급은 오직 여기(AAL2 완성 시)
    response.cookies.set(ADMIN_TS_COOKIE, await signAdminTs(), adminTsCookieOptions());
  }

  return response;
}
