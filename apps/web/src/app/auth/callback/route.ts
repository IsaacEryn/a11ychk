import { NextResponse } from "next/server";
import { sanitizeNextPath } from "@/lib/safeRedirect";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { logLogin } from "@/lib/logs";

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
      // 로그인 기록 (best-effort — 실패해도 로그인은 정상 진행)
      if (data.user) {
        await logLogin(createAdminClient(), {
          userId: data.user.id,
          email: data.user.email ?? undefined,
          provider: (data.user.app_metadata?.provider as string | undefined) ?? undefined,
          ip: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? undefined,
          userAgent: request.headers.get("user-agent") ?? undefined,
        });
      }
      return NextResponse.redirect(`${origin}${next}`);
    }
  }
  return NextResponse.redirect(`${origin}/ko/login?error=auth`);
}
