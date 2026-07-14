import { createServerClient } from "@supabase/ssr";
import { type NextRequest, type NextResponse } from "next/server";

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

  // 세션 갱신 트리거 (반환값은 사용하지 않음 — 페이지에서 개별 확인)
  await supabase.auth.getUser();

  return response;
}
