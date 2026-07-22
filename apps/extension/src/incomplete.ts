/**
 * 확인 필요(incomplete) 심사 흐름 지원 — axe가 자동 판정하지 못한 항목을
 * 노드 정보와 함께 목록화하고, 점검자의 확인(위반 확정/문제없음)으로 결과에 반영한다.
 *
 * core의 normalizeAxeResults는 incomplete를 규칙 id만 남기지만, axe raw 결과의
 * incomplete 항목은 violations와 동일 구조(nodes 포함)다. 합성 입력으로
 * normalizeAxeResults를 재호출해 노드 포함 Finding[]을 파생한다 (core 수정 없음).
 */
import { normalizeAxeResults, type AxeRunResults, type Finding, type PageScanResult } from "@a11ychk/core/catalog";

/** axe raw 결과에서 노드 포함 incomplete Finding[] 파생 */
export function deriveIncompleteFindings(url: string, raw: AxeRunResults): Finding[] {
  return normalizeAxeResults(url, {
    violations: raw.incomplete as unknown as AxeRunResults["violations"],
    passes: [],
    incomplete: [],
  }).violations;
}

export type IncompleteDecision = "failed" | "passed";

/**
 * 심사 결정을 페이지 결과에 반영한다 (제자리 수정).
 * - 위반 확정: incomplete → violations 이동 (동일 규칙 기존재 시 노드 병합)
 * - 문제없음: incomplete → passes 이동
 * 노드 없는 커스텀 규칙(a11ychk:*)도 규칙 단위로 동일하게 처리된다.
 */
export function applyIncompleteDecision(
  page: PageScanResult,
  incompleteFindings: Finding[],
  ruleId: string,
  decision: IncompleteDecision,
): void {
  const idx = incompleteFindings.findIndex((f) => f.ruleId === ruleId);
  const finding = idx >= 0 ? incompleteFindings[idx] : null;
  if (idx >= 0) incompleteFindings.splice(idx, 1);
  page.incomplete = page.incomplete.filter((id) => id !== ruleId);

  if (decision === "failed") {
    const existing = page.violations.find((v) => v.ruleId === ruleId);
    if (existing && finding) {
      existing.nodes.push(...finding.nodes);
    } else if (finding) {
      page.violations.push(finding);
    } else {
      // 노드 없는 커스텀 incomplete — 규칙 단위 위반으로 기록 (준수율에 반영)
      page.violations.push({ ruleId, impact: "moderate", tags: [], helpUrl: "", nodes: [] });
    }
  } else if (!page.passes.includes(ruleId)) {
    page.passes.push(ruleId);
  }
}
