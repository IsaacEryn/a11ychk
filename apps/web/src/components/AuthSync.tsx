"use client";
import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { hasAuthCookie } from "@/lib/authCookie";

/**
 * 서버가 로그아웃시켰는데 화면은 로그인으로 남는 문제를 잡는 안전망.
 *
 * 헤더는 [locale] 레이아웃에 있고, 레이아웃은 소프트 내비게이션에서 다시 렌더되지
 * 않는다. 로그아웃 버튼(서버 액션)은 라우터 캐시를 통째로 무효화해 주지만, 서버가
 * 일방적으로 세션을 끊는 두 경로 — 관리자 무활동 타임아웃(/auth/admin-timeout)과
 * 미들웨어의 로그인 절대 유지 시간 만료 — 는 클라이언트에 알릴 방법이 없어서,
 * 쿠키는 지워졌는데 헤더만 로그인 상태로 남았다.
 *
 * 그래서 경로가 바뀔 때마다 "서버가 렌더했던 로그인 상태"와 "지금 브라우저에 인증
 * 쿠키가 있는지"를 대조하고, 어긋나면 router.refresh()로 레이아웃까지 다시 그린다.
 * (@supabase/ssr 쿠키는 httpOnly가 아니다 — 로그인 폼의 브라우저 클라이언트가
 * 이미 같은 전제로 동작한다.)
 *
 * 검사는 "로그인으로 렌더됐는데 쿠키가 없다"는 한 방향만 본다. 반대 방향(쿠키는
 * 있는데 로그아웃으로 렌더)은 만료된 토큰이 쿠키에 남은 경우 refresh를 해도 서버가
 * 계속 로그아웃으로 판정하므로 무한 새로고침이 된다. 한 방향만 보면 refresh 후
 * wasLoggedIn이 false가 되어 두 번 다시 발화하지 않는다.
 */
export function AuthSync({ wasLoggedIn }: { wasLoggedIn: boolean }) {
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    const check = () => {
      if (wasLoggedIn && !hasAuthCookie(document.cookie)) router.refresh();
    };
    check();
    // 다른 탭에서 로그아웃한 뒤 이 탭으로 돌아온 경우도 같은 증상이라 함께 잡는다
    const onVisible = () => {
      if (document.visibilityState === "visible") check();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [pathname, wasLoggedIn, router]);

  return null;
}
