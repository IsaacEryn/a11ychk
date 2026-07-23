import createIntlMiddleware from "next-intl/middleware";
import { NextResponse, type NextRequest } from "next/server";
import { routing } from "./i18n/routing";
import { updateSession } from "./lib/supabase/middleware";
import { getAdminSlug, isExternalAdminPath, isInternalAdminPath, slugToInternal } from "./lib/adminSlug";
import { ADMIN_TS_COOKIE, adminTsCookieOptions, isIdleExpired, signAdminTs, verifyAdminTs } from "./lib/adminIdleCookie";

const intlMiddleware = createIntlMiddleware(routing);

/**
 * 요청별 CSP — script-src를 nonce + strict-dynamic으로 잠근다 (unsafe-inline 제거).
 * next-intl 미들웨어가 수정된 요청 헤더를 렌더러에 전달하므로, 호출 전에
 * content-security-policy 요청 헤더를 실어 두면 Next가 자기 인라인 스크립트에
 * nonce를 자동 부여한다. 커스텀 <Script>는 layout에서 x-nonce를 읽어 명시한다.
 * 외부 오리진은 실제 사용하는 것만: Turnstile, Supabase. (폰트·스타일은 자체 호스팅)
 */
function buildCsp(nonce: string): string {
  const supabase = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "https://*.supabase.co";
  const isDev = process.env.NODE_ENV === "development";
  // GTM/GA4 — NEXT_PUBLIC_GTM_ID 설정 시에만 허용 목록에 추가 (셀프호스팅 기본은 미허용).
  // 부트스트랩 스크립트는 nonce로, GTM이 로드하는 후속 스크립트(gtag 등)는 strict-dynamic으로 신뢰.
  const gtmOn = !!process.env.NEXT_PUBLIC_GTM_ID;
  const gaConnect = gtmOn ? " https://www.googletagmanager.com https://*.google-analytics.com https://analytics.google.com" : "";
  const gaImg = gtmOn ? " https://www.googletagmanager.com https://*.google-analytics.com" : "";
  const gaFrame = gtmOn ? " https://www.googletagmanager.com" : "";
  return [
    "default-src 'self'",
    // strict-dynamic: nonce 스크립트가 로드한 후속 스크립트(Next 청크·Turnstile api.js)까지 신뢰.
    // 'self'·host·'unsafe-inline'은 strict-dynamic 미지원 구형 브라우저용 폴백(지원 브라우저는 무시).
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""} 'unsafe-inline' https://challenges.cloudflare.com`,
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self'",
    `img-src 'self' data: blob:${gaImg}`,
    `connect-src 'self' ${supabase} https://challenges.cloudflare.com${gaConnect}`,
    `frame-src https://challenges.cloudflare.com${gaFrame}`,
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
  ].join("; ");
}

export async function proxy(request: NextRequest) {
  const slug = getAdminSlug();
  const pathname = request.nextUrl.pathname;

  // ── 관리자 슬러그 1: slug 활성 시 내부 /admin 직접 접근은 not-found ──
  // 같은 로케일의 미존재 경로로 rewrite해, 임의의 오타 URL과 상태코드·본문이
  // 완전히 동일한 응답을 만든다 (빈 404 응답을 직접 만들거나 로케일 밖으로
  // 보내면 상태코드 차이로 "여기 뭔가 있다"는 지문이 남는다).
  if (slug && isInternalAdminPath(pathname)) {
    const url = request.nextUrl.clone();
    const locale = pathname.startsWith("/en") ? "en" : "ko";
    url.pathname = `/${locale}/__404__`;
    return NextResponse.rewrite(url);
  }

  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const csp = buildCsp(nonce);
  request.headers.set("x-nonce", nonce);
  request.headers.set("content-security-policy", csp);
  // requireAdmin이 로그인 후 돌아올 외부(슬러그) 경로를 알 수 있도록 전달
  request.headers.set("x-pathname", pathname + request.nextUrl.search);

  // intl은 항상 원(슬러그) 요청 기준으로 실행 — 무접두 /slug 요청의 redirect
  // Location이 /ko/slug 형태로 슬러그를 유지한다 (admin 유출 없음).
  const intlResponse = intlMiddleware(request);
  intlResponse.headers.set("content-security-policy", csp);

  // ── 관리자 슬러그 2: 슬러그 경로면 내부 /admin 라우트로 rewrite ──
  let response = intlResponse;
  const internal = slug ? slugToInternal(pathname, slug) : null;
  if (internal && !intlResponse.headers.get("location")) {
    const url = request.nextUrl.clone();
    url.pathname = internal;
    response = NextResponse.rewrite(url, { request: { headers: request.headers } });
    // intl 응답의 헤더를 이관 — x-middleware-override-headers/x-middleware-request-*
    // (intl의 로케일 헤더 + 위의 nonce·CSP 요청 헤더 전달 메커니즘)를 유지한다.
    // x-middleware-next만 제외(우리 응답은 rewrite), 쿠키는 API로 복사.
    intlResponse.headers.forEach((value, key) => {
      if (key !== "x-middleware-next" && key !== "set-cookie") response.headers.set(key, value);
    });
    for (const cookie of intlResponse.cookies.getAll()) response.cookies.set(cookie);
  }

  const final = await updateSession(request, response);

  // ── 관리자 무활동 타임아웃: 슬라이딩 갱신 ──
  // 발급은 post-login(AAL2 완성 시)에서만 하고, 여기서는 "유효하고 아직 만료 전인
  // 쿠키가 있을 때만" 새 타임스탬프로 연장한다. 만료·부재·변조 쿠키는 되살리지
  // 않는다(검사·강제는 requireAdmin → /auth/admin-timeout). 이 쿠키는 권한을 부여
  // 하지 않으므로 role 확인 없이 갱신해도 무해하다.
  if (isExternalAdminPath(pathname)) {
    const ts = await verifyAdminTs(request.cookies.get(ADMIN_TS_COOKIE)?.value);
    if (ts !== null && !isIdleExpired(ts)) {
      final.cookies.set(ADMIN_TS_COOKIE, await signAdminTs(), adminTsCookieOptions());
    }
  }

  return final;
}

export const config = {
  // API·정적 파일·auth 콜백·데모/초대 리다이렉터(route handler) 제외
  matcher: ["/((?!api|auth|demo|join|_next|_vercel|.*\\..*).*)"],
};
