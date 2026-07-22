import { getTranslations } from "next-intl/server";
import type { Impact, ScanSummary } from "@a11ychk/core/catalog";

const IMPACT_ORDER: Impact[] = ["critical", "serious", "moderate", "minor"];

/** 요약: 자동/수동/통합 준수율 + 심각도별 위반 */
export async function ScoreSection({ summary }: { summary: ScanSummary }) {
  const t = await getTranslations("report");
  const maxImpact = Math.max(1, ...IMPACT_ORDER.map((k) => summary.byImpact[k]));
  return (
    <section aria-labelledby="score-heading" className="blind-mask print-avoid-break mt-8">
      <h2 id="score-heading" className="sr-only">
        {summary.scores ? t("scores.combined") : t("score.title")}
      </h2>
      <div className="grid gap-5 lg:grid-cols-[1.15fr_1fr]">
        {summary.scores ? (
          <div className="doc-card p-6">
            {/* 통합 준수율 (headline) */}
            <div className="flex items-baseline justify-between gap-4">
              <div>
                <p className="text-sm font-bold text-[var(--color-ink-soft)]">{t("scores.combined")}</p>
                <p className="font-display mt-1 text-6xl font-extrabold leading-none text-[var(--color-seal)]">
                  {summary.scores.combined.rate}
                  <span className="text-2xl">%</span>
                </p>
              </div>
              <p className="max-w-[13rem] text-right text-xs leading-relaxed text-[var(--color-ink-faint)]">
                {t("scores.combinedDesc")}
              </p>
            </div>
            {/* 자동 / 수동 분해 */}
            <div className="mt-5 grid grid-cols-2 gap-3">
              {(["automated", "manual"] as const).map((kind) => {
                const s = summary.scores![kind];
                return (
                  <div key={kind} className="rounded-md border border-[var(--color-line)] bg-[var(--color-paper-warm)] p-3.5">
                    <p className="text-xs font-bold text-[var(--color-ink-soft)]">{t(`scores.${kind}`)}</p>
                    <p className="font-display mt-0.5 text-3xl font-extrabold leading-none">
                      {s.evaluated === 0 ? "—" : `${s.rate}%`}
                    </p>
                    <p className="mt-1.5 text-[11px] leading-tight text-[var(--color-ink-faint)]">
                      {s.evaluated === 0
                        ? t("scores.noManual")
                        : t("scores.passFail", { passed: s.passed, failed: s.failed })}
                    </p>
                    <p className="text-[11px] leading-tight text-[var(--color-ink-faint)]">
                      {t("scores.coverage", { evaluated: s.evaluated, total: summary.scores!.totalCriteria })}
                    </p>
                  </div>
                );
              })}
            </div>
            <p className="mt-3.5 flex flex-wrap gap-x-4 gap-y-1 text-sm">
              <span>
                {t("scores.violations")}{" "}
                <strong className="text-[var(--color-crit)]">{t("scores.unit", { count: summary.totalViolations })}</strong>
              </span>
              <span>
                {t("scores.violationNodes")}{" "}
                <strong className="text-[var(--color-crit)]">{t("scores.unit", { count: summary.totalViolationNodes })}</strong>
              </span>
            </p>
            <p className="mt-3 text-xs leading-relaxed text-[var(--color-ink-faint)]">{t("scores.legend")}</p>
          </div>
        ) : (
          <div className="doc-card flex flex-col items-center justify-center px-10 py-8 text-center">
            <p className="text-sm font-bold text-[var(--color-ink-soft)]">{t("score.title")}</p>
            <p className="font-display mt-1 text-6xl font-extrabold text-[var(--color-seal)]">
              {summary.complianceRate}
              <span className="text-2xl">%</span>
            </p>
            <p className="mt-3 flex gap-4 text-sm">
              <span>
                {t("score.violations")}{" "}
                <strong className="text-[var(--color-crit)]">{t("score.unit", { count: summary.totalViolations })}</strong>
              </span>
              <span>
                {t("score.violationNodes")}{" "}
                <strong className="text-[var(--color-crit)]">{t("score.unit", { count: summary.totalViolationNodes })}</strong>
              </span>
            </p>
            <p className="mt-4 text-xs leading-relaxed text-[var(--color-ink-faint)]">{t("score.desc")}</p>
          </div>
        )}
        <div className="doc-card p-6">
          <h3 className="text-sm font-bold text-[var(--color-ink-soft)]">{t("impact.title")}</h3>
          <ul className="mt-4 space-y-2.5">
            {IMPACT_ORDER.map((key) => (
              <li key={key} className="grid grid-cols-[5rem_1fr_3rem] items-center gap-3 text-sm">
                <span className="font-semibold">{t(`impact.${key}`)}</span>
                <span aria-hidden="true" className="h-4 overflow-hidden rounded-sm bg-[var(--color-paper-warm)]">
                  <span
                    className={`block h-full ${key === "critical" || key === "serious" ? "bg-[var(--color-crit)]" : "bg-[var(--color-ink-faint)]"}`}
                    style={{ width: `${(summary.byImpact[key] / maxImpact) * 100}%` }}
                  />
                </span>
                <span className="text-right font-bold tabular-nums">{summary.byImpact[key]}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
