/**
 * 홍보 문구의 숫자(규칙 수·자동 검출 성공기준)는 getCatalogStats에서 나온다.
 * 생성 문서(docs/coverage.json)와 어긋나면 카탈로그를 바꾸고 coverage를 재생성하지 않은 것이다.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { getCatalogStats } from "../src/catalog/stats";

const coverage = JSON.parse(
  fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../docs/coverage.json"), "utf8"),
) as {
  summary: {
    rules: { total: number; axe: number; custom: number };
    wcag: { totalCriteria: number; automated: number; automatedPct: number };
  };
};

describe("getCatalogStats — 생성 문서와 같은 정의", () => {
  it("규칙 수와 자동 검출 성공기준이 docs/coverage.json과 일치", () => {
    const s = getCatalogStats();
    expect(s.rules).toBe(coverage.summary.rules.total);
    expect(s.axeRules).toBe(coverage.summary.rules.axe);
    expect(s.customRules).toBe(coverage.summary.rules.custom);
    expect(s.wcagTotal).toBe(coverage.summary.wcag.totalCriteria);
    expect(s.wcagAutomated).toBe(coverage.summary.wcag.automated);
    expect(s.wcagAutomatedPct).toBe(coverage.summary.wcag.automatedPct);
  });
});
