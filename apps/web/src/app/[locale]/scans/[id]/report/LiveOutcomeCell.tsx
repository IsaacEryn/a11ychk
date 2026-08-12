"use client";

import type { ReactNode } from "react";
import { useReviews } from "./ReviewsProvider";

/**
 * 매트릭스 행의 판정 배지 — 저장 직후 서버 재렌더 없이도 최신 판정을 보여준다.
 * saveReview가 revalidate를 하지 않아 서버 렌더 배지는 낡아 있으므로,
 * ReviewsProvider의 라이브 상태로 표시할 배지를 고른다. 배지 마크업 자체는
 * 서버 컴포넌트가 미리 렌더해 넘긴다(번역·스타일 규칙을 서버 한 곳에 유지).
 * 초기 렌더는 서버 판정 데이터와 같은 입력에서 시작하므로 hydration이 일치한다.
 */
export function LiveOutcomeCell({
  standard,
  itemId,
  auto,
  byOutcome,
  reviewerBadge,
  derivedBadge,
}: {
  standard: "wcag" | "kwcag";
  itemId: string;
  /** 판정이 없을 때의 자동 결과 표시 (블라인드 마스킹 포함) */
  auto: ReactNode;
  /** 판정 outcome → 배지 노드 */
  byOutcome: Record<string, ReactNode>;
  /** "점검자" 출처 배지 */
  reviewerBadge: ReactNode;
  /** "파생" 출처 배지 (KWCAG 매트릭스 전용) */
  derivedBadge?: ReactNode;
}) {
  const reviews = useReviews();
  const live = reviews?.liveReview(standard, itemId) ?? null;
  if (!live || !(live.outcome in byOutcome)) return <>{auto}</>;
  return (
    <>
      {byOutcome[live.outcome]}
      {live.derived ? (derivedBadge ?? reviewerBadge) : reviewerBadge}
    </>
  );
}
