import { getTranslations, setRequestLocale } from "next-intl/server";
import {
  KWCAG_PRINCIPLE_LABEL,
  getKwcagOnlyManualItems,
  getManualChecksByWcag,
  type KwcagPrinciple,
  type ManualWcagCheck,
} from "@a11ychk/core/catalog";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "guide" });
  return { title: t("title"), description: t("desc") };
}

function pick(text: { ko: string; en?: string }, locale: string): string {
  return locale === "en" && text.en ? text.en : text.ko;
}

/** 수동 검사 가이드 — WCAG 성공기준 축(A/AA 표시), 검사 방법은 대응 KWCAG 항목에서 */
export default async function GuidePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("guide");

  const checks = getManualChecksByWcag();
  const byPrinciple = new Map<KwcagPrinciple, ManualWcagCheck[]>();
  for (const c of checks) {
    const list = byPrinciple.get(c.principle) ?? [];
    list.push(c);
    byPrinciple.set(c.principle, list);
  }
  const kwcagOnly = getKwcagOnlyManualItems();

  return (
    <div className="mx-auto max-w-4xl px-4 py-12 sm:px-6">
      <h1 className="font-display text-4xl font-bold">{t("title")}</h1>
      <p className="mt-3 max-w-2xl text-lg text-[var(--color-ink-soft)]">{t("desc")}</p>

      {[...byPrinciple.entries()].map(([principle, list]) => (
        <section key={principle} aria-labelledby={`principle-${principle}`} className="mt-12">
          <h2
            id={`principle-${principle}`}
            className="font-display border-b-[1.5px] border-[var(--color-ink)] pb-2 text-2xl font-bold"
          >
            {KWCAG_PRINCIPLE_LABEL[principle][locale === "en" ? "en" : "ko"]}
          </h2>
          <ul className="mt-5 space-y-4">
            {list.map((c) => (
              <li key={c.scId} className="doc-card p-6">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="font-display text-lg font-bold">
                    <span className="mr-2 tabular-nums text-[var(--color-ink-faint)]">{c.scId}</span>
                    {pick(c.name, locale)}
                  </h3>
                  <span
                    aria-label={`${t("levelAria")} ${c.level}`}
                    className="rounded-full border-[1.5px] border-[var(--color-ink)] px-2.5 py-0.5 text-xs font-bold"
                  >
                    {c.level}
                  </span>
                  <span
                    className={`rounded-full border-[1.5px] px-2.5 py-0.5 text-xs font-bold ${
                      c.autoCoverage === "none"
                        ? "border-[var(--color-crit)] text-[var(--color-crit)]"
                        : "border-[var(--color-seal)] text-[var(--color-seal)]"
                    }`}
                  >
                    {t(`coverage.${c.autoCoverage as "partial" | "none"}`)}
                  </span>
                </div>
                <p className="mt-1.5 text-xs text-[var(--color-ink-faint)]">
                  {t("kwcagRef")}: {c.sources.map((s) => `${s.kwcagId} ${pick(s.name, locale)}`).join(" · ")}
                </p>
                {c.sources.map(
                  (s) =>
                    s.howToTest && (
                      <p key={s.kwcagId} className="mt-3 leading-relaxed text-[var(--color-ink-soft)]">
                        {c.sources.length > 1 && (
                          <strong className="mr-1 text-[var(--color-ink)]">({s.kwcagId})</strong>
                        )}
                        {pick(s.howToTest, locale)}
                      </p>
                    ),
                )}
              </li>
            ))}
          </ul>
        </section>
      ))}

      {/* KWCAG 고유 항목 — WCAG 대응이 없는 국내 기준 추가 항목 */}
      {kwcagOnly.length > 0 && (
        <section aria-labelledby="kwcag-only-heading" className="mt-12">
          <h2
            id="kwcag-only-heading"
            className="font-display border-b-[1.5px] border-[var(--color-ink)] pb-2 text-2xl font-bold"
          >
            {t("kwcagOnlyTitle")}
          </h2>
          <ul className="mt-5 space-y-4">
            {kwcagOnly.map((item) => (
              <li key={item.id} className="doc-card p-6">
                <h3 className="font-display text-lg font-bold">
                  <span className="mr-2 tabular-nums text-[var(--color-ink-faint)]">{item.id}</span>
                  {pick(item.name, locale)}
                </h3>
                {item.howToTest && (
                  <p className="mt-3 leading-relaxed text-[var(--color-ink-soft)]">{pick(item.howToTest, locale)}</p>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
