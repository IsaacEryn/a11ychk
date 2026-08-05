import { createServerClient } from "@supabase/ssr";
import type { NextRequest, NextResponse } from "next/server";

/**
 * 로그인 절대 유지 시간(시간 단위). 마지막 로그인으로부터 이 시간이 지나면
 * 리프레시 토큰이 살아 있어도 강제 로그아웃한다. Supabase 무료 플랜은
 * 세션 타임박스를 지원하지 않아 앱 레벨에서 시행한다.
 */
const SESSION_MAX_HOURS = Number(process.env.SESSION_MAX_HOURS ?? 24);

/** 갱신 과정에서 발급된 쿠키 — 최종 응답에 실어야 브라우저가 새 토큰을 받는다 */
export interface RefreshedCookie {
  name: string;
  value: string;
  options?: Parameters<NextResponse["cookies"]["set"]>[2];
}

/**
 * 세션 토큰 갱신 — 응답을 만들기 **전에** 부른다.
 *
 * 갱신된 쿠키는 request.cookies에 바로 반영하고 발급 목록으로도 돌려준다. 응답을
 * 먼저 만들어 두고 갱신하면, 그 응답이 이미 담아 둔 요청 헤더 스냅샷에는 옛 토큰이
 * 들어 있어 렌더러가 만료된 토큰으로 다시 갱신을 시도하게 된다(토큰 회전 충돌).
 * 호출자는 돌려받은 목록을 applyRefreshedCookies로 최종 응답에 얹는다.
 */
export async function refreshSession(request: NextRequest): Promise<RefreshedCookie[]> {
  const issued: RefreshedCookie[] = [];
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          for (const { name, value, options } of cookiesToSet) {
            request.cookies.set(name, value);
            issued.push({ name, value, options });
          }
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

  return issued;
}

/** refreshSession이 발급한 쿠키를 최종 응답에 얹는다 */
export function applyRefreshedCookies(response: NextResponse, cookies: RefreshedCookie[]): void {
  for (const { name, value, options } of cookies) response.cookies.set(name, value, options);
}
