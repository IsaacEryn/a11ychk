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
  ScanScores,
  ScanSummary,
  ScoreBreakdown,
  SiteCheckOutcome,
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
  /** 사이트 수준 검사 결과 (Phase C) — 규칙 세트로 편입 */
  siteChecks?: SiteCheckOutcome[];
  /** 해당 콘텐츠가 없어 적용되지 않는 성공기준 (예: 미디어 없음 → 1.2.x) */
  notPresentScs?: string[];
  /** 점검자 판정 (scan_reviews) — 통합 점수 계산용. standard별 itemId→outcome */
  reviews?: { wcag: Record<string, WcagOutcome>; kwcag: Record<string, WcagOutcome> };
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

  // 사이트 수준 검사 결과를 규칙 세트로 편입 (Phase C)
  for (const sc of options.siteChecks ?? []) {
    if (sc.outcome === "failed") {
      failedRules.add(sc.ruleId);
      byRule[sc.ruleId] = (byRule[sc.ruleId] ?? 0) + sc.count;
      if (!ruleKwcag.has(sc.ruleId)) ruleKwcag.set(sc.ruleId, getRuleEntry(sc.ruleId).kwcag);
    } else if (sc.outcome === "passed") {
      passedRules.add(sc.ruleId);
    } else {
      incompleteRules.add(sc.ruleId);
    }
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
  const kwcagReviewRules = new Map<string, Set<string>>();
  for (const id of incompleteRules) {
    for (const kw of getRuleEntry(id).kwcag) {
      kwcagReview.add(kw);
      (kwcagReviewRules.get(kw) ?? kwcagReviewRules.set(kw, new Set()).get(kw)!).add(id);
    }
  }

  const notPresentScs = new Set(options.notPresentScs ?? []);
  const kwcagMatrix: KwcagMatrixRow[] = KWCAG_ITEMS.map((item) => {
    const fail = kwcagFail.get(item.id);
    let status: KwcagStatus;
    if (fail) status = "fail";
    else if (kwcagReview.has(item.id)) status = "review";
    else if (item.wcag.length > 0 && item.wcag.every((sc) => notPresentScs.has(sc)) && !kwcagPass.has(item.id))
      status = "not-applicable"; // 대응 SC의 콘텐츠가 없음 (예: 미디어 부재)
    else if (item.autoCoverage === "none") status = "manual";
    else if (kwcagPass.has(item.id)) status = item.autoCoverage === "full" ? "pass" : "manual"; // partial은 자동 통과여도 수동 확인 필요
    else status = item.autoCoverage === "full" ? "not-applicable" : "manual";
    return {
      itemId: item.id,
      status,
      violationCount: fail?.count ?? 0,
      ruleIds: [...(fail?.rules ?? [])],
      reviewRuleIds: [...(kwcagReviewRules.get(item.id) ?? [])],
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
  const scReviewRules = new Map<string, Set<string>>();
  for (const id of incompleteRules) {
    for (const sc of getRuleEntry(id).wcag) {
      scReview.add(sc);
      (scReviewRules.get(sc) ?? scReviewRules.set(sc, new Set()).get(sc)!).add(id);
    }
  }

  const wcagMatrix: WcagMatrixRow[] = criteriaForTarget(options.conformanceTarget ?? "AA").map((c) => {
    const fail = scFail.get(c.id);
    let outcome: WcagOutcome;
    if (fail) outcome = "failed";
    else if (scReview.has(c.id)) outcome = "cannotTell";
    else if (scPass.has(c.id)) outcome = "passed";
    else if (notPresentScs.has(c.id)) outcome = "notPresent"; // 해당 콘텐츠 없음 (예: 미디어 부재)
    else outcome = "notChecked"; // 자동 규칙이 없거나 결과가 없는 SC → 수동 평가 필요
    return {
      scId: c.id,
      outcome,
      violationCount: fail?.count ?? 0,
      ruleIds: [...(fail?.rules ?? [])],
      reviewRuleIds: [...(scReviewRules.get(c.id) ?? [])],
    };
  });

  const checkedRuleCount = passedRules.size + failedRules.size;
  const complianceRate = checkedRuleCount === 0 ? 0 : Math.round((passedRules.size / checkedRuleCount) * 1000) / 10;

  // ── 세 가지 준수율 (WCAG-EM Phase D): 자동 / 수동 / 통합 ──
  const scores = computeScores(wcagMatrix, options.reviews?.wcag ?? {});

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
    scores,
    engine: { name: "axe-core", axeVersion },
    ...(options.sample ? { sample: options.sample } : {}),
  };
}

/** passed/failed 카운트로 준수율 breakdown 생성 */
function breakdown(passed: number, failed: number, total: number): ScoreBreakdown {
  const evaluated = passed + failed;
  const rate = evaluated === 0 ? 0 : Math.round((passed / evaluated) * 1000) / 10;
  return { rate, passed, failed, evaluated, notEvaluated: total - evaluated };
}

/**
 * 자동 / 수동 / 통합 준수율 계산.
 * - 자동: wcagMatrix의 passed·failed (axe + 자체 + 사이트 검사)
 * - 수동: 점검자가 판정 기입한 성공기준의 passed·failed
 * - 통합: 각 성공기준마다 점검자 판정이 있으면 그것을, 없으면 자동 판정을 사용
 */
export function computeScores(
  wcagMatrix: WcagMatrixRow[],
  reviews: Record<string, WcagOutcome>,
): ScanScores {
  const total = wcagMatrix.length;
  let autoPass = 0;
  let autoFail = 0;
  let manualPass = 0;
  let manualFail = 0;
  let combPass = 0;
  let combFail = 0;

  for (const row of wcagMatrix) {
    // notPresent(해당 없음)는 적합성 판단상 충족으로 취급 (WCAG conformance)
    if (row.outcome === "passed" || row.outcome === "notPresent") autoPass += 1;
    else if (row.outcome === "failed") autoFail += 1;

    const rv = reviews[row.scId];
    if (rv === "passed") manualPass += 1;
    else if (rv === "failed") manualFail += 1;

    // 통합: 점검자 판정 우선 (passed/failed/notPresent만 확정으로 인정)
    const finalOutcome: WcagOutcome =
      rv === "passed" || rv === "failed" || rv === "notPresent" ? rv : row.outcome;
    if (finalOutcome === "passed" || finalOutcome === "notPresent") combPass += 1;
    else if (finalOutcome === "failed") combFail += 1;
  }

  return {
    automated: breakdown(autoPass, autoFail, total),
    manual: breakdown(manualPass, manualFail, total),
    combined: breakdown(combPass, combFail, total),
    totalCriteria: total,
  };
}
