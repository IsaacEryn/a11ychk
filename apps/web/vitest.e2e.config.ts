import { defineConfig } from "vitest/config";

// 로컬 전용 웹 E2E — 실제 크로미엄으로 실행 중인 앱을 검증한다.
// 실행: (dev 서버 기동 후) npm run test:e2e -w web
//   전제: npx playwright install chromium, 앱이 E2E_BASE_URL(기본 http://localhost:3100)에서 동작
// 인증이 필요한 보고서 필터 테스트는 E2E_REPORT_URL(+선택 E2E_COOKIES)이 있을 때만 실행된다.
export default defineConfig({
  test: {
    include: ["tests-e2e/**/*.test.ts"],
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
