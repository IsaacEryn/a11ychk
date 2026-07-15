/**
 * 스캔 결과 집계 — 페이지별 결과를 모아 보고서 요약(ScanSummary)을 만든다.
 * 순수 함수 — 브라우저/서버 어디서든 실행 가능.
 */
import type {
  Impact,
  KwcagMatrixRow,
  KwcagStatus,
  PageScanResult,
  SampleSummary,
  ScanSummary,
  WcagMatrixRow,
  WcagOutcome,
} from "../types";
import { getRuleEntry } from "../catalog/rules";
import { KWCAG_ITEMS } from "../catalog/kwcag";
import { criteriaForTarget, type WcagLevel } from "../catalog/wcag";

const EMPTY_IMPACTS: Record<Impact, number> = { critical: 0, serious: 0, moderate: 0, minor: 0 };

export interface AggregateOptions {
  /** 목표 적합성 수준 (WCAG SC 매트릭스 범위) */
  conformanceTarget?: WcagLevel | "AAA";
  /** WCAG-EM 표본 요약 (있으면 summary.sample에 포함) */
  sample?: SampleSummary;
  /** 표본으로 계획된 전체 페이지 수 (성공한 pages와 다를 수 있음) */
  plannedPageCount?: number;
}

export function aggregateScan(
  pages: PageScanResult[],
  axeVersion: string,
  options: AggregateOptions = {},
): ScanSummary {
  const byImpact: Record<Impact, number> = { ...EMPTY_IMPACTS };
  const byRule: Record<string, number> = {};
  const failedRules = new Set<string>();
  const passedRules = new Set<string>();
  const incompleteRules = new Set<string>();
  let totalViolationNodes = 0;
  let totalViolations = 0;

  // 규칙별 KWCAG 매핑 캐시 (violation의 태그 기반 fallback 포함)
  const ruleKwcag = new Map<string, string[]>();

  for (const page of pages) {
    for (const v of page.violations) {
      totalViolations += 1;
      totalViolationNodes += v.nodes.length;
      byImpact[v.impact] += v.nodes.length;
      byRule[v.ruleId] = (byRule[v.ruleId] ?? 0) + v.nodes.length;
      failedRules.add(v.ruleId);
      if (!ruleKwcag.has(v.ruleId)) ruleKwcag.set(v.ruleId, getRuleEntry(v.ruleId, v.tags).kwcag);
    }
    for (const id of page.passes) passedRules.add(id);
    for (const id of page.incomplete) incompleteRules.add(id);
  }

  // 통과 목록에서 위반된 규칙 제거 (한 페이지라도 위반이면 위반)
  for (const id of failedRules) passedRules.delete(id);
  for (const id of failedRules) incompleteRules.delete(id);

  // KWCAG 매트릭스
  const kwcagFail = new Map<string, { count: number; rules: Set<string> }>();
  for (const [ruleId, kwcagIds] of ruleKwcag) {
    for (const kw of kwcagIds) {
      const cur = kwcagFail.get(kw) ?? { count: 0, rules: new Set<string>() };
      cur.count += byRule[ruleId] ?? 0;
      cur.rules.add(ruleId);
      kwcagFail.set(kw, cur);
    }
  }
  const kwcagPass = new Set<string>();
  for (const id of passedRules) {
    for (const kw of getRuleEntry(id).kwcag) kwcagPass.add(kw);
  }
  const kwcagReview = new Set<string>();
  for (const id of incompleteRules) {
    for (const kw of getRuleEntry(id).kwcag) kwcagReview.add(kw);
  }

  const kwcagMatrix: KwcagMatrixRow[] = KWCAG_ITEMS.map((item) => {
    const fail = kwcagFail.get(item.id);
    let status: KwcagStatus;
    if (fail) status = "fail";
    else if (kwcagReview.has(item.id)) status = "review";
    else if (item.autoCoverage === "none") status = "manual";
    else if (kwcagPass.has(item.id)) status = item.autoCoverage === "full" ? "pass" : "manual"; // partial은 자동 통과여도 수동 확인 필요
    else status = item.autoCoverage === "full" ? "not-applicable" : "manual";
    return {
      itemId: item.id,
      status,
      violationCount: fail?.count ?? 0,
      ruleIds: [...(fail?.rules ?? [])],
    };
  });

  // ── WCAG 2.2 성공기준(SC) 매트릭스 (WCAG-EM Step 4) ──
  const scFail = new Map<string, { count: number; rules: Set<string> }>();
  for (const ruleId of failedRules) {
    for (const sc of getRuleEntry(ruleId).wcag) {
      const cur = scFail.get(sc) ?? { count: 0, rules: new Set<string>() };
      cur.count += byRule[ruleId] ?? 0;
      cur.rules.add(ruleId);
      scFail.set(sc, cur);
    }
  }
  const scPass = new Set<string>();
  for (const id of passedRules) for (const sc of getRuleEntry(id).wcag) scPass.add(sc);
  const scReview = new Set<string>();
  for (const id of incompleteRules) for (const sc of getRuleEntry(id).wcag) scReview.add(sc);

  const wcagMatrix: WcagMatrixRow[] = criteriaForTarget(options.conformanceTarget ?? "AA").map((c) => {
    const fail = scFail.get(c.id);
    let outcome: WcagOutcome;
    if (fail) outcome = "failed";
    else if (scReview.has(c.id)) outcome = "cannotTell";
    else if (scPass.has(c.id)) outcome = "passed";
    else outcome = "notChecked"; // 자동 규칙이 없거나 결과가 없는 SC → 수동 평가 필요
    return {
      scId: c.id,
      outcome,
      violationCount: fail?.count ?? 0,
      ruleIds: [...(fail?.rules ?? [])],
    };
  });

  const checkedRuleCount = passedRules.size + failedRules.size;
  const complianceRate = checkedRuleCount === 0 ? 0 : Math.round((passedRules.size / checkedRuleCount) * 1000) / 10;

  return {
    pageCount: options.plannedPageCount ?? pages.length,
    scannedPageCount: pages.length,
    totalViolations,
    totalViolationNodes,
    byImpact,
    byRule,
    kwcagMatrix,
    wcagMatrix,
    complianceRate,
    engine: { name: "axe-core", axeVersion },
    ...(options.sample ? { sample: options.sample } : {}),
  };
}
