import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import type { EmailOtpType } from "@supabase/supabase-js";
import { sanitizeNextPath } from "@/lib/safeRedirect";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { logLogin } from "@/lib/logs";
import { captureReferral } from "@/lib/referral/capture";
import { REFERRAL_COOKIE } from "@/lib/referral/constants";

/**
 * 이메일 매직링크/가입 확인 콜백 (token_hash 방식 — 다른 기기·브라우저에서 열어도 동작).
 * Supabase 이메일 템플릿의 링크를 이 경로로 지정한다:
 *   {{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email&next=/ko/dashboard
 */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  // open redirect 방지 — 내부 경로만 허용
  const nextParam = searchParams.get("next") ?? "/ko/dashboard";
  const next = sanitizeNextPath(nextParam);

  if (tokenHash && type) {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    if (!error) {
      const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? undefined;
      if (data.user) {
        // 초대 코드 쿠키가 있으면 초대 기록 생성 — 신규 사용자 판별을 위해
        // 반드시 logLogin(첫 로그인 기록) **전에** 실행한다 (capture 내부에서 login_logs 0건 확인)
        const refCode = (await cookies()).get(REFERRAL_COOKIE)?.value;
        if (refCode) {
          await captureReferral(createAdminClient(), { code: refCode, user: data.user, ip });
        }
        await logLogin(createAdminClient(), {
          userId: data.user.id,
          email: data.user.email ?? undefined,
          provider: "email",
          ip,
          userAgent: request.headers.get("user-agent") ?? undefined,
        });
      }
      const res = NextResponse.redirect(`${origin}${next}`);
      // 소비 여부와 무관하게 삭제 — 재로그인 잔류 오염 방지
      res.cookies.delete(REFERRAL_COOKIE);
      return res;
    }
  }
  return NextResponse.redirect(`${origin}/ko/login?error=confirm`);
}
