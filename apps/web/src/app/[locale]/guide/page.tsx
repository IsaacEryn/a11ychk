import { getTranslations, setRequestLocale } from "next-intl/server";
import { localeAlternates } from "@/lib/seo/alternates";
import { JsonLd } from "@/components/JsonLd";
import {
  KWCAG_ITEMS,
  KWCAG_PRINCIPLE_LABEL,
  kwcagSlug,
  pickLocale as pick,
  getKwcagOnlyManualItems,
  getManualChecksByWcag,
  type KwcagPrinciple,
  type ManualWcagCheck,
} from "@a11ychk/core/catalog";
import { Link } from "@/i18n/navigation";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "guide" });
  return {
    alternates: localeAlternates(locale, "/guide"),
    title: t("title"),
    description: t("desc"),
  };
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
      {/* 허브→스포크 목록의 구조화 데이터 — 33개 항목 페이지의 관계를 명시 */}
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "ItemList",
          itemListElement: KWCAG_ITEMS.map((item, i) => ({
            "@type": "ListItem",
            position: i + 1,
            name: `${item.id} ${item.name.ko}`,
            url: `https://www.a11ychk.com/${locale}/guide/${kwcagSlug(item)}`,
          })),
        }}
      />
      <h1 className="font-display text-4xl font-bold">{t("title")}</h1>
      <p className="mt-3 max-w-2xl text-lg text-[var(--color-ink-soft)]">{t("desc")}</p>

      {/* KWCAG 33항목 색인 — 이 페이지는 WCAG 성공기준 축으로 엮여 있어서,
          항목 번호로 찾아오는 사람을 위한 진입 경로를 따로 둔다 */}
      <section aria-labelledby="kwcag-index-heading" className="mt-10 border-[1.5px] border-[var(--color-ink)] bg-[var(--color-paper-warm)] p-6">
        <h2 id="kwcag-index-heading" className="font-display text-2xl font-bold">
          {t("itemIndexTitle")}
        </h2>
        <p className="mt-2 text-[var(--color-ink-soft)]">{t("itemIndexDesc")}</p>
        {(["perceivable", "operable", "understandable", "robust"] as const).map((principle) => {
          const items = KWCAG_ITEMS.filter((i) => i.principle === principle);
          if (items.length === 0) return null;
          return (
            <div key={principle} className="mt-5">
              <h3 className="font-bold">{KWCAG_PRINCIPLE_LABEL[principle][locale === "en" ? "en" : "ko"]}</h3>
              <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-2">
                {items.map((item) => (
                  <li key={item.id}>
                    <Link href={`/guide/${kwcagSlug(item)}`} className="underline underline-offset-4">
                      <span className="mr-1.5 tabular-nums text-[var(--color-ink-faint)]">{item.id}</span>
                      {pick(item.name, locale)}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </section>

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
