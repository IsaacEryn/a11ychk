import type { NextRequest } from "next/server";

/**
 * 요청별 콘텐츠 보안 정책 — script-src를 nonce + strict-dynamic으로 잠근다.
 *
 * CSP는 오직 프록시에서만 부여된다(next.config.ts의 headers()는 정적 헤더 담당).
 * 프록시 matcher가 어떤 HTML 경로를 빠뜨리면 그 페이지만 CSP 없이 나가므로,
 * matcher를 손볼 때는 HTML을 반환하는 경로가 빠지지 않는지 함께 확인할 것.
 *
 * 외부 오리진은 실제 쓰는 것만 연다: Turnstile, Supabase. (폰트·스타일은 자체 호스팅)
 */
// 정책에서 nonce를 뺀 나머지는 프로세스 수명 동안 고정이다(NEXT_PUBLIC_*은 빌드 시
// 인라인되고 NODE_ENV도 바뀌지 않는다). 모든 요청이 지나는 자리라 한 번만 조립해 둔다.
const [CSP_HEAD, CSP_TAIL] = (() => {
  const supabase = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "https://*.supabase.co";
  const isDev = process.env.NODE_ENV === "development";
  // GTM/GA4 — NEXT_PUBLIC_GTM_ID 설정 시에만 허용 목록에 추가 (셀프호스팅 기본은 미허용).
  // 부트스트랩 스크립트는 nonce로, GTM이 로드하는 후속 스크립트(gtag 등)는 strict-dynamic으로 신뢰.
  const gtmOn = !!process.env.NEXT_PUBLIC_GTM_ID;
  const gaConnect = gtmOn ? " https://www.googletagmanager.com https://*.google-analytics.com https://analytics.google.com" : "";
  const gaImg = gtmOn ? " https://www.googletagmanager.com https://*.google-analytics.com" : "";
  const gaFrame = gtmOn ? " https://www.googletagmanager.com" : "";
  return [
    "default-src 'self'; script-src 'self' 'nonce-",
    [
      // strict-dynamic: nonce 스크립트가 로드한 후속 스크립트(Next 청크·Turnstile api.js)까지 신뢰.
      // 'self'·host·'unsafe-inline'은 strict-dynamic 미지원 구형 브라우저용 폴백(지원 브라우저는 무시).
      `' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""} 'unsafe-inline' https://challenges.cloudflare.com`,
      "style-src 'self' 'unsafe-inline'",
      "font-src 'self'",
      `img-src 'self' data: blob:${gaImg}`,
      `connect-src 'self' ${supabase} https://challenges.cloudflare.com${gaConnect}`,
      `frame-src https://challenges.cloudflare.com${gaFrame}`,
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "object-src 'none'",
    ].join("; "),
  ];
})();

/**
 * nonce와 CSP를 요청 헤더에 실어 렌더러로 넘긴다 — 응답에 실을 CSP 문자열을 돌려준다.
 *
 * 응답을 만들기 전에 불러야 한다. next-intl 미들웨어가 이 시점의 요청 헤더를
 * 직렬화해 렌더러에 전달하고, Next는 CSP 요청 헤더를 보고 자기 인라인 스크립트에
 * nonce를 자동 부여한다. 커스텀 <Script>는 layout에서 x-nonce를 읽어 명시한다.
 */
export function attachCspToRequest(request: NextRequest): string {
  // 128비트 난수를 그대로 base64로 — UUID 문자열을 다시 인코딩하면 같은 엔트로피가
  // 48자로 늘어나고, 그 길이가 인라인 스크립트 태그마다 반복된다
  const nonce = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16))));
  const csp = CSP_HEAD + nonce + CSP_TAIL;
  request.headers.set("x-nonce", nonce);
  request.headers.set("content-security-policy", csp);
  return csp;
}
