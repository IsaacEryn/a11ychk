import createIntlMiddleware from "next-intl/middleware";
import { NextResponse, type NextRequest } from "next/server";
import { localeFromPathname, routing } from "./i18n/routing";
import { applyRefreshedCookies, refreshSession } from "./lib/supabase/middleware";
import { attachCspToRequest } from "./lib/security/csp";
import { getAdminSlug, isExternalAdminPath, isInternalAdminPath, slugToInternal } from "./lib/adminSlug";
import { ADMIN_TS_COOKIE, adminTsCookieOptions, isIdleExpired, signAdminTs, verifyAdminTs } from "./lib/adminIdleCookie";

const intlMiddleware = createIntlMiddleware(routing);

/**
 * 모든 페이지 요청이 지나는 파이프라인. 단계 순서에 제약이 있어 그대로 유지할 것:
 *
 *   1. 관리자 경로 판정 — 응답을 만들지 않고 "어디로 rewrite할지"만 정한다.
 *      여기서 바로 반환하면 그 응답만 CSP·세션 갱신을 건너뛰어, 오타 URL의 404와
 *      헤더가 달라진다(숨긴 관리자 경로의 존재가 드러나는 지문).
 *   2. CSP·nonce를 요청 헤더에 적재 — intl보다 먼저여야 렌더러까지 전달된다.
 *   3. 세션 갱신 — intl이 요청을 스냅샷하기 전이어야 갱신된 토큰이 렌더러에 닿는다.
 *   4. intl 실행 — 원(슬러그) 경로 기준이어야 redirect Location이 슬러그를 유지한다.
 *   5. 최종 응답 선택 후 CSP·갱신 쿠키·무활동 쿠키 적용.
 */
export async function proxy(request: NextRequest) {
  const slug = getAdminSlug();
  const pathname = request.nextUrl.pathname;

  // ── 1. 관리자 슬러그 경로 판정 ──
  // slug 활성 시 내부 /admin 직접 접근은 같은 로케일의 미존재 경로로 돌려, 임의의
  // 오타 URL과 상태코드·본문·헤더가 완전히 같은 응답을 만든다.
  const masked = slug && isInternalAdminPath(pathname) ? `/${localeFromPathname(pathname)}/__404__` : null;

  // ── 2. 요청별 CSP·nonce ──
  const csp = attachCspToRequest(request);
  // requireAdmin이 로그인 후 돌아올 외부(슬러그) 경로를 알 수 있도록 전달
  request.headers.set("x-pathname", pathname + request.nextUrl.search);

  // ── 3. 세션 갱신 (응답 생성 전) ──
  const refreshed = await refreshSession(request);

  // ── 4. intl — 항상 원(슬러그) 요청 기준 ──
  const intlResponse = intlMiddleware(request);

  // 슬러그 경로면 내부 /admin 라우트로 돌린다
  const rewriteTo = masked ?? (slug ? slugToInternal(pathname, slug) : null);

  // ── 5. 최종 응답 ──
  // intl이 리다이렉트를 냈으면 rewrite하지 않는다 — 두 지시를 겹치면 응답에 Location이
  // 남아 내부 /admin 매핑이 그대로 드러난다. 리다이렉트를 따라온 다음 요청에서 처리된다.
  let response = intlResponse;
  if (rewriteTo && !intlResponse.headers.get("location")) {
    const url = request.nextUrl.clone();
    url.pathname = rewriteTo;
    response = NextResponse.rewrite(url, { request: { headers: request.headers } });
    // intl 응답의 헤더를 이관 — x-middleware-override-headers/x-middleware-request-*
    // (intl의 로케일 헤더 + 위의 nonce·CSP 요청 헤더 전달 메커니즘)를 유지한다.
    // 우리 응답이 rewrite이므로 intl이 낸 라우팅 지시 헤더는 덮어쓰지 않는다.
    intlResponse.headers.forEach((value, key) => {
      if (key !== "x-middleware-next" && key !== "x-middleware-rewrite" && key !== "set-cookie") {
        response.headers.set(key, value);
      }
    });
    for (const cookie of intlResponse.cookies.getAll()) response.cookies.set(cookie);
  }
  // 어느 응답으로 끝나든 같은 헤더를 붙인다 — rewrite 분기의 헤더 복사 필터에
  // CSP 전달을 의존시키지 않는다
  response.headers.set("content-security-policy", csp);
  applyRefreshedCookies(response, refreshed);

  // 관리자 무활동 타임아웃 슬라이딩 갱신 — 발급은 post-login(AAL2 완성 시)에서만 하고,
  // 여기서는 "유효하고 아직 만료 전인 쿠키가 있을 때만" 연장한다. 만료·부재·변조 쿠키는
  // 되살리지 않는다(검사·강제는 requireAdmin → /auth/admin-timeout). 이 쿠키는 권한을
  // 부여하지 않으므로 role 확인 없이 갱신해도 무해하다.
  if (isExternalAdminPath(pathname)) {
    const ts = await verifyAdminTs(request.cookies.get(ADMIN_TS_COOKIE)?.value);
    if (ts !== null && !isIdleExpired(ts)) {
      response.cookies.set(ADMIN_TS_COOKIE, await signAdminTs(), adminTsCookieOptions());
    }
  }

  return response;
}

export const config = {
  // HTML을 반환하지 않는 경로만 제외한다 — api·auth 콜백·데모/초대·배지 리졸버(route
  // handler)와 정적 파일.
  //
  // 정적 파일은 확장자로 거른다. 예전처럼 "점이 들어간 경로"를 통째로 빼면
  // /ko/directory/example.com 같은 호스트명 세그먼트까지 빠져서 그 페이지들만
  // CSP·세션 갱신 없이 나갔다.
  //
  // 이 목록을 손볼 때는 test:routes의 CSP 검사가 함께 지킨다 — HTML 경로가 빠지면
  // CSP 누락으로, route handler가 들어오면 로케일 리다이렉트로 잡힌다.
  matcher: [
    "/((?!api|auth|demo|join|site|_next|_vercel|.*\\.(?:ico|png|jpg|jpeg|gif|svg|webp|avif|html|txt|xml|json|webmanifest|css|js|map|woff|woff2|ttf|otf|mp4|webm|pdf)$).*)",
  ],
};
