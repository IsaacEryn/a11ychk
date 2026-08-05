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
import type { RuleCatalogEntry } from "../types";
import { getRuleEntry } from "../catalog/rules";
import { deriveWcagReviewsFromKwcag } from "../manual/manualChecks";
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

  // 규칙별 axe 태그 — 카탈로그 미등재 규칙의 WCAG·KWCAG 폴백 판정에 쓴다.
  // 태그는 위반에만 실려 오므로(passes/incomplete는 규칙 id뿐) 위반 루프에서 모아 둔다.
  const ruleTags = new Map<string, string[]>();

  for (const page of pages) {
    for (const v of page.violations) {
      totalViolations += 1;
      totalViolationNodes += v.nodes.length;
      byImpact[v.impact] += v.nodes.length;
      byRule[v.ruleId] = (byRule[v.ruleId] ?? 0) + v.nodes.length;
      failedRules.add(v.ruleId);
      if (!ruleTags.has(v.ruleId)) ruleTags.set(v.ruleId, v.tags);
    }
    for (const id of page.passes) passedRules.add(id);
    for (const id of page.incomplete) incompleteRules.add(id);
  }

  // 사이트 수준 검사 결과를 규칙 세트로 편입 (Phase C)
  for (const sc of options.siteChecks ?? []) {
    if (sc.outcome === "failed") {
      failedRules.add(sc.ruleId);
      byRule[sc.ruleId] = (byRule[sc.ruleId] ?? 0) + sc.count;
    } else if (sc.outcome === "passed") {
      passedRules.add(sc.ruleId);
    } else {
      incompleteRules.add(sc.ruleId);
    }
  }

  // 통과 목록에서 위반된 규칙 제거 (한 페이지라도 위반이면 위반)
  for (const id of failedRules) passedRules.delete(id);
  for (const id of failedRules) incompleteRules.delete(id);

  // 모범 사례(best-practice) 규칙 판별 — WCAG 성공기준에 대응하지 않는(wcag 매핑이 빈) 규칙.
  // axe의 best-practice 규칙(region·heading-order·landmark-* 등)이 여기 해당한다.
  // 이들은 준수율(적합성)에 영향을 주지 않는 '권고'이므로 WCAG·KWCAG 두 축 모두에서
  // 적합성 판정(pass/fail/review)에 넣지 않고, 별도 권고 목록으로만 보고한다.
  // (WCAG 축은 wcag가 비어 자연히 제외되고, KWCAG 축은 아래 루프에서 명시적으로 건너뛴다)
  // 카탈로그 조회는 반드시 이 함수로 — 미등재 규칙은 수집해 둔 axe 태그로 WCAG를 복원해야
  // 한다. 태그 없이 조회하면 wcag가 빈 배열이 되어 실제 적합성 위반이 '권고'로 강등되고,
  // 해당 성공기준이 위반 없는 것으로(통과로) 잘못 표시된다.
  const entryCache = new Map<string, RuleCatalogEntry>();
  const entryOf = (id: string): RuleCatalogEntry => {
    let entry = entryCache.get(id);
    if (!entry) {
      entry = getRuleEntry(id, ruleTags.get(id) ?? []);
      entryCache.set(id, entry);
    }
    return entry;
  };
  const isAdvisory = (id: string): boolean => entryOf(id).wcag.length === 0;

  /**
   * 규칙 판정(위반·통과·확인필요)을 기준 축(KWCAG 항목 또는 WCAG 성공기준)으로 접는다.
   * 두 축이 같은 집계를 하고 매핑만 다르므로, 규칙→기준 매핑 함수만 바꿔 재사용한다.
   * skipAdvisory: 모범 사례 규칙을 적합성 판정에서 뺄지 (KWCAG 축에서만 명시적으로 필요 —
   * WCAG 축은 매핑이 비어 자연히 빠진다).
   */
  const foldByCriterion = (criteriaOf: (ruleId: string) => string[], skipAdvisory: boolean) => {
    const fail = new Map<string, { count: number; rules: Set<string> }>();
    for (const ruleId of failedRules) {
      if (skipAdvisory && isAdvisory(ruleId)) continue;
      for (const c of criteriaOf(ruleId)) {
        const cur = fail.get(c) ?? { count: 0, rules: new Set<string>() };
        cur.count += byRule[ruleId] ?? 0;
        cur.rules.add(ruleId);
        fail.set(c, cur);
      }
    }
    const pass = new Set<string>();
    for (const id of passedRules) {
      if (skipAdvisory && isAdvisory(id)) continue;
      for (const c of criteriaOf(id)) pass.add(c);
    }
    const review = new Set<string>();
    const reviewRules = new Map<string, Set<string>>();
    for (const id of incompleteRules) {
      if (skipAdvisory && isAdvisory(id)) continue;
      for (const c of criteriaOf(id)) {
        review.add(c);
        const set = reviewRules.get(c) ?? new Set<string>();
        set.add(id);
        reviewRules.set(c, set);
      }
    }
    return { fail, pass, review, reviewRules };
  };

  // KWCAG 매트릭스 (모범 사례 규칙은 제외 — WCAG 축과 동일 기준)
  const {
    fail: kwcagFail,
    pass: kwcagPass,
    review: kwcagReview,
    reviewRules: kwcagReviewRules,
  } = foldByCriterion((id) => entryOf(id).kwcag, true);

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

  // ── WCAG 2.2 성공기준(SC) 매트릭스 (WCAG-EM 2.0 Step 4) ──
  const {
    fail: scFail,
    pass: scPass,
    review: scReview,
    reviewRules: scReviewRules,
  } = foldByCriterion((id) => entryOf(id).wcag, false);

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

  // ── 세 가지 준수율 (WCAG-EM 2.0 Step 5.4 — 선택적 종합 점수의 자체 구현): 자동 / 수동 / 통합 ──
  const scores = computeScores(wcagMatrix, options.reviews?.wcag ?? {}, options.reviews?.kwcag ?? {});

  // 모범 사례 권고 — WCAG 성공기준에 대응하지 않는 위반(적합성 판정 미포함). 보고서에서 별도 표시.
  const bestPractice = [...failedRules]
    .filter((id) => isAdvisory(id))
    .map((id) => ({ ruleId: id, count: byRule[id] ?? 0 }))
    .sort((a, b) => b.count - a.count || a.ruleId.localeCompare(b.ruleId));

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
    ...(bestPractice.length > 0 ? { bestPractice } : {}),
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
 *
 * kwcagReviews(선택): KWCAG 항목 번호로 기입된 판정 — 대응 SC로 파생해 수동 판정으로
 * 소비한다. 같은 SC에 wcag 직접 판정이 있으면 직접 판정이 우선한다. (확장·KWCAG
 * 매트릭스에서 기입한 판정이 점수에 반영되지 않던 비대칭 해소)
 */
export function computeScores(
  wcagMatrix: WcagMatrixRow[],
  reviews: Record<string, WcagOutcome>,
  kwcagReviews: Record<string, WcagOutcome> = {},
): ScanScores {
  const derived = deriveWcagReviewsFromKwcag(kwcagReviews);
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

    const rv = reviews[row.scId] ?? derived[row.scId];
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
