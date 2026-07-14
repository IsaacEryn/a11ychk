import { defineConfig } from "vitest/config";

// 로컬 전용 E2E — 실제 크로미엄으로 fixture 페이지를 스캔한다.
// 실행: npm run test:e2e -w @a11ychk/core (사전 조건: npx playwright install chromium)
export default defineConfig({
  test: {
    include: ["tests-e2e/**/*.test.ts"],
    testTimeout: 60_000,
  },
});
