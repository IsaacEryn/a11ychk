import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * 검사 API 함수에 브라우저 번들(chromium·playwright·axe-core)을 넣는 tracing include(next.config.ts)는 결제(/api/billing)를 뺀
 * /api 최상위 폴더를 하나씩 적는다(Turbopack은 exclude를 include한 파일에 적용하지 않는다). /api 아래에 새 폴더가 생겼는데 목록에
 * 없으면 그 라우트가 브라우저 없이 배포되어 실행할 때만 깨진다 — 여기서 잡는다.
 */
describe("next.config tracing include — 브라우저 번들을 받는 /api 폴더", () => {
  it("결제(billing)만 빼고 /api의 모든 최상위 폴더를 덮는다", () => {
    const config = readFileSync(new URL("../next.config.ts", import.meta.url), "utf8");
    const listed = /const API_WITH_BROWSER = "\{([^}]*)\}"/.exec(config)?.[1].split(",") ?? [];
    const folders = readdirSync(new URL("../src/app/api", import.meta.url), { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
    expect(folders).toContain("billing");
    expect([...listed].sort()).toEqual(folders.filter((f) => f !== "billing").sort());
  });
});
