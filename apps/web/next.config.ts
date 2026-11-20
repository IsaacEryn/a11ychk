import type { NextConfig } from "next";
import path from "node:path";
import createNextIntlPlugin from "next-intl/plugin";
import { routing } from "./src/i18n/routing";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

/**
 * 프록시(src/proxy.ts)를 건너뛴 없는 주소를 404로 보내는 rewrite.
 *
 * 프록시 matcher는 정적 파일 확장자와 route handler 접두어를 건너뛴다. 그 가운데 실제 파일도 라우트도 아닌 주소는
 * [locale]에 locale 값으로 걸린다(/favicon.ico는 locale이 "favicon.ico"인 홈). 그 라우트가 정적 페이지면
 * 레이아웃의 notFound()가 넘어간 global-not-found에서 요청 헤더를 읽는 순간 Next가 "Page changed from static
 * to dynamic at runtime"을 던져 500이 된다. 그래서 [locale]에 닿기 전에 없는 주소로 돌린다 — afterFiles는
 * 파일·정적 라우트를 확인한 뒤, 동적 라우트보다 먼저 적용된다.
 *
 * [locale] 레이아웃에 dynamicParams = false를 두는 방법은 쓰지 않는다. 아래의 adapterPath와 만나면 Next가
 * 404를 내면서도 "invariant: cache entry required but not generated"를 처리되지 않은 오류로 남겨 관리자
 * 알림이 나간다. 또 [locale] 아래 모든 라우트가 그 값을 물려받아, 빌드 때 주소를 다 만들어 두지 않는 정적
 * 동적 세그먼트를 나중에 추가하면 운영에서만 404가 된다.
 */

/**
 * 첫 번째 rewrite가 건너뛰는 [locale] 밖의 동적 라우트 — rewrite가 동적 라우트보다 먼저 적용되므로 빼지 않으면
 * 그 라우트가 404가 된다. 정적 route handler(/api/health, /auth/callback, /demo)는 rewrite보다 먼저
 * 확인되므로 적을 필요가 없다. /api를 통째로 빼지 않는 이유: /api/about(locale이 "api"인 소개 페이지)이
 * 다시 [locale]에 닿는다. [locale] 밖에 동적 라우트를 새로 두면 여기에 더한다 — 빠뜨리면 test:routes가 잡는다.
 */
const DYNAMIC_OUTSIDE_LOCALE = [
  "api/(?:scans|badge)/", // /api/scans/[id]/…, /api/badge/[hostname] — 이 접두어 아래는 통째로 건너뛴다
  "(?:join|site)/[^/]+/?$", // /join/[code], /site/[hostname] — 한 세그먼트짜리만
];
/** 로케일로 시작하지 않는 주소. /_next/static 아래의 없는 파일은 Next가 가볍게 404로 끝내므로 건드리지 않는다 */
const UNKNOWN_PATH_SOURCE = `/:first((?!(?:${routing.locales.join("|")})(?:/|$)|${DYNAMIC_OUTSIDE_LOCALE.join("|")}|_next/static/)[^/]+)/:rest*`;
/**
 * 점이 든 가이드 슬러그. 가이드 슬러그에는 점이 없고, 없는 슬러그는 프록시가 404로 돌린다(isUnknownGuidePath).
 * 그런데 /ko/guide/x.png처럼 확장자로 끝나면 프록시를 건너뛰어, 빌드 때 만든 주소만 받는 guide/[slug]에 닿는다.
 */
const DOTTED_GUIDE_SOURCE = `/:locale(${routing.locales.join("|")})/guide/:slug([^/]*\\.[^/]*)`;

// 모노레포 루트 (apps/web에서 두 단계 위). Vercel Root Directory=apps/web 기준.
const monorepoRoot = path.join(process.cwd(), "..", "..");

/** 브라우저 번들을 넣는 /api 최상위 폴더 — 결제(billing)만 뺀 전부(아래 outputFileTracingIncludes) */
const API_WITH_BROWSER = "{access-check,admin,auth,badge,cron,extension,health,internal,scans,shell,teaser-scan}";

/** 브라우저 실행 패키지 — 검사 API 함수 번들에 강제로 넣는다(아래 outputFileTracingIncludes) */
const BROWSER_TRACE = [
  "./node_modules/axe-core/**/*",
  "./node_modules/playwright-core/**/*",
  "./node_modules/@sparticuz/chromium/**/*",
  "../../node_modules/axe-core/**/*",
  "../../node_modules/playwright-core/**/*",
  "../../node_modules/@sparticuz/chromium/**/*",
];

const nextConfig: NextConfig = {
  // 모노레포의 core 패키지(TS 소스)를 함께 컴파일
  transpilePackages: ["@a11ychk/core"],
  // 라우트가 없는 주소의 404를 app/global-not-found.tsx로 그린다 — 로케일 레이아웃 안에서
  // notFound()를 던지면 동적 렌더에서는 서버 HTML이 lang 없는 껍데기로 나간다(그 파일 주석 참고)
  experimental: { globalNotFound: true },
  // 번들하지 않고 런타임 require —
  // axe-core: 번들·minify 시 axe.source 문자열이 오염돼 브라우저 주입 시
  //   "ReferenceError: t is not defined"가 나므로 반드시 external로 원본 유지.
  // 브라우저 실행 패키지: 네이티브 바이너리·대용량 의존성이라 번들 부적합.
  serverExternalPackages: ["axe-core", "playwright-core", "playwright", "@sparticuz/chromium"],
  // 모노레포 루트 기준으로 파일 트레이싱 (hoisted node_modules 포함)
  outputFileTracingRoot: monorepoRoot,
  // 브라우저를 실행하는 API 함수 번들에 playwright-core(browsers.json 포함)와
  // @sparticuz/chromium 바이너리를 강제로 포함시킨다.
  // node_modules가 루트로 hoist된 경우(../../)와 apps/web 로컬(./) 둘 다 커버.
  // 결제(/api/billing/** — 토스·Polar 복귀, Polar 웹훅)는 브라우저를 쓰지 않아 뺀다 — 함수가 가벼워져 콜드 스타트가 짧아진다(Polar
  // 웹훅은 10초 안의 응답을 기다린다). Turbopack은 outputFileTracingExcludes를 include한 파일에 적용하지 않아, 키를 결제 밖의
  // /api 최상위 폴더로 적는다 — /api 아래에 새 최상위 폴더를 만들면 API_WITH_BROWSER에 더한다. 두 키는 폴더 자체의 라우트(/api/scans)를
  // 경로 이름(/api/scans 또는 /api/scans/route)과 무관하게 덮는다.
  outputFileTracingIncludes: {
    [`/api/${API_WITH_BROWSER}/**/*`]: BROWSER_TRACE,
    [`/api/${API_WITH_BROWSER}`]: BROWSER_TRACE,
  },
  // 빌드 어댑터 — 정적 페이지 HTML에 인라인 스크립트 해시 CSP(meta)를 넣은 뒤 배포 플랫폼의 어댑터(NEXT_ADAPTER_PATH)에
  // 넘긴다. 플랫폼 어댑터가 next build 안에서 HTML을 배포 산출물로 옮기므로 그보다 먼저 고쳐야 한다(scripts/csp-adapter.mjs).
  adapterPath: path.join(process.cwd(), "scripts", "csp-adapter.mjs"),
  // 도착지는 프록시가 숨긴 관리자 경로를 돌려보내는 곳과 같은 없는 주소다. 프록시를 안 거친 요청이라
  // global-not-found가 이중 언어 404로 끝낸다.
  async rewrites() {
    const destination = `/${routing.defaultLocale}/__404__`;
    return {
      afterFiles: [
        { source: UNKNOWN_PATH_SOURCE, destination },
        { source: DOTTED_GUIDE_SOURCE, destination },
      ],
    };
  },
  async headers() {
    // CSP는 페이지가 정적인지(빌드 때 만든 HTML + 해시) 동적인지(요청별 nonce)에 따라 달라
    // 프록시(src/proxy.ts)에서 부여한다. 여기서는 나머지 보안 헤더만 전 경로에 적용.
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          // HSTS 2년 + 서브도메인 — HTTPS 강제 (Vercel 커스텀 도메인은 자동 부여 안 됨)
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
        ],
      },
    ];
  },
};

export default withNextIntl(nextConfig);
