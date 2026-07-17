import "server-only";
import type { KwcagMatrixRow } from "@a11ychk/core/catalog";

/**
 * KWCAG 항목별 페이지 준수율 — 국내 품질인증의 "검사항목별 준수율 95%" 기준에
 * 대응하는 페이지 단위 근사치. (인증 심사는 요소 단위 산정이라 다를 수 있음 —
 * 표시 시 반드시 근사임을 안내할 것)
 *
 * rate = (검사 완료 페이지 수 − 해당 항목 위반이 발견된 페이지 수) / 검사 완료 페이지 수
 */
export interface KwcagPageRate {
  violatedPages: number;
  /** 0~100 (%). 검사 완료 페이지가 없으면 null */
  rate: number | null;
}

export function computeKwcagPageRates(
  kwcagMatrix: KwcagMatrixRow[],
  findings: { rule_id: string; scan_pages: { url: string } | null }[],
  donePageCount: number,
): Map<string, KwcagPageRate> {
  // 규칙 → 위반 발생 페이지 집합
  const pagesByRule = new Map<string, Set<string>>();
  for (const f of findings) {
    const url = f.scan_pages?.url;
    if (!url) continue;
    const set = pagesByRule.get(f.rule_id) ?? new Set<string>();
    set.add(url);
    pagesByRule.set(f.rule_id, set);
  }

  const out = new Map<string, KwcagPageRate>();
  for (const row of kwcagMatrix) {
    const violated = new Set<string>();
    for (const ruleId of row.ruleIds) {
      for (const url of pagesByRule.get(ruleId) ?? []) violated.add(url);
    }
    const rate =
      donePageCount > 0 ? Math.round(((donePageCount - violated.size) / donePageCount) * 1000) / 10 : null;
    out.set(row.itemId, { violatedPages: violated.size, rate });
  }
  return out;
}
