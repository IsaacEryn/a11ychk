import { getTranslations } from "next-intl/server";
import { WCAG_BY_ID, type ScanSummary, type WcagOutcome } from "@a11ychk/core/catalog";
import { MatrixDetail } from "../MatrixDetail";
import { ReviewCell, type ReviewValue } from "../ReviewCell";
import { wcagRowData } from "../reportFilter";

function pick(text: { ko: string; en?: string }, locale: string): string {
  return locale === "en" && text.en ? text.en : text.ko;
}

/** WCAG 2.2 성공기준 매트릭스 (WCAG-EM 2.0 Step 4) — 행 가시성은 reportFilter의 data 속성이 담당 */
export async function WcagMatrixSection({
  locale,
  summary,
  wcagReviews,
  canEdit,
  scanId,
  donePageUrls,
  outcomeStyle,
}: {
  locale: string;
  summary: ScanSummary;
  wcagReviews: Map<string, ReviewValue>;
  canEdit: boolean;
  scanId: string;
  donePageUrls: string[];
  outcomeStyle: Record<WcagOutcome, string>;
}) {
  const t = await getTranslations("report");
  return (
    <section data-block="wcag" aria-labelledby="wcag-heading" className="print-break-before mt-10">
      <h2 id="wcag-heading" className="font-display text-2xl font-bold">
        {t("wcag.title")}
      </h2>
      <p className="mt-1.5 text-sm text-[var(--color-ink-soft)]">{t("wcag.desc")}</p>
      <div className="table-scroll mt-4 overflow-x-auto">
        <table className="w-full min-w-[40rem] border-collapse border-y-[1.5px] border-[var(--color-ink)] text-sm">
          <caption className="sr-only">{t("wcag.title")}</caption>
          <thead>
            <tr className="border-b-[1.5px] border-[var(--color-ink)] text-left">
              <th scope="col" className="col-sticky col-sticky-head py-2 pr-3 font-bold">{t("wcag.colSc")}</th>
              <th scope="col" className="w-16 py-2 pr-3 font-bold">{t("wcag.colLevel")}</th>
              <th scope="col" className="w-32 py-2 pr-3 font-bold">{t("wcag.colOutcome")}</th>
              <th scope="col" className="w-14 py-2 pr-3 text-right font-bold">{t("wcag.colCount")}</th>
              {canEdit && (
                <th scope="col" className="no-print w-24 py-2 font-bold">{t("review.col")}</th>
              )}
            </tr>
          </thead>
          <tbody>
            {summary.wcagMatrix.map((row) => {
              const c = WCAG_BY_ID.get(row.scId);
              if (!c) return null;
              const review = wcagReviews.get(row.scId) ?? null;
              const effective = (review?.outcome as WcagOutcome | undefined) ?? row.outcome;
              return (
                <tr key={row.scId} {...wcagRowData(row.outcome, review)} className="border-b border-[var(--color-line)] align-top">
                  <th scope="row" className="col-sticky w-[15rem] py-2 pr-3 text-left font-medium">
                    <span className="mr-2 tabular-nums text-[var(--color-ink-faint)]">{row.scId}</span>
                    {pick(c.name, locale)}
                    {review?.note && (
                      <p className="mt-1 text-xs font-normal leading-relaxed text-[var(--color-ink-soft)]">
                        <strong>{t("review.noteLabel")}:</strong> {review.note}
                      </p>
                    )}
                    {review?.pages && review.pages.length > 0 && (
                      <p className="mt-1 break-all text-xs font-normal leading-relaxed text-[var(--color-ink-soft)]">
                        <strong>{t("review.relatedPages")}:</strong> {review.pages.join(" · ")}
                      </p>
                    )}
                    {/* 스크롤 없이 그 자리에서: 위반→개선 방법 / 확인 필요→확인 방법 / 수동→검사 방법
                        위반·확인 상세는 자동 결과이므로 블라인드 판정 중 마스킹(검사 방법 안내는 유지) */}
                    {row.outcome === "failed" && row.ruleIds.length > 0 && (
                      <div className="blind-mask">
                        <MatrixDetail kind="fix" ruleIds={row.ruleIds} scId={row.scId} locale={locale} />
                      </div>
                    )}
                    {row.outcome === "cannotTell" && (row.reviewRuleIds?.length ?? 0) > 0 && (
                      <div className="blind-mask">
                        <MatrixDetail kind="review" ruleIds={row.reviewRuleIds} scId={row.scId} locale={locale} />
                      </div>
                    )}
                    {row.outcome === "notChecked" && (
                      <MatrixDetail kind="manual" scId={row.scId} locale={locale} />
                    )}
                  </th>
                  <td className="py-2 pr-3 text-[var(--color-ink-faint)]">{c.level}</td>
                  <td className="py-2 pr-3">
                    {/* 블라인드 판정 중에는 자동 판정 배지를 마스킹(점검자 자신의 판정은 유지) */}
                    {!review && (
                      <span className="blind-ph rounded-sm border border-[var(--color-line)] px-2 py-0.5 text-xs font-bold text-[var(--color-ink-faint)]">
                        {t("blind.masked")}
                      </span>
                    )}
                    <span className={review ? undefined : "blind-mask"}>
                      <span className={`inline-block rounded-sm border px-2 py-0.5 text-xs font-bold ${outcomeStyle[effective]}`}>
                        {t(`wcag.outcome.${effective}`)}
                      </span>
                      {review && (
                        <span className="ml-1 inline-block rounded-sm bg-[var(--color-mark)] px-1.5 py-0.5 text-[0.65rem] font-extrabold text-[var(--color-ink-on-mark)]">
                          {t("review.badge")}
                        </span>
                      )}
                    </span>
                  </td>
                  <td className="py-2 pr-3 text-right font-bold tabular-nums">
                    <span className="blind-ph font-normal text-[var(--color-ink-faint)]">—</span>
                    <span className="blind-mask">{row.violationCount > 0 ? row.violationCount : "—"}</span>
                  </td>
                  {canEdit && (
                    <td className="no-print py-2">
                      <ReviewCell scanId={scanId} standard="wcag" itemId={row.scId} current={review} pageUrls={donePageUrls} />
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-xs leading-relaxed text-[var(--color-ink-faint)]">{t("wcag.notCheckedNote")}</p>
    </section>
  );
}
