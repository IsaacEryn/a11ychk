import { getTranslations, setRequestLocale } from "next-intl/server";
import { KWCAG_PRINCIPLE_LABEL, getManualCheckItems, type KwcagItem } from "@a11ychk/core/catalog";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "guide" });
  return { title: t("title"), description: t("desc") };
}

function pick(text: { ko: string; en?: string }, locale: string): string {
  return locale === "en" && text.en ? text.en : text.ko;
}

export default async function GuidePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("guide");

  const items = getManualCheckItems();
  const byPrinciple = new Map<KwcagItem["principle"], KwcagItem[]>();
  for (const item of items) {
    const list = byPrinciple.get(item.principle) ?? [];
    list.push(item);
    byPrinciple.set(item.principle, list);
  }

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
            {list.map((item) => (
              <li key={item.id} className="doc-card p-6">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="font-display text-lg font-bold">
                    <span className="mr-2 tabular-nums text-[var(--color-ink-faint)]">{item.id}</span>
                    {pick(item.name, locale)}
                  </h3>
                  <span
                    className={`rounded-full border-[1.5px] px-2.5 py-0.5 text-xs font-bold ${
                      item.autoCoverage === "none"
                        ? "border-[var(--color-crit)] text-[var(--color-crit)]"
                        : "border-[var(--color-seal)] text-[var(--color-seal)]"
                    }`}
                  >
                    {t(`coverage.${item.autoCoverage as "partial" | "none"}`)}
                  </span>
                </div>
                {item.wcag.length > 0 && (
                  <p className="mt-1.5 text-xs text-[var(--color-ink-faint)]">
                    {t("wcagRef")}: {item.wcag.join(", ")}
                  </p>
                )}
                {item.howToTest && <p className="mt-3 leading-relaxed text-[var(--color-ink-soft)]">{pick(item.howToTest, locale)}</p>}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
