/**
 * 브라우저 쿠키 문자열에 Supabase 인증 세션이 있는지 판별 (AuthSync가 사용).
 *
 * @supabase/ssr의 세션 쿠키 이름은 sb-<프로젝트ref>-auth-token이고, 값이 길면
 * .0 .1 …로 분할된다. 로그인 진행 중에만 생기는 sb-…-auth-token-code-verifier는
 * 세션이 아니므로 세지 않는다 — 이걸 세면 로그인 시도 중을 로그인 상태로 오판한다.
 */
const AUTH_COOKIE = /(?:^|;\s*)sb-[^=;]*-auth-token(?:\.\d+)?=/;

export function hasAuthCookie(cookieString: string): boolean {
  return AUTH_COOKIE.test(cookieString);
}
