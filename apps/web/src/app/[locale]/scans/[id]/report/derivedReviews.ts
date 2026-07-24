import {
  KWCAG_ITEMS,
  deriveKwcagOutcomeFromWcag,
  deriveWcagReviewsFromKwcag,
  type WcagOutcome,
} from "@a11ychk/core/catalog";
import type { ReviewValue } from "./ReviewCell";

/** 직접 판정에 상대 표준 파생 판정을 보충한 유효 판정 — derived로 구분 (순수 함수) */
export type EffectiveReview = ReviewValue & { derived?: boolean };

function toOutcomes(reviews: Map<string, ReviewValue>): Record<string, WcagOutcome> {
  const out: Record<string, WcagOutcome> = {};
  for (const [id, v] of reviews) out[id] = v.outcome as WcagOutcome;
  return out;
}

/**
 * KWCAG 항목별 유효 판정 — kwcag 직접 판정 우선, 없으면 대응 SC의 wcag 판정에서 파생.
 * (결합 규칙: failed > cannotTell > 전 SC 판정 시 긍정 — core deriveKwcagOutcomeFromWcag)
 * KwcagMatrixSection 표시·computeCertReadiness가 공유해 인증 지표가 WCAG 축 판정에도 반영된다.
 */
export function buildEffectiveKwcagReviews(
  kwcagReviews: Map<string, ReviewValue>,
  wcagReviews: Map<string, ReviewValue>,
): Map<string, EffectiveReview> {
  const out = new Map<string, EffectiveReview>(kwcagReviews);
  const wcagOutcomes = toOutcomes(wcagReviews);
  for (const item of KWCAG_ITEMS) {
    if (out.has(item.id)) continue;
    const derived = deriveKwcagOutcomeFromWcag(item, wcagOutcomes);
    if (derived) out.set(item.id, { outcome: derived, note: "", derived: true });
  }
  return out;
}

/** SC별 유효 판정 — wcag 직접 판정 우선, 없으면 kwcag 판정에서 파생 (진행률 표시용) */
export function buildEffectiveWcagReviews(
  wcagReviews: Map<string, ReviewValue>,
  kwcagReviews: Map<string, ReviewValue>,
): Map<string, EffectiveReview> {
  const out = new Map<string, EffectiveReview>(wcagReviews);
  const derived = deriveWcagReviewsFromKwcag(toOutcomes(kwcagReviews));
  for (const [scId, outcome] of Object.entries(derived)) {
    if (!out.has(scId)) out.set(scId, { outcome, note: "", derived: true });
  }
  return out;
}
