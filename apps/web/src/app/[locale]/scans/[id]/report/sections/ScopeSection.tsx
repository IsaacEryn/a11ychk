import { getTranslations } from "next-intl/server";
import type { EvaluationScope, ScanSummary } from "@a11ychk/core/catalog";

/** WCAG-EM 2.0 Step 1·2·3: 평가 범위 + 표본 */
export async function ScopeSection({
  scope,
  sample,
}: {
  scope: EvaluationScope | null;
  sample: ScanSummary["sample"];
}) {
  if (!scope && !sample) return null;
  const t = await getTranslations("report");
  return (
    <section aria-labelledby="scope-heading" className="print-avoid-break mt-8 grid gap-5 md:grid-cols-2">
      {scope && (
        <div className="doc-card p-6">
          <h2 id="scope-heading" className="font-display text-lg font-bold">
            {t("em.scopeTitle")}
          </h2>
          <dl className="mt-3 space-y-2 text-sm">
            <div className="flex gap-2">
              <dt className="shrink-0 font-bold">{t("em.target")}</dt>
              <dd>WCAG 2.2 {scope.conformanceTarget}</dd>
            </div>
            <div>
              <dt className="font-bold">{t("em.baseline")}</dt>
              <dd className="mt-1 text-[var(--color-ink-soft)]">
                {scope.accessibilitySupportBaseline.join(" · ")}
              </dd>
            </div>
            {scope.notes && (
              <div>
                <dt className="font-bold">{t("em.notes")}</dt>
                <dd className="mt-1 whitespace-pre-wrap text-[var(--color-ink-soft)]">{scope.notes}</dd>
              </div>
            )}
          </dl>
        </div>
      )}
      {sample && (
        <div className="doc-card p-6">
          <h2 className="font-display text-lg font-bold">{t("em.sampleTitle")}</h2>
          <dl className="mt-3 space-y-2 text-sm">
            <div className="flex gap-2">
              <dt className="shrink-0 font-bold">{t("em.technologies")}</dt>
              <dd>{sample.technologies.join(", ")}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="shrink-0 font-bold">{t("em.sampleCounts")}</dt>
              <dd>
                {t("em.structured")} {sample.structuredCount} · {t("em.random")} {sample.randomCount}
                {sample.processCount > 0 ? ` · ${t("em.process")} ${sample.processCount}` : ""}
              </dd>
            </div>
            <div>
              <dt className="font-bold">{t("em.method")}</dt>
              <dd className="mt-1 text-[var(--color-ink-soft)]">{sample.method}</dd>
            </div>
            <div>
              <dt className="font-bold">{t("em.representativeness")}</dt>
              <dd className="mt-1 text-[var(--color-ink-soft)]">
                {sample.randomSurfacedNewRules.length === 0
                  ? t("em.repOk")
                  : t("em.repNew", { count: sample.randomSurfacedNewRules.length })}
              </dd>
            </div>
          </dl>
        </div>
      )}
    </section>
  );
}
