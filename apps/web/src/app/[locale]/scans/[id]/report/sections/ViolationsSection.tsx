import { getTranslations } from "next-intl/server";
import { GuideText } from "@/components/GuideText";
import type { RuleGroup } from "../loadReport";

function pick(text: { ko: string; en?: string }, locale: string): string {
  return locale === "en" && text.en ? text.en : text.ko;
}

/** 위반 상세 — 규칙별 영향 페이지·개선 가이드·대표 사례 */
export async function ViolationsSection({ locale, ruleGroups }: { locale: string; ruleGroups: RuleGroup[] }) {
  const t = await getTranslations("report");
  return (
    <section aria-labelledby="violations-heading" className="blind-mask print-break-before mt-12">
      <h2 id="violations-heading" className="font-display text-2xl font-bold">
        {t("violations.title")}
      </h2>
      {ruleGroups.length === 0 ? (
        <p className="mt-4 border-[1.5px] border-[var(--color-seal)] bg-[var(--color-seal-tint)] p-4 font-medium">
          {t("violations.empty")}
        </p>
      ) : (
        <div className="mt-5 space-y-8">
          {ruleGroups.map(({ ruleId, rows, entry, impact }) => {
            // 규칙별 영향 페이지 → 위반 요소 수
            const pageCounts = new Map<string, number>();
            for (const row of rows) {
              const u = row.scan_pages?.url ?? "?";
              pageCounts.set(u, (pageCounts.get(u) ?? 0) + 1);
            }
            const affected = [...pageCounts.entries()].sort((a, b) => b[1] - a[1]);
            return (
            <article key={ruleId} id={`rule-${ruleId}`} className="print-avoid-break doc-card scroll-mt-4 p-6">
              <header className="flex flex-wrap items-center gap-2">
                <span
                  className={`rounded-sm border-[1.5px] px-2 py-0.5 text-xs font-extrabold ${
                    impact === "critical" || impact === "serious"
                      ? "border-[var(--color-crit)] bg-[var(--color-crit-tint)] text-[var(--color-crit)]"
                      : "border-[var(--color-line)] bg-[var(--color-paper-warm)] text-[var(--color-ink-soft)]"
                  }`}
                >
                  {t(`impact.${impact}`)}
                </span>
                <h3 className="font-display min-w-0 flex-1 text-lg font-bold">{pick(entry.title, locale)}</h3>
                <span className="text-sm font-bold tabular-nums text-[var(--color-ink-soft)]">
                  {t("violations.nodes", { count: rows.length })}
                </span>
              </header>

              <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-[var(--color-ink-faint)]">
                <span>
                  {t("violations.level")}: {entry.level === "BP" ? t("violations.bp") : `WCAG ${entry.level}`}
                </span>
                {entry.wcag.length > 0 && <span>{t("violations.wcag")} {entry.wcag.join(", ")}</span>}
                {entry.kwcag.length > 0 && <span>{t("violations.kwcag")} {entry.kwcag.join(", ")}</span>}
                <span className="font-mono">{ruleId}</span>
              </p>

              {affected.length > 0 && (
                <div className="mt-3 border-l-[3px] border-[var(--color-crit)] bg-[var(--color-crit-tint)] py-2 pl-3">
                  <p className="text-sm font-bold">
                    {t("violations.affectedPages", { count: affected.length })}
                  </p>
                  <ul className="mt-1 space-y-0.5 text-xs text-[var(--color-ink-soft)]">
                    {affected.map(([url, count]) => (
                      <li key={url} className="flex flex-wrap gap-x-2">
                        <span className="break-all">{url}</span>
                        <span className="whitespace-nowrap font-bold tabular-nums">
                          {t("violations.nodes", { count })}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <h4 className="mt-4 text-sm font-bold">{t("violations.guideTitle")}</h4>
              <div className="mt-2">
                <GuideText text={pick(entry.guide, locale)} />
              </div>

              <h4 className="mt-5 text-sm font-bold">{t("violations.exampleTitle")}</h4>
              <ul className="mt-2 space-y-3">
                {rows.slice(0, 5).map((row, i) => (
                  <li key={i} className="border-l-[3px] border-[var(--color-line)] pl-3 text-sm">
                    <p className="break-all text-xs text-[var(--color-ink-faint)]">
                      {t("violations.pageLabel")}: {row.scan_pages?.url} · {t("violations.selectorLabel")}:{" "}
                      <code>{row.selector}</code>
                    </p>
                    <pre tabIndex={0} className="mt-1.5 overflow-x-auto rounded bg-[var(--color-paper-warm)] p-2.5 text-[0.8rem]">
                      <code>{row.html_snippet}</code>
                    </pre>
                    {row.failure_summary && (
                      <p className="mt-1.5 text-xs leading-relaxed text-[var(--color-ink-soft)]">
                        <span className="font-bold">{t("violations.diagLabel")}:</span>{" "}
                        <span className="whitespace-pre-wrap">{row.failure_summary}</span>
                      </p>
                    )}
                  </li>
                ))}
                {rows.length > 5 && (
                  <li className="text-xs text-[var(--color-ink-faint)]">+ {rows.length - 5}</li>
                )}
              </ul>

              {rows[0]?.help_url && (
                <a
                  href={rows[0].help_url}
                  rel="noopener"
                  className="no-print mt-4 inline-block text-sm font-semibold text-[var(--color-seal)] underline underline-offset-4"
                >
                  {t("violations.axeHelp")} ↗
                </a>
              )}
            </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
