/**
 * 페이지별 점검자 판정(scan_reviews.page_outcomes) 공용 규칙 — 순수 함수.
 * ReviewCell(클라이언트 자동 제안)과 saveReview(서버 검증·파생)가 같은 규칙을
 * 공유해 화면 제안과 저장 결과가 어긋나지 않게 한다.
 */

/** 페이지 하나에 기입할 수 있는 판정 (항목 판정과 달리 notChecked는 "미기입"으로 표현) */
export const PAGE_OUTCOMES = ["passed", "failed", "cannotTell", "notPresent"] as const;
export type PageOutcome = (typeof PAGE_OUTCOMES)[number];

export function isPageOutcome(value: unknown): value is PageOutcome {
  return typeof value === "string" && (PAGE_OUTCOMES as readonly string[]).includes(value);
}

/**
 * 페이지별 판정 → 항목 판정 제안 (결합 규칙: failed > cannotTell > 전부 notPresent >
 * passed). 판정된 페이지가 하나도 없으면 null — 항목 판정은 점검자가 직접 정한다.
 * 미판정 페이지가 남아 있어도 막지 않는다(표본 일부만 확인하는 점검 흐름 허용).
 */
export function derivePageAggregate(outcomes: Iterable<string>): PageOutcome | null {
  const judged = [...outcomes].filter(isPageOutcome);
  if (judged.length === 0) return null;
  if (judged.includes("failed")) return "failed";
  if (judged.includes("cannotTell")) return "cannotTell";
  if (judged.every((o) => o === "notPresent")) return "notPresent";
  return "passed";
}

/** 위반으로 판정된 페이지 URL 목록 — scan_reviews.pages(인증 준수율 계산 입력)로 파생 */
export function failedPages(pageOutcomes: Record<string, string>): string[] {
  return Object.entries(pageOutcomes)
    .filter(([, o]) => o === "failed")
    .map(([url]) => url);
}
