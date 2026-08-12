"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { saveReview, type ReviewSaveState } from "@/lib/actions";
import { derivePageAggregate, failedPages, PAGE_OUTCOMES } from "@/lib/reviewPages";
import { useReviews } from "./ReviewsProvider";

export interface ReviewValue {
  outcome: string;
  note: string;
  pages?: string[];
  /** 페이지별 판정 (URL → outcome, migration 0036) */
  pageOutcomes?: Record<string, string>;
}

/**
 * 점검자 판정 기입 셀 — 매트릭스 행(WCAG SC / KWCAG 항목)마다 렌더.
 * 자동 판정을 점검자가 직접 확인·정정하고 관찰 내용을 기록한다.
 * 여러 페이지를 검사한 스캔에서는 페이지별로 판정하고, 항목 판정은 그 결합으로
 * 자동 제안된다(직접 수정 가능).
 * 저장은 서버 재렌더 없이 응답만 받아 ReviewsProvider가 진행률·점수·행 배지를 갱신하고,
 * "다음 미판정" 버튼으로 순차 기입을 잇는다.
 * 모든 입력은 제어 컴포넌트 — React 19가 <form action> 완료 후 폼을 자동 리셋하는데,
 * 저장 액션이 revalidate를 하지 않아 비제어 입력이면 방금 저장한 값이 낡은 서버
 * 기본값으로 되돌아가 보인다(입력값 증발 버그). 제어 상태는 리셋의 영향을 받지 않는다.
 * 화면 전용(no-print) — 인쇄물에는 저장된 판정·메모가 본문에 반영된다.
 */
export function ReviewCell({
  scanId,
  standard,
  itemId,
  current,
  pageUrls = [],
}: {
  scanId: string;
  standard: "wcag" | "kwcag";
  itemId: string;
  current: ReviewValue | null;
  /** 이 스캔의 검사된 페이지 URL 목록 (판정을 페이지에 귀속) */
  pageUrls?: string[];
}) {
  const t = useTranslations("report.review");
  const reviews = useReviews();
  const [state, formAction, pending] = useActionState<ReviewSaveState, FormData>(saveReview, {});
  // 제출 시점 스냅샷 — 응답(state)에는 저장 값이 없으므로 제출할 때 붙잡아 둔다
  const lastSubmitted = useRef<{ outcome: string; note: string; pageOutcomes: Record<string, string> } | null>(null);
  const appliedState = useRef<ReviewSaveState | null>(null);

  // 제어 상태 — 서버 prop(current)에서 시드. 저장 후에도 이 상태가 화면의 진실이다.
  const [outcome, setOutcome] = useState(current?.outcome ?? "passed");
  const [note, setNote] = useState(current?.note ?? "");
  const [pageOutcomes, setPageOutcomes] = useState<Record<string, string>>(current?.pageOutcomes ?? {});
  // 저장 성공을 로컬에도 반영 — current(서버 prop)는 저장 후에도 낡아 있어,
  // 이것 없이는 첫 저장 직후 "판정 해제" 옵션이 안 나타난다
  const [localHasReview, setLocalHasReview] = useState(!!current);

  useEffect(() => {
    // 같은 응답을 두 번 반영하지 않게 상태 객체 동일성으로 가드
    if (!state.ok || appliedState.current === state || !lastSubmitted.current) return;
    appliedState.current = state;
    const snap = lastSubmitted.current;
    const cleared = snap.outcome === "";
    setLocalHasReview(!cleared);
    if (cleared) {
      // 판정 해제 — 폼도 초기 상태로 되돌린다
      setOutcome("passed");
      setNote("");
      setPageOutcomes({});
      reviews?.apply(standard, itemId, null, state.scores);
    } else {
      reviews?.apply(
        standard,
        itemId,
        {
          outcome: snap.outcome,
          note: snap.note,
          pages: failedPages(snap.pageOutcomes),
          pageOutcomes: Object.keys(snap.pageOutcomes).length > 0 ? snap.pageOutcomes : undefined,
        },
        state.scores,
      );
    }
  }, [state, reviews, standard, itemId]);

  const judgedCount = Object.keys(pageOutcomes).length;
  const clearing = outcome === "";

  /** 페이지 판정 변경 — 항목 판정을 결합 규칙으로 자동 제안 (점검자가 다시 바꿀 수 있음) */
  function setPageOutcome(url: string, value: string) {
    setPageOutcomes((prev) => {
      const next = { ...prev };
      if (value === "") delete next[url];
      else next[url] = value;
      const suggested = derivePageAggregate(Object.values(next));
      if (suggested) setOutcome(suggested);
      return next;
    });
  }

  return (
    <details id={`review-${standard}-${itemId}`} className="no-print">
      <summary className="cursor-pointer text-xs font-bold text-[var(--color-seal)] underline underline-offset-2">
        {localHasReview ? t("edit") : t("add")}
      </summary>
      <form
        action={formAction}
        onSubmit={() => {
          lastSubmitted.current = { outcome, note, pageOutcomes: { ...pageOutcomes } };
        }}
        className="mt-2 w-[min(20rem,85vw)] space-y-2 border-[1.5px] border-[var(--color-line)] bg-[var(--color-paper)] p-3"
      >
        <input type="hidden" name="scanId" value={scanId} />
        <input type="hidden" name="standard" value={standard} />
        <input type="hidden" name="itemId" value={itemId} />
        <div>
          <label htmlFor={`rv-out-${standard}-${itemId}`} className="mb-1 block text-xs font-semibold">
            {t("outcome")}
          </label>
          <select
            id={`rv-out-${standard}-${itemId}`}
            name="outcome"
            value={outcome}
            onChange={(e) => setOutcome(e.target.value)}
            className="w-full rounded border-[1.5px] border-[var(--color-ink)] bg-[var(--color-paper)] px-2 py-1 text-xs"
          >
            <option value="passed">{t("outcomes.passed")}</option>
            <option value="failed">{t("outcomes.failed")}</option>
            <option value="cannotTell">{t("outcomes.cannotTell")}</option>
            <option value="notPresent">{t("outcomes.notPresent")}</option>
            {localHasReview && <option value="">{t("outcomes.clear")}</option>}
          </select>
        </div>
        <div>
          <label htmlFor={`rv-note-${standard}-${itemId}`} className="mb-1 block text-xs font-semibold">
            {t("note")}
          </label>
          <textarea
            id={`rv-note-${standard}-${itemId}`}
            name="note"
            rows={3}
            maxLength={5000}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={t("notePlaceholder")}
            className="w-full rounded border-[1.5px] border-[var(--color-line)] bg-[var(--color-paper)] px-2 py-1 text-xs"
          />
        </div>
        {pageUrls.length > 1 && (
          <fieldset className="border-0 p-0" disabled={clearing}>
            <legend className="mb-1 text-xs font-semibold">
              {t("pageOutcomes")}{" "}
              <span className="font-normal tabular-nums text-[var(--color-ink-faint)]">
                {judgedCount}/{pageUrls.length}
              </span>
            </legend>
            <p className="mb-1.5 text-[0.7rem] leading-snug text-[var(--color-ink-faint)]">{t("pageOutcomesHint")}</p>
            <ul className="max-h-40 space-y-1.5 overflow-y-auto">
              {pageUrls.map((url) => (
                <li key={url} className="flex items-center gap-1.5 text-xs">
                  <label htmlFor={`rv-po-${standard}-${itemId}-${url}`} className="min-w-0 flex-1 break-all font-normal">
                    {url}
                  </label>
                  {/* poUrl↔poOutcome 쌍 — 문서 순서로 서버에서 짝지어 검증한다.
                      미판정("")도 쌍을 유지해 제출하고 서버가 enum 검증으로 걸러낸다 */}
                  <input type="hidden" name="poUrl" value={url} />
                  <select
                    id={`rv-po-${standard}-${itemId}-${url}`}
                    name="poOutcome"
                    value={pageOutcomes[url] ?? ""}
                    onChange={(e) => setPageOutcome(url, e.target.value)}
                    className="shrink-0 rounded border-[1.5px] border-[var(--color-line)] bg-[var(--color-paper)] px-1.5 py-0.5 text-xs"
                  >
                    <option value="">{t("pageUnset")}</option>
                    {PAGE_OUTCOMES.map((o) => (
                      <option key={o} value={o}>
                        {t(`outcomes.${o}`)}
                      </option>
                    ))}
                  </select>
                </li>
              ))}
            </ul>
          </fieldset>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="submit"
            disabled={pending}
            className="rounded border-[1.5px] border-[var(--color-seal)] bg-[var(--color-seal)] px-3 py-1 text-xs font-bold text-[var(--color-paper)] disabled:opacity-60"
          >
            {pending ? t("saving") : t("save")}
          </button>
          {state.ok && (
            <span role="status" className="text-xs font-semibold text-[var(--color-seal)]">
              {t("saved")}
            </span>
          )}
          {state.ok && reviews && (
            <button
              type="button"
              onClick={() => reviews.focusNext(standard, itemId)}
              className="rounded border-[1.5px] border-[var(--color-ink)] px-2.5 py-1 text-xs font-bold hover:bg-[var(--color-paper-warm)]"
            >
              {t("next")}
            </button>
          )}
          {state.error && (
            <span role="alert" className="text-xs font-semibold text-[var(--color-crit)]">
              {t(`errors.${state.error}` as "errors.invalid" | "errors.forbidden" | "errors.failed")}
            </span>
          )}
        </div>
      </form>
    </details>
  );
}
