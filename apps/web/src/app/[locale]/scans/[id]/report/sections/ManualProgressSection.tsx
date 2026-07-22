import { getTranslations } from "next-intl/server";
import type { ScanSummary } from "@a11ychk/core/catalog";
import type { ReviewValue } from "../ReviewCell";

/** 수동 판정 진행률 — 자동 도구가 확정하지 못한 항목 중 점검자 판정이 기입된 비율 */
export async function ManualProgressSection({
  summary,
  wcagReviews,
  kwcagReviews,
  preferred,
}: {
  summary: ScanSummary;
  wcagReviews: Map<string, ReviewValue>;
  kwcagReviews: Map<string, ReviewValue>;
  preferred: "wcag" | "kwcag";
}) {
  const wcagManualRows = (summary.wcagMatrix ?? []).filter(
    (r) => r.outcome === "notChecked" || r.outcome === "cannotTell",
  );
  const wcagManualDone = wcagManualRows.filter((r) => wcagReviews.has(r.scId)).length;
  const kwcagManualRows = (summary.kwcagMatrix ?? []).filter((r) => r.status === "manual" || r.status === "review");
  const kwcagManualDone = kwcagManualRows.filter((r) => kwcagReviews.has(r.itemId)).length;
  // 우선 표준이 먼저 오도록 정렬. 단일 표준 보기(std) 필터는 CSS(data-std-item)가 담당 —
  // 양쪽을 모두 렌더해 std 토글이 서버 재페치 없이 즉시 반영되게 한다.
  const stdOrder: ("kwcag" | "wcag")[] = preferred === "wcag" ? ["wcag", "kwcag"] : ["kwcag", "wcag"];
  const manualProgress: { key: string; label: string; done: number; total: number }[] = stdOrder
    .map((s) =>
      s === "kwcag"
        ? { key: "kwcag", label: "KWCAG 2.2", done: kwcagManualDone, total: kwcagManualRows.length }
        : { key: "wcag", label: "WCAG 2.2", done: wcagManualDone, total: wcagManualRows.length },
    )
    .filter((x) => x.total > 0);

  if (manualProgress.length === 0) return null;
  const t = await getTranslations("report");
  return (
    <section aria-labelledby="manual-progress-heading" className="print-avoid-break mt-6 doc-card p-6">
      <h2 id="manual-progress-heading" className="font-display text-xl font-bold">
        {t("manualProgress.title")}
      </h2>
      <p className="mt-1.5 text-sm text-[var(--color-ink-soft)]">{t("manualProgress.desc")}</p>
      <div className="mt-4 space-y-4">
        {manualProgress.map((x) => {
          const pct = Math.round((x.done / x.total) * 100);
          return (
            <div key={x.key} data-std-item={x.key}>
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-sm font-bold">{x.label}</span>
                <span className="text-sm tabular-nums text-[var(--color-ink-soft)]">
                  {t("manualProgress.line", { done: x.done, total: x.total })} ({pct}%)
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
