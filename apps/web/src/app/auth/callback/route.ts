import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { sanitizeNextPath } from "@/lib/safeRedirect";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { logLogin } from "@/lib/logs";
import { captureReferral } from "@/lib/referral/capture";
import { REFERRAL_COOKIE } from "@/lib/referral/constants";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  // open redirect 방지 — 내부 경로만 허용
  const nextParam = searchParams.get("next") ?? "/ko/dashboard";
  const next = sanitizeNextPath(nextParam);

  if (code) {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? undefined;
      // 로그인 기록 (best-effort — 실패해도 로그인은 정상 진행)
      if (data.user) {
        // 초대 코드 쿠키 소비 — logLogin 전에 실행 (capture가 login_logs 0건으로 신규 판별)
        const refCode = (await cookies()).get(REFERRAL_COOKIE)?.value;
        if (refCode) {
          await captureReferral(createAdminClient(), { code: refCode, user: data.user, ip });
        }
        await logLogin(createAdminClient(), {
          userId: data.user.id,
          email: data.user.email ?? undefined,
          provider: (data.user.app_metadata?.provider as string | undefined) ?? undefined,
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
  return NextResponse.redirect(`${origin}/ko/login?error=auth`);
}
