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

  it("한 문장으로 끝난다 — SQL Editor가 문장을 따로 실행해도 깨지지 않게", () => {
    // 임시 테이블을 만든 뒤 다음 문장에서 쓰던 처음 판은 SQL Editor에서 42P01로 실패했다
    expect(sql).not.toMatch(/create temporary table/i);
    expect(sql).not.toMatch(/^\s*(begin|commit);/im);
    expect(sql.match(/;\s*$/gm)?.length).toBe(1);
  });

  it("같은 문장에서 지운 행은 갱신 대상에서 뺀다", () => {
    // 데이터 변경 CTE의 delete 결과는 같은 문장의 update에 보이지 않는다
    expect(sql).toMatch(/r\.id not in \(select id from stale\)/);
  });
});
