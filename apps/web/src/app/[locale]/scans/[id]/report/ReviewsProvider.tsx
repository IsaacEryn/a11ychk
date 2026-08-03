"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import type { ScanSummary } from "@a11ychk/core/catalog";
import { buildEffectiveKwcagReviews, buildEffectiveWcagReviews } from "./derivedReviews";
import type { ReviewValue } from "./ReviewCell";

/**
 * 판정 라이브 상태 — saveReview가 revalidate 없이 응답만 돌려주므로, 저장 결과를
 * 이 컨텍스트가 받아 진행률·점수 표시를 즉시 갱신한다. 파생 판정(WCAG↔KWCAG)은
 * 서버와 같은 core 함수(derivedReviews)로 재계산해 판정 기준 일치를 유지한다.
 */

type Scores = ScanSummary["scores"];

interface ReviewsCtx {
  /** 최신 점수 — 서버 초기값에서 시작해 저장 응답으로 갱신 */
  scores: Scores | null;
  /** 표준별 유효 판정 완료 항목 수 (직접+파생) */
  doneCount: (std: "wcag" | "kwcag") => number;
  manualTotal: (std: "wcag" | "kwcag") => number;
  /** 저장 성공 시 ReviewCell이 호출 — outcome null은 판정 해제 */
  apply: (std: "wcag" | "kwcag", itemId: string, outcome: string | null, scores?: Scores | null) => void;
  /** 다음 미판정 항목의 판정 셀로 초점 이동 (fromItemId 이후, 없으면 처음부터) */
  focusNext: (std: "wcag" | "kwcag", fromItemId?: string) => void;
}

const Ctx = createContext<ReviewsCtx | null>(null);

export function useReviews(): ReviewsCtx | null {
  return useContext(Ctx);
}

export function ReviewsProvider({
  initialScores,
  initialWcag,
  initialKwcag,
  wcagManualIds,
  kwcagManualIds,
  children,
}: {
  initialScores: Scores | null;
  /** 직접 판정 (직렬화를 위해 Map 대신 객체) */
  initialWcag: Record<string, ReviewValue>;
  initialKwcag: Record<string, ReviewValue>;
  /** 수동 판정 대상 항목 id (매트릭스 표시 순서) */
  wcagManualIds: string[];
  kwcagManualIds: string[];
  children: ReactNode;
}) {
  const [scores, setScores] = useState<Scores | null>(initialScores);
  const [wcag, setWcag] = useState<Record<string, ReviewValue>>(initialWcag);
  const [kwcag, setKwcag] = useState<Record<string, ReviewValue>>(initialKwcag);

  // 서버 재렌더(재검사·비교 내비 등)가 더 새로운 값을 들고 오면 로컬 상태를 재시드 —
  // 없으면 재검사로 바뀐 점수를 이 컨텍스트의 낡은 값이 계속 덮어쓴다
  const seedKey = JSON.stringify([initialScores, initialWcag, initialKwcag]);
  const [seededKey, setSeededKey] = useState(seedKey);
  if (seedKey !== seededKey) {
    setSeededKey(seedKey);
    setScores(initialScores);
    setWcag(initialWcag);
    setKwcag(initialKwcag);
  }

  // 유효 판정(직접+파생) — 서버 렌더와 같은 core 파생 규칙으로 재계산
  const effective = useMemo(() => {
    const wcagMap = new Map(Object.entries(wcag));
    const kwcagMap = new Map(Object.entries(kwcag));
    return {
      wcag: buildEffectiveWcagReviews(wcagMap, kwcagMap),
      kwcag: buildEffectiveKwcagReviews(kwcagMap, wcagMap),
    };
  }, [wcag, kwcag]);

  const manualIds = useMemo(
    () => ({ wcag: wcagManualIds, kwcag: kwcagManualIds }),
    [wcagManualIds, kwcagManualIds],
  );

  const doneCount = useCallback(
    (std: "wcag" | "kwcag") => manualIds[std].filter((id) => effective[std].has(id)).length,
    [manualIds, effective],
  );
  const manualTotal = useCallback((std: "wcag" | "kwcag") => manualIds[std].length, [manualIds]);

  const apply = useCallback(
    (std: "wcag" | "kwcag", itemId: string, outcome: string | null, nextScores?: Scores | null) => {
      const setter = std === "wcag" ? setWcag : setKwcag;
      setter((prev) => {
        const next = { ...prev };
        if (outcome === null) delete next[itemId];
        else next[itemId] = { outcome, note: prev[itemId]?.note ?? "" };
        return next;
      });
      if (nextScores) setScores(nextScores);
    },
    [],
  );

  const focusNext = useCallback(
    (std: "wcag" | "kwcag", fromItemId?: string) => {
      const ids = manualIds[std];
      const start = fromItemId ? ids.indexOf(fromItemId) + 1 : 0;
      // fromItemId 이후부터 순환 탐색 — 자기 자신은 방금 판정했으므로 제외
      const order = [...ids.slice(start), ...ids.slice(0, start)].filter((id) => id !== fromItemId);
      const nextId = order.find((id) => !effective[std].has(id));
      if (!nextId) return;
      const cell = document.getElementById(`review-${std}-${nextId}`);
      if (!(cell instanceof HTMLDetailsElement)) return;
      // 출력 범위 필터(view=done 등)가 대상 행을 숨기고 있으면 전체 보기로 되돌린다 —
      // 숨은 요소에는 scrollIntoView/focus가 무효라 버튼이 침묵 실패한다
      if (cell.offsetParent === null) {
        window.dispatchEvent(new CustomEvent("a11ychk:view-all"));
      }
      requestAnimationFrame(() => {
        cell.open = true;
        cell.scrollIntoView({ block: "center" });
        cell.querySelector<HTMLElement>("summary")?.focus();
      });
    },
    [manualIds, effective],
  );

  const value = useMemo(
    () => ({ scores, doneCount, manualTotal, apply, focusNext }),
    [scores, doneCount, manualTotal, apply, focusNext],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
