"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { saveReview, type ReviewSaveState } from "@/lib/actions";
import { useReviews } from "./ReviewsProvider";

export interface ReviewValue {
  outcome: string;
  note: string;
  pages?: string[];
}

/**
 * 점검자 판정 기입 셀 — 매트릭스 행(WCAG SC / KWCAG 항목)마다 렌더.
 * 자동 판정을 점검자가 직접 확인·정정하고 관찰 내용을 기록한다.
 * 저장은 서버 재렌더 없이 응답만 받아 ReviewsProvider가 진행률·점수를 갱신하고,
 * "다음 미판정" 버튼으로 순차 기입을 잇는다.
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
  // 마지막으로 제출한 outcome — 응답(state)에는 없으므로 제출 시점에 붙잡아 둔다
  const lastOutcome = useRef<string | null>(null);
  const appliedState = useRef<ReviewSaveState | null>(null);
  // 저장 성공을 로컬에도 반영 — current(서버 prop)는 저장 후에도 낡아 있어,
  // 이것 없이는 첫 저장 직후 "판정 해제" 옵션이 안 나타난다
  const [localHasReview, setLocalHasReview] = useState(!!current);

  useEffect(() => {
    // 같은 응답을 두 번 반영하지 않게 상태 객체 동일성으로 가드
    if (!state.ok || appliedState.current === state) return;
    appliedState.current = state;
    const cleared = lastOutcome.current === "";
    setLocalHasReview(!cleared);
    reviews?.apply(standard, itemId, cleared ? null : lastOutcome.current, state.scores);
  }, [state, reviews, standard, itemId]);

  return (
    <details id={`review-${standard}-${itemId}`} className="no-print">
      <summary className="cursor-pointer text-xs font-bold text-[var(--color-seal)] underline underline-offset-2">
        {localHasReview ? t("edit") : t("add")}
      </summary>
      <form
        action={formAction}
        onSubmit={(e) => {
          const fd = new FormData(e.currentTarget);
          lastOutcome.current = (fd.get("outcome") as string) ?? null;
        }}
        className="mt-2 w-[min(16rem,78vw)] space-y-2 border-[1.5px] border-[var(--color-line)] bg-[var(--color-paper)] p-3"
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
            defaultValue={current?.outcome ?? "passed"}
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
            defaultValue={current?.note ?? ""}
            placeholder={t("notePlaceholder")}
            className="w-full rounded border-[1.5px] border-[var(--color-line)] bg-[var(--color-paper)] px-2 py-1 text-xs"
          />
        </div>
        {pageUrls.length > 0 && (
          <fieldset className="border-0 p-0">
            <legend className="mb-1 text-xs font-semibold">{t("relatedPages")}</legend>
            <div className="max-h-28 space-y-1 overflow-y-auto">
              {pageUrls.map((url) => (
                <label key={url} className="flex items-start gap-1.5 text-xs">
                  <input
                    type="checkbox"
                    name="pages"
                    value={url}
                    defaultChecked={current?.pages?.includes(url) ?? false}
                    className="mt-0.5 h-3.5 w-3.5 accent-[var(--color-seal)]"
                  />
                  <span className="break-all">{url}</span>
                </label>
              ))}
            </div>
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
