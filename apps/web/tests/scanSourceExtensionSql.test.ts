import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const sql = fs.readFileSync(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../supabase/migrations/0040_scan_source_extension.sql"),
  "utf8",
);

describe("0040 scans.source extension", () => {
  it("source 허용값에 extension을 더한다", () => {
    expect(sql).toMatch(/check \(source in \('user', 'scheduled', 'extension'\)\)/);
  });
  it("백필은 확장이 만든 단일 페이지 보고서로 한정한다", () => {
    expect(sql).toMatch(/s\.source = 'user'/);
    expect(sql).toMatch(/s\.scope is null/);
    expect(sql).toMatch(/s\.page_limit = 1/);
    expect(sql).toMatch(/p\.via = 'extension'/);
  });
});
