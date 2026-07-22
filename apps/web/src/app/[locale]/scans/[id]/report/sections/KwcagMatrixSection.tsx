import { getTranslations } from "next-intl/server";
import {
  KWCAG_BY_ID,
  KWCAG_PRINCIPLE_LABEL,
  type ScanSummary,
  type WcagOutcome,
} from "@a11ychk/core/catalog";
import { MatrixDetail } from "../MatrixDetail";
import { ReviewCell, type ReviewValue } from "../ReviewCell";
import { kwcagRowData } from "../reportFilter";
import type { KwcagPageRate } from "../kwcagPageRate";

function pick(text: { ko: string; en?: string }, locale: string): string {
  return locale === "en" && text.en ? text.en : text.ko;
}

// 자동 판정 상태 배지 스타일 (KWCAG status 키)
const statusStyle: Record<string, string> = {
  pass: "bg-[var(--color-seal-tint)] text-[var(--color-pass)] border-[var(--color-seal)]",
  fail: "bg-[var(--color-crit-tint)] text-[var(--color-crit)] border-[var(--color-crit)]",
  review: "bg-[var(--color-warn-tint)] text-[var(--color-ink)] border-[var(--color-line)]",
  manual: "bg-[var(--color-paper-warm)] text-[var(--color-ink-soft)] border-[var(--color-line)]",
  "not-applicable": "text-[var(--color-ink-faint)] border-[var(--color-line)]",
};

/** KWCAG 2.2 33항목 매트릭스 — 행 가시성은 reportFilter의 data 속성이 담당 */
export async function KwcagMatrixSection({
  locale,
  summary,
  kwcagReviews,
  kwcagRates,
  canEdit,
  scanId,
  donePageUrls,
  outcomeStyle,
}: {
  locale: string;
  summary: ScanSummary;
  kwcagReviews: Map<string, ReviewValue>;
  kwcagRates: Map<string, KwcagPageRate>;
  canEdit: boolean;
  scanId: string;
  donePageUrls: string[];
  outcomeStyle: Record<WcagOutcome, string>;
}) {
  const t = await getTranslations("report");
  return (
    <section aria-labelledby="kwcag-heading" className="print-break-before mt-10">
      <h2 id="kwcag-heading" className="font-display text-2xl font-bold">
        {t("kwcag.title")}
      </h2>
      <p className="mt-1.5 text-sm text-[var(--color-ink-soft)]">{t("kwcag.desc")}</p>
      <div className="table-scroll mt-4 overflow-x-auto">
        <table className="w-full min-w-[40rem] border-collapse border-y-[1.5px] border-[var(--color-ink)] text-sm">
          <caption className="sr-only">{t("kwcag.title")}</caption>
          <thead>
            <tr className="border-b-[1.5px] border-[var(--color-ink)] text-left">
              <th scope="col" className="col-sticky col-sticky-head py-2 pr-3 font-bold">
                {t("kwcag.colItem")}
              </th>
              <th scope="col" className="w-32 py-2 pr-3 font-bold">
                {t("kwcag.colStatus")}
              </th>
              <th scope="col" className="w-14 py-2 pr-3 text-right font-bold">
                {t("kwcag.colCount")}
              </th>
              <th scope="col" className="w-24 py-2 pr-3 text-right font-bold">
                {t("kwcag.colPageRate")}
              </th>
              {canEdit && (
                <th scope="col" className="no-print w-24 py-2 font-bold">{t("review.col")}</th>
              )}
            </tr>
          </thead>
          <tbody>
            {summary.kwcagMatrix.map((row) => {
              const item = KWCAG_BY_ID.get(row.itemId);
              if (!item) return null;
              const review = kwcagReviews.get(row.itemId) ?? null;
              return (
                <tr key={row.itemId} {...kwcagRowData(row.status, review)} className="border-b border-[var(--color-line)] align-top">
                  <th scope="row" className="col-sticky w-[15rem] py-2 pr-3 text-left font-medium">
                    <span className="mr-2 tabular-nums text-[var(--color-ink-faint)]">{item.id}</span>
                    {pick(item.name, locale)}
                    {item.addedIn22 && (
                      <span className="ml-2 rounded-sm bg-[var(--color-seal-tint)] px-1.5 py-0.5 text-[0.7rem] font-bold text-[var(--color-seal)]">
                        {t("kwcag.new22")}
                      </span>
                    )}
                    <span className="ml-2 text-xs text-[var(--color-ink-faint)]">
                      {KWCAG_PRINCIPLE_LABEL[item.principle][locale === "en" ? "en" : "ko"]}
                    </span>
                    {review?.note && (
                      <p className="mt-1 text-xs font-normal leading-relaxed text-[var(--color-ink-soft)]">
                        <strong>{t("review.noteLabel")}:</strong> {review.note}
                      </p>
                    )}
                    {row.status === "fail" && row.ruleIds.length > 0 && (
                      <div className="blind-mask">
                        <MatrixDetail kind="fix" ruleIds={row.ruleIds} locale={locale} />
                      </div>
                    )}
                    {row.status === "review" && (row.reviewRuleIds?.length ?? 0) > 0 && (
                      <div className="blind-mask">
                        <MatrixDetail kind="review" ruleIds={row.reviewRuleIds} locale={locale} />
                      </div>
                    )}
                    {(row.status === "manual" || row.status === "not-applicable") && item.howToTest && (
                      <MatrixDetail kind="manual" howToTest={item.howToTest} locale={locale} />
                    )}
                  </th>
                  <td className="py-2 pr-3">
                    {review ? (
                      <>
                        <span
                          className={`inline-block rounded-sm border px-2 py-0.5 text-xs font-bold ${outcomeStyle[review.outcome as WcagOutcome]}`}
                        >
                          {t(`wcag.outcome.${review.outcome as WcagOutcome}`)}
                        </span>
                        <span className="ml-1 inline-block rounded-sm bg-[var(--color-mark)] px-1.5 py-0.5 text-[0.65rem] font-extrabold text-[var(--color-ink-on-mark)]">
                          {t("review.badge")}
                        </span>
                      </>
                    ) : (
                      <>
                        {/* 블라인드 판정 중에는 자동 상태 배지 마스킹 */}
                        <span className="blind-ph rounded-sm border border-[var(--color-line)] px-2 py-0.5 text-xs font-bold text-[var(--color-ink-faint)]">
                          {t("blind.masked")}
                        </span>
                        <span className={`blind-mask inline-block rounded-sm border px-2 py-0.5 text-xs font-bold ${statusStyle[row.status]}`}>
                          {t(`kwcag.status.${row.status}`)}
                        </span>
                      </>
                    )}
                  </td>
                  <td className="py-2 pr-3 text-right font-bold tabular-nums">
                    <span className="blind-ph font-normal text-[var(--color-ink-faint)]">—</span>
                    <span className="blind-mask">{row.violationCount > 0 ? row.violationCount : "—"}</span>
                  </td>
                  <td className="py-2 pr-3 text-right tabular-nums">
                    <span className="blind-ph text-[var(--color-ink-faint)]">—</span>
                    <span className="blind-mask">
                      {(() => {
                        const applicable = row.status === "pass" || row.status === "fail" || row.status === "review";
                        const rate = kwcagRates.get(row.itemId)?.rate;
                        if (!applicable || rate == null) return <span className="text-[var(--color-ink-faint)]">—</span>;
                        return (
                          <span className={rate >= 95 ? "font-bold text-[var(--color-pass)]" : "font-bold text-[var(--color-crit)]"}>
                            {rate}%
                          </span>
                        );
                      })()}
                    </span>
                  </td>
                  {canEdit && (
                    <td className="no-print py-2">
                      <ReviewCell scanId={scanId} standard="kwcag" itemId={row.itemId} current={review} pageUrls={donePageUrls} />
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-xs leading-relaxed text-[var(--color-ink-faint)]">{t("kwcag.certNote")}</p>
    </section>
  );
}
