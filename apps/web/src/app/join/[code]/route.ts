import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { negotiateLocale } from "@/lib/negotiateLocale";
import { REFERRAL_CODE_PATTERN } from "@/lib/referral/code";
import { REFERRAL_COOKIE, REFERRAL_COOKIE_MAX_AGE } from "@/lib/referral/constants";

/**
 * 초대 링크 진입점 — a11ychk.com/join/<code>
 * 코드를 httpOnly 쿠키(30일)에 심고 로그인(가입) 페이지로 보낸다.
 * 쿠키 방식이라 이메일 가입·OAuth 어느 경로로 가입해도 auth 콜백이 소비할 수 있다.
 * 무효 코드도 동일하게 리다이렉트해 코드 존재 여부를 노출하지 않는다(열거 차단).
 * ⚠️ proxy.ts matcher가 /join을 intl 미들웨어에서 제외해야 이 라우트에 도달한다.
 */
export async function GET(request: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const { origin } = new URL(request.url);
  const locale = negotiateLocale(request);
  const res = NextResponse.redirect(`${origin}/${locale}/login?ref=1`);

  if (REFERRAL_CODE_PATTERN.test(code)) {
    try {
      const { data } = await createAdminClient()
        .from("profiles")
        .select("id")
        .eq("referral_code", code)
        .maybeSingle();
      if (data) {
        res.cookies.set(REFERRAL_COOKIE, code, {
          httpOnly: true,
          secure: true,
          sameSite: "lax",
          maxAge: REFERRAL_COOKIE_MAX_AGE,
          path: "/",
        });
      }
    } catch {
      // 컬럼 부재(0024 미적용) 등 — 쿠키 없이 로그인 페이지로
    }
  }
  return res;
}
