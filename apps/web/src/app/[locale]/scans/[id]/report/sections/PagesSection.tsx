import { getTranslations } from "next-intl/server";
import type { PageCategory, SampleType } from "@a11ychk/core/catalog";
import { classifyScanError } from "@/lib/scanError";
import { RescanPageButton } from "../RescanButtons";
import type { PageRow } from "../loadReport";

/** 표본 페이지 상세 (WCAG-EM Step 3 + 검사 상태) */
export async function PagesSection({
  pages,
  canEdit,
  scanId,
}: {
  pages: PageRow[];
  canEdit: boolean;
  scanId: string;
}) {
  if ((pages ?? []).length === 0) return null;
  const t = await getTranslations("report");
  const failedPages = (pages ?? []).filter((p) => p.status === "failed");
  return (
    <section aria-labelledby="pages-heading" className="mt-8">
      <h2 id="pages-heading" className="font-display text-xl font-bold">
        {t("pages.title")}
      </h2>
      <p className="mt-1 text-sm text-[var(--color-ink-soft)]">
        {t("pages.summary", {
          total: (pages ?? []).length,
          done: (pages ?? []).filter((p) => p.status === "done").length,
          failed: failedPages.length,
        })}
      </p>
      <div className="table-scroll mt-3 overflow-x-auto">
        <table className="w-full min-w-[40rem] border-collapse border-y-[1.5px] border-[var(--color-ink)] text-sm">
          <caption className="sr-only">{t("pages.title")}</caption>
          <thead>
            <tr className="border-b-[1.5px] border-[var(--color-ink)] text-left">
              <th scope="col" className="col-sticky col-sticky-head py-2 pr-3 font-bold">{t("pages.colUrl")}</th>
              <th scope="col" className="w-24 py-2 pr-3 font-bold">{t("pages.colCategory")}</th>
              <th scope="col" className="w-20 py-2 pr-3 font-bold">{t("pages.colSample")}</th>
              <th scope="col" className="w-24 py-2 pr-3 text-right font-bold">{t("pages.colViolations")}</th>
              <th scope="col" className="w-40 py-2 font-bold">{t("pages.colStatus")}</th>
            </tr>
          </thead>
          <tbody>
            {(pages ?? []).map((p) => {
              const category = (p.category ?? "content") as PageCategory;
              const sampleType = (p.sample_type ?? "structured") as SampleType;
              const viaExtension = p.via === "extension";
              const vc = (p.violation_counts ?? {}) as Record<string, number>;
              const critSer = (vc.critical ?? 0) + (vc.serious ?? 0);
              const totalV = critSer + (vc.moderate ?? 0) + (vc.minor ?? 0);
              return (
                <tr key={p.id} className="border-b border-[var(--color-line)] align-top">
                  <td className="col-sticky max-w-[16rem] break-all py-2 pr-3">
                    {p.url}
                    {viaExtension && (
                      <span className="ml-2 inline-block whitespace-nowrap rounded-full border border-[var(--color-seal)] px-2 py-0.5 text-xs font-bold text-[var(--color-seal)]">
                        {t("pages.viaExtension")}
                      </span>
                    )}
                  </td>
                  <td className="py-2 pr-3 text-[var(--color-ink-soft)]">{t(`pages.category.${category}`)}</td>
                  <td className="py-2 pr-3 text-[var(--color-ink-soft)]">{t(`pages.sample.${sampleType}`)}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">
                    <span className="blind-ph text-[var(--color-ink-faint)]">—</span>
                    <span className="blind-mask">
                      {p.status === "done" ? (
                        totalV === 0 ? (
                          <span className="text-[var(--color-pass)]">0</span>
                        ) : (
                          <span className={critSer > 0 ? "font-bold text-[var(--color-crit)]" : "text-[var(--color-ink-soft)]"}>
                            {totalV}
                          </span>
                        )
                      ) : (
                        <span className="text-[var(--color-ink-faint)]">–</span>
                      )}
                    </span>
                  </td>
                  <td className="py-2">
                    {p.status === "done" ? (
                      <span className="font-bold text-[var(--color-pass)]">{t("pages.statusDone")}</span>
                    ) : p.status === "failed" ? (
                      <>
                        <span className="mr-2 font-bold text-[var(--color-crit)]">{t("pages.statusFailed")}</span>
                        {canEdit && <RescanPageButton scanId={scanId} pageId={p.id} />}
                        <p className="mt-0.5 text-xs leading-relaxed text-[var(--color-ink-soft)]">
                          {t(`failedPages.reasons.${classifyScanError(p.error as string | null)}`)}
                        </p>
                      </>
                    ) : (
                      <span className="text-[var(--color-ink-faint)]">{t("pages.statusSkipped")}</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
