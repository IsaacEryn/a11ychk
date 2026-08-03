import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { KWCAG_ITEMS, kwcagSlug, pickLocale } from "@a11ychk/core/catalog";
import { Link } from "@/i18n/navigation";
import { localeAlternates } from "@/lib/seo/alternates";

// 사람이 읽는 사이트맵 — 상단 내비게이션과 별개로 페이지를 찾는 두 번째 방법 (WCAG 2.4.5 여러 방법)
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "sitemap" });
  return {
    alternates: localeAlternates(locale, "/sitemap"),
    title: t("title"),
    description: t("desc"),
  };
}

export default async function SitemapPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("sitemap");

  const groups: { key: string; heading: string; items: [string, string][] }[] = [
    {
      key: "service",
      heading: t("groupService"),
      items: [
        ["/", t("home")],
        ["/scan", t("scan")],
        ["/access-check", t("accessCheck")],
        // /extension은 페이지가 없다(connect만 존재) — 404 링크였음
        ["/extension/connect", t("extension")],
      ],
    },
    {
      key: "my",
      heading: t("groupMy"),
      items: [
        ["/dashboard", t("dashboard")],
        ["/mypage", t("mypage")],
        ["/inquiries", t("inquiries")],
        ["/login", t("login")],
      ],
    },
    {
      key: "info",
      heading: t("groupInfo"),
      items: [
        ["/about", t("about")],
        ["/guide", t("guide")],
        ["/directory", t("directory")],
        ["/impact", t("impact")],
        ["/accessibility", t("accessibility")],
        ["/notices", t("notices")],
      ],
    },
    {
      key: "legal",
      heading: t("groupLegal"),
      items: [
        ["/terms", t("terms")],
        ["/privacy", t("privacy")],
      ],
    },
  ];

  return (
    <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
      <h1 className="font-display text-3xl font-bold">{t("title")}</h1>
      <p className="mt-3 text-[var(--color-ink-soft)]">{t("desc")}</p>
      <div className="mt-8 grid gap-8 sm:grid-cols-2">
        {groups.map((g) => (
          <section key={g.key} aria-labelledby={`sitemap-${g.key}`}>
            <h2
              id={`sitemap-${g.key}`}
              className="font-display border-b-[1.5px] border-[var(--color-ink)] pb-2 text-lg font-bold"
            >
              {g.heading}
            </h2>
            <ul className="mt-3 space-y-2">
              {g.items.map(([href, label]) => (
                <li key={href}>
                  <Link
                    href={href}
                    className="font-medium underline underline-offset-4 hover:text-[var(--color-seal)]"
                  >
                    {label}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>

      {/* KWCAG 33항목 가이드 — 발견용 페이지의 핵심 콘텐츠 자산 */}
      <section aria-labelledby="sitemap-guide-items" className="mt-10">
        <h2
          id="sitemap-guide-items"
          className="font-display border-b-[1.5px] border-[var(--color-ink)] pb-2 text-lg font-bold"
        >
          {t("groupGuideItems")}
        </h2>
        <ul className="mt-3 grid gap-2 sm:grid-cols-2">
          {KWCAG_ITEMS.map((item) => (
            <li key={item.id}>
              <Link
                href={`/guide/${kwcagSlug(item)}`}
                className="font-medium underline underline-offset-4 hover:text-[var(--color-seal)]"
              >
                {item.id} {pickLocale(item.name, locale)}
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
