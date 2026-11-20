import "server-only";
import type { KwcagMatrixRow } from "@a11ychk/core/catalog";
import type { ReviewValue } from "./ReviewCell";
import type { KwcagPageRate } from "./kwcagPageRate";

/**
 * 인증 준비 요약 — 평가 항목의 페이지 준수율 평균과 그 구간(95% 이상, 85~95%, 85% 미만).
 * 「웹 접근성 품질인증기관 표준심사 지침」(2024. 12.)의 전문가 심사 합격 기준은
 * 「33개의 검사 항목 모두 준수율 95% 이상」이고, 평균 준수율은 2차 심사 대상 기준
 * (전체 검사 항목 평균 준수율 85% 이상~95% 미만)에만 쓰인다.
 * 평가 근거가 있는 항목(자동 판정 pass/fail/review 또는 점검자 판정)만 평균에
 * 넣고, 근거 없는 항목 수를 함께 노출한다. 자동 검사와 점검자 판정으로 낸 값이라
 * 심사 결과가 아니고, 인증에는 사용자 심사(과업 성공률)가 따로 있으므로 표시할 때
 * 이 점을 반드시 안내할 것.
 */
export type CertBand = "pass" | "second" | "below";

/** 준수율 기준값(%) — 평균 구간과 95% 미만 항목 목록, 대시보드 추이 목표선이 함께 쓴다 */
export const CERT_TARGET_RATE = 95;

export interface CertReadiness {
  /** 평가된 항목들의 페이지 준수율 평균 (0~100, 소수 1자리). 평가 항목 없으면 null */
  averageRate: number | null;
  band: CertBand | null;
  evaluatedCount: number;
  totalCount: number;
  /** 95% 미만 항목 (개선 우선순위, 준수율 오름차순) */
  belowItems: { itemId: string; rate: number }[];
}

/** 항목 하나의 준수율 — 점검자 판정이 있으면 그것을 우선한다 */
function itemRate(
  row: KwcagMatrixRow,
  pageRate: KwcagPageRate | undefined,
  review: ReviewValue | undefined,
  donePageCount: number,
): number | null {
  if (review) {
    if (review.outcome === "notPresent") return null; // 해당 없음 — 평균에서 제외
    if (review.outcome === "passed") return 100;
    if (review.outcome === "failed") {
      // 판정에 페이지 귀속이 있으면 그 범위로, 없으면 자동 측정치로 폴백
      if (review.pages && review.pages.length > 0 && donePageCount > 0) {
        // 과거 데이터에 검증 전 pages가 남아 있을 수 있어 0 미만은 클램프
        return Math.max(0, Math.round(((donePageCount - review.pages.length) / donePageCount) * 1000) / 10);
      }
      // 페이지 범위 없이 "위반"만 기입한 판정 — 자동 검사가 위반 페이지를 찾았으면 그 비율을 쓰고,
      // 아니면 보수적으로 0%. 예전에는 자동 측정치로 무조건 폴백해, 자동 규칙이 없는 수동 항목
      // (위반 페이지 0 → 100%)에서 점검자의 "위반" 판정이 "통과"와 같은 100%로 계산됐다.
      if (pageRate?.rate != null && pageRate.violatedPages > 0) return pageRate.rate;
      return 0;
    }
    // cannotTell 등 — 자동 측정치가 있으면 사용
  }
  if ((row.status === "pass" || row.status === "fail" || row.status === "review") && pageRate?.rate != null) {
    return pageRate.rate;
  }
  return null; // manual·not-applicable이고 판정도 없음 — 평가 근거 없음
}

export function computeCertReadiness(
  kwcagMatrix: KwcagMatrixRow[],
  rates: Map<string, KwcagPageRate>,
  reviews: Map<string, ReviewValue>,
  donePageCount: number,
): CertReadiness {
  const rated: { itemId: string; rate: number }[] = [];
  for (const row of kwcagMatrix) {
    const rate = itemRate(row, rates.get(row.itemId), reviews.get(row.itemId), donePageCount);
    if (rate != null) rated.push({ itemId: row.itemId, rate });
  }

  if (rated.length === 0) {
    return { averageRate: null, band: null, evaluatedCount: 0, totalCount: kwcagMatrix.length, belowItems: [] };
  }

  const averageRate = Math.round((rated.reduce((s, r) => s + r.rate, 0) / rated.length) * 10) / 10;
  const band: CertBand = averageRate >= CERT_TARGET_RATE ? "pass" : averageRate >= 85 ? "second" : "below";
  const belowItems = rated.filter((r) => r.rate < CERT_TARGET_RATE).sort((a, b) => a.rate - b.rate);

  return { averageRate, band, evaluatedCount: rated.length, totalCount: kwcagMatrix.length, belowItems };
}
