import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { sanitizeNextPath } from "@/lib/safeRedirect";
import { ADMIN_TS_COOKIE } from "@/lib/adminIdleCookie";

/**
 * 관리자 무활동 타임아웃 처리 — requireAdmin(RSC)은 쿠키를 지우거나 signOut할 수
 * 없으므로 여기(route handler)로 보내 세션을 정리한 뒤 로그인으로 돌려보낸다.
 * matcher 제외 경로(/auth/**)라 proxy를 거치지 않는다.
 */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const locale = searchParams.get("locale") === "en" ? "en" : "ko";
  const next = sanitizeNextPath(searchParams.get("next"), `/${locale}/dashboard`);

  const supabase = await createClient();
  // 이 기기 세션만 종료 — 20분 무활동은 기기 방치 시나리오이므로 다른 기기까지 죽이지 않는다
  await supabase.auth.signOut({ scope: "local" });

  const res = NextResponse.redirect(
    `${origin}/${locale}/login?reason=timeout&next=${encodeURIComponent(next)}`,
  );
  res.cookies.delete(ADMIN_TS_COOKIE);
  return res;
}
