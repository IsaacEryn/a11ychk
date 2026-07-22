import { getTranslations } from "next-intl/server";
import type { RuleGroup } from "../loadReport";

function pick(text: { ko: string; en?: string }, locale: string): string {
  return locale === "en" && text.en ? text.en : text.ko;
}

/** 우선 수정 권고 — 심각도·규모 기준 상위 규칙 액션 플랜 */
export async function PrioritySection({ locale, ruleGroups }: { locale: string; ruleGroups: RuleGroup[] }) {
  if (ruleGroups.length === 0) return null;
  const t = await getTranslations("report");
  return (
    <section aria-labelledby="priority-heading" className="blind-mask print-avoid-break mt-12">
      <h2 id="priority-heading" className="font-display text-2xl font-bold">
        {t("priority.title")}
      </h2>
      <p className="mt-1.5 text-sm text-[var(--color-ink-soft)]">{t("priority.desc")}</p>
      <ol className="mt-4 space-y-3">
        {ruleGroups.slice(0, 5).map(({ ruleId, rows, entry, impact }, idx) => {
          const pageCount = new Set(rows.map((r) => r.scan_pages?.url ?? "?")).size;
          // 가이드 첫 문장 = 핵심 조치 (마크다운 기호 제거)
          const firstSentence = pick(entry.guide, locale)
            .split("\n")[0]!
            .replace(/[`*]/g, "")
            .slice(0, 160);
          return (
            <li key={ruleId} className="doc-card flex flex-wrap items-start gap-3 p-4">
              <span className="font-display text-2xl font-extrabold text-[var(--color-ink-faint)]">{idx + 1}</span>
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-2">
                  <span
                    className={`rounded-sm border-[1.5px] px-2 py-0.5 text-xs font-extrabold ${
                      impact === "critical" || impact === "serious"
                        ? "border-[var(--color-crit)] bg-[var(--color-crit-tint)] text-[var(--color-crit)]"
                        : "border-[var(--color-line)] bg-[var(--color-paper-warm)] text-[var(--color-ink-soft)]"
                    }`}
                  >
                    {t(`impact.${impact}`)}
                  </span>
                  <a href={`#rule-${ruleId}`} className="font-bold underline underline-offset-4 hover:text-[var(--color-seal)]">
                    {pick(entry.title, locale)}
                  </a>
                </p>
                <p className="mt-1 text-xs text-[var(--color-ink-faint)]">
                  {t("priority.stats", { nodes: rows.length, pages: pageCount })}
                </p>
                <p className="mt-1.5 text-sm text-[var(--color-ink-soft)]">{firstSentence}</p>
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
