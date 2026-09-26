/**
 * 카탈로그 통계 — 홍보·소개 문구의 "규칙 N개 · 성공기준 M개 중 K개 자동 검출"을 카탈로그에서
 * 직접 계산한다. 문구에 숫자를 박아 두면 규칙이 106→111→113으로 늘 때마다 어긋났다.
 * 정의는 scripts/coverage-report.ts(docs/coverage.md)와 같다: "자동 검출 가능" = 위반을 잡는 규칙 1개 이상.
 */
import { RULE_CATALOG } from "./rules";
import { WCAG_CRITERIA } from "./wcag";

export interface CatalogStats {
  /** 전체 규칙 수 (axe + 자체) */
  rules: number;
  axeRules: number;
  customRules: number;
  /** WCAG 2.2 A·AA 성공기준 수 */
  wcagTotal: number;
  /** 위반을 자동 검출할 수 있는 성공기준 수 */
  wcagAutomated: number;
  /** wcagAutomated / wcagTotal (%, 소수 첫째 자리) */
  wcagAutomatedPct: number;
}

/** 자체 규칙인가 — axe 규칙과 구분하는 유일한 기준(커버리지 문서와 공유) */
export function isCustomRule(ruleId: string): boolean {
  return ruleId.startsWith("a11ychk");
}

export function getCatalogStats(): CatalogStats {
  const customRules = RULE_CATALOG.filter((r) => isCustomRule(r.ruleId)).length;
  const mapped = new Set(RULE_CATALOG.flatMap((r) => r.wcag));
  const wcagAutomated = WCAG_CRITERIA.filter((c) => mapped.has(c.id)).length;
  return {
    rules: RULE_CATALOG.length,
    axeRules: RULE_CATALOG.length - customRules,
    customRules,
    wcagTotal: WCAG_CRITERIA.length,
    wcagAutomated,
    wcagAutomatedPct: Math.round((wcagAutomated / WCAG_CRITERIA.length) * 1000) / 10,
  };
}
