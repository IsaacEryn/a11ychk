import { createServerClient } from "@supabase/ssr";
import { type NextRequest, type NextResponse } from "next/server";

/**
 * 로그인 절대 유지 시간(시간 단위). 마지막 로그인으로부터 이 시간이 지나면
 * 리프레시 토큰이 살아 있어도 강제 로그아웃한다. Supabase 무료 플랜은
 * 세션 타임박스를 지원하지 않아 앱 레벨에서 시행한다.
 */
const SESSION_MAX_HOURS = Number(process.env.SESSION_MAX_HOURS ?? 24);

/** 미들웨어에서 세션 토큰 갱신 — next-intl이 만든 response에 쿠키를 이어 쓴다 */
export async function updateSession(request: NextRequest, response: NextResponse) {
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        },
      },
    },
  );

  // 세션 갱신 트리거 + 로그인 절대 유지 시간 검사
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user?.last_sign_in_at && Number.isFinite(SESSION_MAX_HOURS) && SESSION_MAX_HOURS > 0) {
    const ageMs = Date.now() - new Date(user.last_sign_in_at).getTime();
    if (ageMs > SESSION_MAX_HOURS * 3_600_000) {
      // 이 기기 세션만 종료 (다른 기기는 각자 만료 시점에 종료됨).
      // 리다이렉트 없이 쿠키만 지운다 — 보호 페이지는 각자의 가드가 로그인으로 안내한다.
      await supabase.auth.signOut({ scope: "local" });
    }
  }

  return response;
}
