import { getTranslations } from "next-intl/server";
import type { Impact, ScanSummary } from "@a11ychk/core/catalog";
import { ScoresCard } from "./ScoresCard";

const IMPACT_ORDER: Impact[] = ["critical", "serious", "moderate", "minor"];

/** 요약: 자동/수동/통합 준수율 + 심각도별 위반 */
export async function ScoreSection({ summary }: { summary: ScanSummary }) {
  const t = await getTranslations("report");
  const maxImpact = Math.max(1, ...IMPACT_ORDER.map((k) => summary.byImpact[k]));
  // 모범 사례 권고 — WCAG 성공기준에 해당하지 않아 준수율에 반영되지 않음(위반 수/준수율 불일치 설명)
  const bp = summary.bestPractice ?? [];
  const bpNodes = bp.reduce((n, r) => n + r.count, 0);
  return (
    <section aria-labelledby="score-heading" className="blind-mask print-avoid-break mt-8">
      <h2 id="score-heading" className="sr-only">
        {summary.scores ? t("scores.combined") : t("score.title")}
      </h2>
      <div className="grid gap-5 lg:grid-cols-[1.15fr_1fr]">
        {summary.scores ? (
          <ScoresCard
            initial={summary.scores}
            totalViolations={summary.totalViolations}
            totalViolationNodes={summary.totalViolationNodes}
            bpTypes={bp.length}
            bpNodes={bpNodes}
          />
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
            {bp.length > 0 && (
              <p className="mt-3 text-xs leading-relaxed text-[var(--color-ink-soft)]">
                {t("scores.bestPracticeNote", { types: bp.length, nodes: bpNodes })}
              </p>
            )}
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
