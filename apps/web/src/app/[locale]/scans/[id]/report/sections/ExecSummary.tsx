import { getTranslations } from "next-intl/server";
import type { ReportMeta } from "@a11ychk/core/catalog";

/** Executive Summary (총평) — 점검자가 기입한 경우에만 표시 */
export async function ExecSummary({ meta }: { meta: ReportMeta | null }) {
  if (!meta?.executiveSummary) return null;
  const t = await getTranslations("report");
  return (
    <section aria-labelledby="exec-heading" className="print-avoid-break doc-card mt-8 p-6">
      <h2 id="exec-heading" className="font-display text-xl font-bold">
        {t("execSummary")}
      </h2>
      <p className="mt-2 whitespace-pre-wrap leading-relaxed">{meta.executiveSummary}</p>
    </section>
  );
}
