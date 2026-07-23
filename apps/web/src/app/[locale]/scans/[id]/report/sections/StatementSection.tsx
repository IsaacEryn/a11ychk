import { getTranslations } from "next-intl/server";
import type { EvaluationScope } from "@a11ychk/core/catalog";

/** WCAG-EM 2.0 평가 성명 (Step 5.3 — optional evaluation statement) */
export async function StatementSection({ scope }: { scope: EvaluationScope | null }) {
  const t = await getTranslations("report");
  return (
    <section aria-labelledby="statement-heading" className="print-avoid-break mt-12 border-[1.5px] border-[var(--color-ink)] bg-[var(--color-paper-warm)] p-6">
      <h2 id="statement-heading" className="font-display text-xl font-bold">
        {t("em.statementTitle")}
      </h2>
      <p className="mt-2 leading-relaxed">{t("em.statement", { target: scope?.conformanceTarget ?? "AA" })}</p>
    </section>
  );
}
