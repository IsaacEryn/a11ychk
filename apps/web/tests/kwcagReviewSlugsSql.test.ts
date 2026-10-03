import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { KWCAG_LEGACY_IDS } from "@a11ychk/core/catalog";

const sql = fs.readFileSync(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../supabase/migrations/0039_kwcag_review_slugs.sql"),
  "utf8",
);

describe("0039 정리 SQL", () => {
  it("대응표가 core의 KWCAG_LEGACY_IDS와 같다", () => {
    const pairs = Object.fromEntries(
      [...sql.matchAll(/\('([0-9.]+)',\s*'([a-z0-9-]+)'\)/g)].map((m) => [m[1], m[2]]),
    );
    expect(pairs).toEqual({ ...KWCAG_LEGACY_IDS });
  });

  it("kwcag 행만 건드린다", () => {
    // 삭제와 갱신, 두 문장 모두 kwcag 행으로 한정돼야 한다 — 한 번만 나오면 한쪽 조건이 빠진 것이다
    expect(sql.match(/r\.standard = 'kwcag'/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
    expect(sql).not.toMatch(/standard = 'wcag'/);
  });
});
