"use client";

import { useTranslations } from "next-intl";
import { useReviews } from "../ReviewsProvider";

/**
 * 수동 판정 진행률 — 자동 도구가 확정하지 못한 항목 중 점검자 판정이 기입된 비율.
 * ReviewsProvider가 있으면(소유자 화면) 판정 저장이 서버 재렌더 없이 즉시 반영되고,
 * "다음 미판정 항목" 버튼으로 표의 해당 셀로 바로 이동한다.
 */
export function ManualProgressSection({
  initial,
  preferred,
  canEdit,
}: {
  /** 서버 계산 초기값 (컨텍스트 부재 시 그대로 표시) */
  initial: { wcag: { done: number; total: number }; kwcag: { done: number; total: number } };
  preferred: "wcag" | "kwcag";
  canEdit: boolean;
}) {
  const t = useTranslations("report");
  const reviews = useReviews();

  const stdOrder: ("kwcag" | "wcag")[] = preferred === "wcag" ? ["wcag", "kwcag"] : ["kwcag", "wcag"];
  const manualProgress = stdOrder
    .map((s) => ({
      key: s,
      label: s === "kwcag" ? "KWCAG 2.2" : "WCAG 2.2",
      done: reviews ? reviews.doneCount(s) : initial[s].done,
      total: reviews ? reviews.manualTotal(s) : initial[s].total,
    }))
    .filter((x) => x.total > 0);

  if (manualProgress.length === 0) return null;
  return (
    <section aria-labelledby="manual-progress-heading" className="print-avoid-break mt-6 doc-card p-6">
      <h2 id="manual-progress-heading" className="font-display text-xl font-bold">
        {t("manualProgress.title")}
      </h2>
      <p className="mt-1.5 text-sm text-[var(--color-ink-soft)]">{t("manualProgress.desc")}</p>
      <div className="mt-4 space-y-4" aria-live="polite">
        {manualProgress.map((x) => {
          const pct = Math.round((x.done / x.total) * 100);
          return (
            <div key={x.key} data-std-item={x.key}>
              <div className="flex flex-wrap items-baseline justify-between gap-3">
                <span className="text-sm font-bold">{x.label}</span>
                <span className="text-sm tabular-nums text-[var(--color-ink-soft)]">
                  {t("manualProgress.line", { done: x.done, total: x.total })} ({pct}%)
                  {/* 미판정 항목으로 점프 — 진행률에서 곧장 다음 작업 지점으로 */}
                  {canEdit && reviews && x.done < x.total && (
                    <button
                      type="button"
                      onClick={() => reviews.focusNext(x.key)}
                      className="no-print ml-2 rounded border-[1.5px] border-[var(--color-ink)] px-2 py-0.5 text-xs font-bold hover:bg-[var(--color-paper-warm)]"
                    >
                      {t("manualProgress.jump")}
                    </button>
                  )}
                </span>
              </div>
              <div
                role="progressbar"
                aria-valuenow={x.done}
                aria-valuemin={0}
                aria-valuemax={x.total}
                aria-label={`${x.label} ${t("manualProgress.title")}`}
                className="mt-1.5 h-2.5 overflow-hidden rounded-full border border-[var(--color-line)] bg-[var(--color-paper-warm)]"
              >
                <div className="h-full bg-[var(--color-seal)]" style={{ width: `${pct}%` }} />
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
