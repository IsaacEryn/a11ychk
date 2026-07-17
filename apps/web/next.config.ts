import type { NextConfig } from "next";
import path from "node:path";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

// 모노레포 루트 (apps/web에서 두 단계 위). Vercel Root Directory=apps/web 기준.
const monorepoRoot = path.join(process.cwd(), "..", "..");

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
  outputFileTracingIncludes: {
    "/api/**/*": [
      "./node_modules/axe-core/**/*",
      "./node_modules/playwright-core/**/*",
      "./node_modules/@sparticuz/chromium/**/*",
      "../../node_modules/axe-core/**/*",
      "../../node_modules/playwright-core/**/*",
      "../../node_modules/@sparticuz/chromium/**/*",
    ],
  },
  async headers() {
    // CSP — defense-in-depth. 외부 오리진은 실제 사용하는 것만 허용:
    // Turnstile, Supabase. (폰트는 자체 호스팅 — Pretendard는 /fonts, Hahmlet은 next/font)
    // Next는 인라인 스크립트/스타일을 쓰므로 unsafe-inline 필요(nonce 전환은 후속).
    const supabase = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "https://*.supabase.co";
    const isDev = process.env.NODE_ENV === "development";
    const csp = [
      "default-src 'self'",
      `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""} https://challenges.cloudflare.com`,
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
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: csp },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
};

export default withNextIntl(nextConfig);
