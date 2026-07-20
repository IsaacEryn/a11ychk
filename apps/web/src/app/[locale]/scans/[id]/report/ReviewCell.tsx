"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { saveReview, type SaveState } from "@/lib/actions";

export interface ReviewValue {
  outcome: string;
  note: string;
  pages?: string[];
}

/**
 * 점검자 판정 기입 셀 — 매트릭스 행(WCAG SC / KWCAG 항목)마다 렌더.
 * 자동 판정을 점검자가 직접 확인·정정하고 관찰 내용을 기록한다.
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
  const [state, formAction, pending] = useActionState<SaveState, FormData>(saveReview, {});

  return (
    <details className="no-print">
      <summary className="cursor-pointer text-xs font-bold text-[var(--color-seal)] underline underline-offset-2">
        {current ? t("edit") : t("add")}
      </summary>
      <form action={formAction} className="mt-2 w-[min(16rem,78vw)] space-y-2 border-[1.5px] border-[var(--color-line)] bg-[var(--color-paper)] p-3">
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
            {current && <option value="">{t("outcomes.clear")}</option>}
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
        <div className="flex items-center gap-2">
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
