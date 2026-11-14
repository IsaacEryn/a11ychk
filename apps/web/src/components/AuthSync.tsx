"use client";
import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { syncAuthHint } from "@/lib/authHint";

/**
 * 화면의 로그인 힌트(<html data-auth>)를 브라우저 쿠키에 맞춰 두는 안전망.
 *
 * 헤더의 로그인·비로그인 표시는 정적 HTML에 둘 다 들어 있고 data-auth가 한쪽만 보이게 한다
 * (globals.css의 .auth-in/.auth-out). 첫 값은 boot 스크립트가 정하지만, 페이지를 새로 받지 않는
 * 소프트 내비게이션에서는 다시 정할 기회가 없다. 서버가 일방적으로 세션을 끊는 두 경로 — 관리자
 * 무활동 타임아웃(/auth/admin-timeout)과 프록시의 로그인 절대 유지 시간 만료 — 는 쿠키만 지우고
 * 클라이언트에 알릴 방법이 없어서, 그대로 두면 헤더만 로그인 상태로 남는다.
 *
 * 그래서 경로가 바뀔 때마다(그리고 탭으로 돌아올 때마다) 쿠키를 다시 보고 힌트를 고친다.
 * (@supabase/ssr 쿠키는 httpOnly가 아니다 — 로그인 폼의 브라우저 클라이언트가 이미 같은 전제로 동작한다.)
 *
 * 로그인 → 로그아웃으로 바뀌었을 때만 router.refresh()로 지금 페이지까지 다시 그린다(동적 페이지가
 * 로그인 화면을 들고 있을 수 있다). 반대 방향(쿠키는 있는데 서버는 로그아웃으로 판정)은 만료된 토큰이
 * 쿠키에 남은 경우라 refresh를 해도 바뀌지 않으므로 힌트만 고친다 — 그 쿠키는 다음 요청에서 프록시의
 * 세션 갱신이 지운다.
 */
export function AuthSync() {
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    const check = () => {
      const { was, now } = syncAuthHint();
      if (was && !now) router.refresh();
    };
    check();
    // 다른 탭에서 로그아웃한 뒤 이 탭으로 돌아온 경우도 같은 증상이라 함께 잡는다
    const onVisible = () => {
      if (document.visibilityState === "visible") check();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [pathname, router]);

  return null;
}
