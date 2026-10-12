import type { NextConfig } from "next";
import path from "node:path";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

// 모노레포 루트 (apps/web에서 두 단계 위). Vercel Root Directory=apps/web 기준.
const monorepoRoot = path.join(process.cwd(), "..", "..");

/** 브라우저 번들을 넣는 /api 최상위 폴더 — 결제(billing)만 뺀 전부(아래 outputFileTracingIncludes) */
const API_WITH_BROWSER = "{access-check,admin,auth,badge,cron,extension,health,internal,scans,teaser-scan}";

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
  async headers() {
    // CSP는 요청별 nonce가 필요해 미들웨어(src/proxy.ts)에서 부여한다.
    // 여기서는 나머지 보안 헤더만 전 경로에 적용.
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
