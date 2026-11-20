import "server-only";
import type { KwcagMatrixRow } from "@a11ychk/core/catalog";

/**
 * KWCAG 항목별 페이지 준수율 — 표준심사 지침(2024. 12.)의 항목별 준수율(준수한 페이지 수 ÷
 * 심사 대상 페이지 수, 합격 기준은 33개의 검사 항목 모두 95% 이상)에 대응하는 값.
 * 자동 검사 결과로만 내므로 심사 결과가 아니다. 심사는 지침의 심사페이지 선정 대상에 따라
 * 페이지를 선정하고, 공통 영역의 같은 오류는 한 페이지만 감점한다. 표시할 때 이 점을 안내할 것.
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
