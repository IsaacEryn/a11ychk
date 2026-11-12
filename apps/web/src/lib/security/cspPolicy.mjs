/**
 * CSP 정책 조립과 정적 페이지 판정 — 프록시(./csp.ts)와 빌드 후처리(scripts/csp-static-pages.mjs)가 함께 쓴다.
 *
 * 빌드 후처리가 Node로 직접 import하므로 의존성 없는 순수 ESM으로 둔다(TS 경로 별칭·확장자 없는 import 금지).
 *
 * 페이지는 두 갈래로 나간다.
 *
 * - 동적 페이지: 프록시가 요청마다 nonce를 발급하고 Next가 자기 스크립트에 붙인다. 정책은
 *   `'nonce-…' 'strict-dynamic'` + 레이아웃 인라인 스크립트(테마·GTM)의 해시.
 * - 정적 페이지(STATIC_PAGE_PATHS): 빌드 때 HTML이 만들어져 nonce를 넣을 수 없다. 빌드 후처리가
 *   HTML 안의 인라인 스크립트(RSC 페이로드 포함)를 전부 해시해 `<meta http-equiv="Content-Security-Policy">`로
 *   박는다. 프록시가 보내는 헤더 정책은 "바깥 한계"만 맡는다 — 브라우저는 여러 정책을 모두 통과한
 *   스크립트만 실행하므로, 실효 정책은 meta의 해시 목록이다.
 */

/**
 * 로케일 뒤 경로가 이 중 하나면 빌드 때 만든 HTML을 그대로 내보낸다("" = 로케일 홈).
 *
 * 요청 정보·DB를 읽지 않는 [locale] 페이지는 Next가 알아서 정적으로 만든다. 그런 페이지를 새로 만들면
 * 여기에 더하거나(정적), 요청마다 렌더해야 하면 페이지에서 await connection()을 부른다 — 빌드 후처리가
 * 둘 중 하나가 아니면 빌드를 실패시킨다.
 */
export const STATIC_PAGE_PATHS = ["", "/about", "/accessibility", "/auth/reset", "/bot", "/guide", "/privacy", "/sitemap", "/terms"];

/** 슬러그가 붙는 정적 페이지 — 가이드 항목(KWCAG 슬러그, generateStaticParams로 전부 미리 만든다) */
export const STATIC_GUIDE_PREFIX = "/guide/";

/**
 * 이 경로가 빌드 때 만든 정적 페이지인지.
 *
 * guideSlugs를 넘기면 가이드 슬러그를 그 집합으로 확인한다(프록시). 없는 슬러그는 런타임에 404를 렌더하므로
 * 동적 페이지로 보아 nonce를 붙여야 한다. 빌드 후처리는 실제로 만들어진 경로만 넣으므로 넘기지 않는다.
 *
 * @param {string} pathname
 * @param {{ locales: readonly string[]; guideSlugs?: ReadonlySet<string> }} opts
 * @returns {boolean}
 */
export function isStaticPagePath(pathname, { locales, guideSlugs }) {
  const m = /^\/([^/]+)(\/.*)?$/.exec(pathname);
  if (!m || !locales.includes(m[1])) return false;
  const rest = m[2] ?? "";
  if (STATIC_PAGE_PATHS.includes(rest)) return true;
  if (rest.startsWith(STATIC_GUIDE_PREFIX)) {
    const slug = rest.slice(STATIC_GUIDE_PREFIX.length);
    return guideSlugs ? guideSlugs.has(slug) : /^[a-z0-9-]+$/.test(slug);
  }
  return false;
}

/**
 * @typedef {{ NEXT_PUBLIC_SUPABASE_URL?: string; NEXT_PUBLIC_GTM_ID?: string; BILLING_MODE?: string }} CspEnv
 */

/**
 * 토스 결제창 — BILLING_MODE가 test·live일 때만 연다. lib/billing/config.ts는 server-only라 여기서 import하지
 * 않고 같은 판정(모드 값)만 읽는다. 키 접두가 어긋나 서버가 off로 떨어져도 허용 목록이 조금 넓을 뿐 결제는 서버에서 막힌다.
 *
 * @param {CspEnv} env
 */
function billingOn(env) {
  return ["test", "live"].includes(env.BILLING_MODE?.trim() ?? "");
}

/**
 * script-src에 여는 외부 출처. 동적 페이지는 strict-dynamic이 이 목록을 무시하고(구형 브라우저 폴백),
 * 정적 페이지는 strict-dynamic 없이 이 목록과 'self'로 외부 스크립트를 허용한다.
 *
 * - Turnstile(api.js), 결제 모드면 토스 SDK
 * - GTM을 켰으면 googletagmanager.com — gtm.js와 GTM이 부르는 gtag.js가 모두 이 출처다
 *
 * @param {CspEnv} env
 * @returns {string[]}
 */
export function scriptHosts(env) {
  return [
    "https://challenges.cloudflare.com",
    ...(billingOn(env) ? ["https://js.tosspayments.com"] : []),
    ...(env.NEXT_PUBLIC_GTM_ID ? ["https://www.googletagmanager.com"] : []),
  ];
}

/**
 * 전체 정책 문자열 — script-src 값만 호출자가 정한다(nonce 정책·정적 바깥 한계).
 * 외부 오리진은 실제 쓰는 것만 연다: Turnstile, Supabase, GTM(켰을 때), 토스(결제 모드일 때). 폰트·스타일은 자체 호스팅.
 *
 * @param {string} scriptSrc  "script-src " 뒤에 올 값
 * @param {CspEnv} env
 * @returns {string}
 */
export function buildCsp(scriptSrc, env) {
  const supabase = env.NEXT_PUBLIC_SUPABASE_URL ?? "https://*.supabase.co";
  const gtmOn = !!env.NEXT_PUBLIC_GTM_ID;
  const gaConnect = gtmOn ? " https://www.googletagmanager.com https://*.google-analytics.com https://analytics.google.com" : "";
  const gaImg = gtmOn ? " https://www.googletagmanager.com https://*.google-analytics.com" : "";
  const gaFrame = gtmOn ? " https://www.googletagmanager.com" : "";
  // 토스 SDK v2 — 결제창 iframe·API 호출·이미지·결제창이 보내는 폼은 *.tosspayments.com
  const toss = billingOn(env) ? " https://*.tosspayments.com" : "";
  return [
    "default-src 'self'",
    `script-src ${scriptSrc}`,
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self'",
    `img-src 'self' data: blob:${gaImg}${toss}`,
    `connect-src 'self' ${supabase} https://challenges.cloudflare.com${gaConnect}${toss}`,
    `frame-src https://challenges.cloudflare.com${gaFrame}${toss}`,
    "frame-ancestors 'none'",
    "base-uri 'self'",
    `form-action 'self'${toss}`,
    "object-src 'none'",
  ].join("; ");
}

/**
 * 정적 페이지 HTML에 박는 meta 정책 — 그 페이지의 인라인 스크립트 해시만 허용한다.
 * 'unsafe-inline'·'strict-dynamic'은 넣지 않는다. 외부 스크립트는 'self'(Next 청크)와 scriptHosts뿐이다.
 *
 * @param {readonly string[]} hashes  'sha256-…' 형태
 * @param {CspEnv} env
 * @returns {string}
 */
export function staticPageMetaPolicy(hashes, env) {
  return `script-src 'self' ${[...hashes, ...scriptHosts(env)].join(" ")}`;
}
