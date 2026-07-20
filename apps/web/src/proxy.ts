import createIntlMiddleware from "next-intl/middleware";
import { type NextRequest } from "next/server";
import { routing } from "./i18n/routing";
import { updateSession } from "./lib/supabase/middleware";

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
  return [
    "default-src 'self'",
    // strict-dynamic: nonce 스크립트가 로드한 후속 스크립트(Next 청크·Turnstile api.js)까지 신뢰.
    // 'self'·host·'unsafe-inline'은 strict-dynamic 미지원 구형 브라우저용 폴백(지원 브라우저는 무시).
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""} 'unsafe-inline' https://challenges.cloudflare.com`,
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self'",
    "img-src 'self' data: blob:",
    `connect-src 'self' ${supabase} https://challenges.cloudflare.com`,
    "frame-src https://challenges.cloudflare.com",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
  ].join("; ");
}

export async function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const csp = buildCsp(nonce);
  request.headers.set("x-nonce", nonce);
  request.headers.set("content-security-policy", csp);

  const response = intlMiddleware(request);
  response.headers.set("content-security-policy", csp);
  return await updateSession(request, response);
}

export const config = {
  // API·정적 파일·auth 콜백·데모 리다이렉터(route handler) 제외
  matcher: ["/((?!api|auth|demo|_next|_vercel|.*\\..*).*)"],
};
