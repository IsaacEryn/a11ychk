import { getFormatter, getTranslations } from "next-intl/server";
import { getRuleEntry } from "@a11ychk/core/catalog";
import { CompareSelect } from "../CompareSelect";
import type { CompareData } from "../loadReport";

function pick(text: { ko: string; en?: string }, locale: string): string {
  return locale === "en" && text.en ? text.en : text.ko;
}

/** 전후 비교 — 같은 대상의 직전 검사와 비교해 개선 효과를 보여준다 */
export async function CompareSection({
  locale,
  compare,
  compareOptions,
  compareParam,
}: {
  locale: string;
  compare: CompareData | null;
  compareOptions: { id: string; created_at: string }[];
  compareParam?: string;
}) {
  if (!compare) return null;
  const t = await getTranslations("report");
  const format = await getFormatter();
  return (
    <section
      aria-labelledby="compare-heading"
      className="blind-mask print-avoid-break mt-6 border-[1.5px] border-[var(--color-seal)] bg-[var(--color-seal-tint)] p-6"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="compare-heading" className="font-display text-xl font-bold">
          {t("compare.title")}
        </h2>
        {compareOptions.length > 1 && (
          <CompareSelect
            label={t("compare.pickerLabel")}
            selected={compareOptions.find((o) => o.id === compareParam)?.id ?? compareOptions[0].id}
            options={compareOptions.map((o, i) => ({
              id: o.id,
              label:
                format.dateTime(new Date(o.created_at), { dateStyle: "medium", timeStyle: "short" }) +
                (i === compareOptions.length - 1 ? ` — ${t("compare.pickerFirst")}` : i === 0 ? ` — ${t("compare.pickerPrev")}` : ""),
            }))}
          />
        )}
      </div>
      <p className="mt-1.5 text-sm text-[var(--color-ink-soft)]">
        {t("compare.desc", { date: format.dateTime(new Date(compare.prevDate), { dateStyle: "medium" }) })}
      </p>
      <dl className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <div>
          <dt className="text-sm font-medium text-[var(--color-ink-soft)]">{t("compare.rate")}</dt>
          <dd
            className={`font-display text-3xl font-extrabold tabular-nums ${
              compare.rateDelta > 0 ? "text-[var(--color-seal)]" : compare.rateDelta < 0 ? "text-[var(--color-crit)]" : ""
            }`}
          >
            {compare.rateDelta > 0 ? "+" : ""}
            {compare.rateDelta}%p
          </dd>
        </div>
        <div>
          <dt className="text-sm font-medium text-[var(--color-ink-soft)]">{t("compare.nodes")}</dt>
          <dd
            className={`font-display text-3xl font-extrabold tabular-nums ${
              compare.nodesDelta < 0 ? "text-[var(--color-seal)]" : compare.nodesDelta > 0 ? "text-[var(--color-crit)]" : ""
            }`}
          >
            {compare.nodesDelta > 0 ? "+" : ""}
            {compare.nodesDelta}
          </dd>
        </div>
        <div>
          <dt className="text-sm font-medium text-[var(--color-ink-soft)]">{t("compare.resolved")}</dt>
          <dd className="font-display text-3xl font-extrabold tabular-nums text-[var(--color-seal)]">
            {compare.resolvedRules.length}
          </dd>
        </div>
        <div>
          <dt className="text-sm font-medium text-[var(--color-ink-soft)]">{t("compare.new")}</dt>
          <dd className="font-display text-3xl font-extrabold tabular-nums">{compare.newRules.length}</dd>
        </div>
      </dl>
      {compare.resolvedRules.length > 0 && (
        <p className="mt-3 text-sm text-[var(--color-ink-soft)]">
          <strong>{t("compare.resolvedList")}:</strong>{" "}
          {compare.resolvedRules.map((r) => pick(getRuleEntry(r).title, locale)).join(" · ")}
        </p>
      )}
      {compare.newRules.length > 0 && (
        <p className="mt-1.5 text-sm text-[var(--color-ink-soft)]">
          <strong>{t("compare.newList")}:</strong>{" "}
          {compare.newRules.map((r) => pick(getRuleEntry(r).title, locale)).join(" · ")}
        </p>
      )}
    </section>
  );
}
