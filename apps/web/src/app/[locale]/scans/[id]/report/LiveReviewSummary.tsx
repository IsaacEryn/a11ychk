"use client";

import { useReviews } from "./ReviewsProvider";
import type { ReviewValue } from "./ReviewCell";

/**
 * 항목명 아래에 붙는 점검자 기록 요약 — 관찰 내용과 페이지별 판정(또는 구 형식의
 * 관련 페이지). 판정 배지(LiveOutcomeCell)와 같은 라이브 상태를 읽는다.
 * 배지만 라이브로 갱신하면 판정을 해제한 직후 "수동 검사" 배지 옆에 방금 지운
 * 페이지별 판정 요약이 남아 서로 모순돼 보인다 — 두 표시의 출처를 하나로 맞춘다.
 * 서버 렌더 초기값은 ReviewsProvider의 시드와 같으므로 hydration도 일치한다.
 */
export function LiveReviewSummary({
  standard,
  itemId,
  labels,
}: {
  standard: "wcag" | "kwcag";
  itemId: string;
  labels: {
    note: string;
    pageOutcomes: string;
    failedPages: string;
    relatedPages: string;
    /** outcome → 표시 문구 (페이지별 판정 분포용) */
    outcomes: Record<string, string>;
  };
}) {
  const reviews = useReviews();
  const review = (reviews?.liveReview(standard, itemId) ?? null) as ReviewValue | null;
  if (!review) return null;

  const pageOutcomes = review.pageOutcomes ?? {};
  const judged = Object.entries(pageOutcomes);
  const failed = judged.filter(([, o]) => o === "failed").map(([url]) => url);
  // 분포는 판정 표시 순서 고정 — 통과·위반·확인 필요·해당 없음
  const counts = ["passed", "failed", "cannotTell", "notPresent"]
    .map((o) => [o, judged.filter(([, v]) => v === o).length] as const)
    .filter(([, n]) => n > 0)
    .map(([o, n]) => `${labels.outcomes[o]} ${n}`);

  return (
    <>
      {review.note && (
        <p className="mt-1 text-xs font-normal leading-relaxed text-[var(--color-ink-soft)]">
          <strong>{labels.note}:</strong> {review.note}
        </p>
      )}
      {judged.length > 0 ? (
        <div className="mt-1 text-xs font-normal leading-relaxed text-[var(--color-ink-soft)]">
          <p>
            <strong>{labels.pageOutcomes}:</strong> {counts.join(" · ")}
          </p>
          {failed.length > 0 && (
            <p className="break-all">
              <strong>{labels.failedPages}:</strong> {failed.join(" · ")}
            </p>
          )}
        </div>
      ) : (
        // 구 형식(0036 이전 저장분) — 페이지별 판정 없이 관련 페이지만 있는 판정
        review.pages &&
        review.pages.length > 0 && (
          <p className="mt-1 break-all text-xs font-normal leading-relaxed text-[var(--color-ink-soft)]">
            <strong>{labels.relatedPages}:</strong> {review.pages.join(" · ")}
          </p>
        )
      )}
    </>
  );
}
