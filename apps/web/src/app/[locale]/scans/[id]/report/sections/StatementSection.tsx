import { getFormatter, getTranslations } from "next-intl/server";
import type { EvaluationScope, ScanSummary } from "@a11ychk/core/catalog";

/**
 * WCAG-EM 2.0 평가 성명 (Step 5.3 — optional evaluation statement).
 * 2.0이 성명에 요구하는 항목을 갖춰 제시한다: 발행일, 지침 제목·버전·URI(WCAG 2.2),
 * 적합성 수준, 제품 정의(Step 1.1), 의존 기술(Step 2.4), 접근성 지원 기선(Step 1.3).
 * 자동 평가의 한계 고지(본문)는 유지 — 이 성명만으로 적합성 주장은 불가.
 */
export async function StatementSection({
  scope,
  summary,
  rootUrl,
  date,
}: {
  scope: EvaluationScope | null;
  summary: ScanSummary;
  rootUrl: string;
  date: string;
}) {
  const t = await getTranslations("report");
  const format = await getFormatter();

  const items: { label: string; value: string }[] = [
    { label: t("em.stmtDate"), value: format.dateTime(new Date(date), { dateStyle: "long" }) },
    { label: t("em.stmtGuidelines"), value: "WCAG 2.2 — https://www.w3.org/TR/WCAG22/" },
    { label: t("em.target"), value: scope?.conformanceTarget ?? "AA" },
    { label: t("em.stmtProduct"), value: rootUrl },
    { label: t("em.technologies"), value: (summary.sample?.technologies ?? []).join(", ") || "—" },
    { label: t("em.baseline"), value: (scope?.accessibilitySupportBaseline ?? []).join(", ") || "—" },
  ];

  return (
    <section aria-labelledby="statement-heading" className="print-avoid-break mt-12 border-[1.5px] border-[var(--color-ink)] bg-[var(--color-paper-warm)] p-6">
      <h2 id="statement-heading" className="font-display text-xl font-bold">
        {t("em.statementTitle")}
      </h2>
      <p className="mt-2 leading-relaxed">{t("em.statement", { target: scope?.conformanceTarget ?? "AA" })}</p>
      <dl className="mt-4 grid gap-x-6 gap-y-1.5 text-sm sm:grid-cols-[auto_1fr]">
        {items.map((it) => (
          <div key={it.label} className="contents">
            <dt className="font-semibold text-[var(--color-ink-soft)]">{it.label}</dt>
            <dd className="break-all">{it.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
