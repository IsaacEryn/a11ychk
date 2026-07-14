import type { NextConfig } from "next";
import path from "node:path";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

// 모노레포 루트 (apps/web에서 두 단계 위). Vercel Root Directory=apps/web 기준.
const monorepoRoot = path.join(process.cwd(), "..", "..");

const nextConfig: NextConfig = {
  // 모노레포의 core 패키지(TS 소스)를 함께 컴파일
  transpilePackages: ["@a11ychk/core"],
  // 헤드리스 브라우저 관련 패키지는 번들하지 않고 런타임 require
  serverExternalPackages: ["playwright-core", "playwright", "@sparticuz/chromium"],
  // 모노레포 루트 기준으로 파일 트레이싱 (hoisted node_modules 포함)
  outputFileTracingRoot: monorepoRoot,
  // 브라우저를 실행하는 API 함수 번들에 playwright-core(browsers.json 포함)와
  // @sparticuz/chromium 바이너리를 강제로 포함시킨다.
  // node_modules가 루트로 hoist된 경우(../../)와 apps/web 로컬(./) 둘 다 커버.
  outputFileTracingIncludes: {
    "/api/**/*": [
      "./node_modules/playwright-core/**/*",
      "./node_modules/@sparticuz/chromium/**/*",
      "../../node_modules/playwright-core/**/*",
      "../../node_modules/@sparticuz/chromium/**/*",
    ],
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
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
