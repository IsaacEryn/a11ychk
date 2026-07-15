import { NextResponse } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { logLogin } from "@/lib/logs";

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
  const next = nextParam.startsWith("/") && !nextParam.startsWith("//") ? nextParam : "/ko/dashboard";

  if (tokenHash && type) {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    if (!error) {
      if (data.user) {
        await logLogin(createAdminClient(), {
          userId: data.user.id,
          email: data.user.email ?? undefined,
          provider: "email",
          ip: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? undefined,
          userAgent: request.headers.get("user-agent") ?? undefined,
        });
      }
      return NextResponse.redirect(`${origin}${next}`);
    }
  }
  return NextResponse.redirect(`${origin}/ko/login?error=confirm`);
}
