/**
 * 보고서 출력 범위(view) 행 가시성 판정 — 순수 함수.
 * page.tsx가 각 매트릭스 행에 data 속성으로 새기고, CSS가 즉시 필터한다(서버 재페치 없음).
 * 클라이언트 필터의 정확성을 유닛테스트로 잠그기 위해 인라인에서 분리했다.
 */
export type ReportView = "all" | "auto" | "done" | "issues";
export type WcagOutcome = "passed" | "failed" | "cannotTell" | "notChecked" | "notPresent";

/** 점검자 판정(리뷰) — 있으면 자동 판정보다 우선한다 */
export interface RowReview {
  outcome: string;
}

/**
 * WCAG 성공기준 행이 주어진 view에서 보이는지.
 * - all: 항상
 * - auto: 자동 도구가 판정한 항목만(notChecked=수동 필요 → 제외). 리뷰와 무관
 * - issues: 유효 판정(리뷰 우선)이 failed인 항목
 * - done: 리뷰가 있거나 자동으로 확정(passed/failed/cannotTell)된 항목
 */
export function wcagRowVisibleIn(view: ReportView, outcome: WcagOutcome, review: RowReview | null): boolean {
  if (view === "all") return true;
  if (view === "auto") return outcome !== "notChecked";
  const effective = (review?.outcome as WcagOutcome | undefined) ?? outcome;
  if (view === "issues") return effective === "failed";
  return review !== null || effective === "passed" || effective === "failed" || effective === "cannotTell";
}

/**
 * KWCAG 항목 행이 주어진 view에서 보이는지.
 * - all: 항상
 * - auto: 자동 판정된 항목만(manual=수동 → 제외)
 * - 리뷰가 있으면: issues는 리뷰 outcome이 failed일 때만, 그 외엔 표시
 * - 리뷰가 없으면: issues는 status=fail, done은 pass/fail/review
 */
export function kwcagRowVisibleIn(view: ReportView, status: string, review: RowReview | null): boolean {
  if (view === "all") return true;
  if (view === "auto") return status !== "manual";
  if (review) return view === "issues" ? review.outcome === "failed" : true;
  if (view === "issues") return status === "fail";
  return status === "pass" || status === "fail" || status === "review";
}

/** 행에 붙일 view 가시성 data 속성 (all은 항상 보이므로 생략). undefined면 React가 속성 미출력 */
export function wcagRowData(outcome: WcagOutcome, review: RowReview | null) {
  return {
    "data-row": "",
    "data-v-auto": wcagRowVisibleIn("auto", outcome, review) ? "" : undefined,
    "data-v-done": wcagRowVisibleIn("done", outcome, review) ? "" : undefined,
    "data-v-issues": wcagRowVisibleIn("issues", outcome, review) ? "" : undefined,
  };
}

/** 행에 붙일 view 가시성 data 속성 (KWCAG) */
export function kwcagRowData(status: string, review: RowReview | null) {
  return {
    "data-row": "",
    "data-v-auto": kwcagRowVisibleIn("auto", status, review) ? "" : undefined,
    "data-v-done": kwcagRowVisibleIn("done", status, review) ? "" : undefined,
    "data-v-issues": kwcagRowVisibleIn("issues", status, review) ? "" : undefined,
  };
}
