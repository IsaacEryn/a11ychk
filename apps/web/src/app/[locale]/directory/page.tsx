import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { unstable_cache } from "next/cache";
import { Link } from "@/i18n/navigation";
import { collectListedSites } from "@/lib/directory";
import { localeAlternates } from "@/lib/seo/alternates";
import { JsonLd } from "@/components/JsonLd";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "directory" });
  return {
    alternates: localeAlternates(locale, "/directory"),
    title: t("title"),
    description: t("desc"),
  };
}

/** 공개 등재 사이트 목록 — 60초 캐시 (등재·검사 변경이 곧 반영되도록 짧게, opt-in 도메인만) */
const getListedSites = unstable_cache(collectListedSites, ["directory-sites"], { revalidate: 60 });

const GRADE_STYLE: Record<string, string> = {
  good: "bg-[var(--color-seal-tint)] text-[var(--color-pass)] border-[var(--color-seal)]",
  fair: "bg-[var(--color-warn-tint)] text-[var(--color-ink)] border-[var(--color-line)]",
  poor: "bg-[var(--color-crit-tint)] text-[var(--color-crit)] border-[var(--color-crit)]",
};

export default async function DirectoryPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("directory");
  const format = await getFormatter();
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.a11ychk.com";
  const sites = await getListedSites();

  return (
    <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6">
      {/* 등재 목록 구조화 데이터 — 상세 페이지(/directory/{host})를 항목으로 */}
      {sites.length > 0 && (
        <JsonLd
          data={{
            "@context": "https://schema.org",
            "@type": "ItemList",
            itemListElement: sites.map((s, i) => ({
              "@type": "ListItem",
              position: i + 1,
              name: s.siteName ?? s.hostname,
              url: `${siteUrl}/${locale}/directory/${encodeURIComponent(s.hostname)}`,
            })),
          }}
        />
      )}
      <p className="text-sm font-bold uppercase tracking-widest text-[var(--color-seal)]">{t("eyebrow")}</p>
      <h1 className="font-display mt-1 text-3xl font-bold">{t("title")}</h1>
      <p className="mt-2 max-w-2xl leading-relaxed text-[var(--color-ink-soft)]">{t("desc")}</p>
      <p className="mt-2 max-w-2xl text-sm text-[var(--color-ink-faint)]">{t("disclaimer")}</p>

      {sites.length === 0 ? (
        <p className="mt-8 border-[1.5px] border-dashed border-[var(--color-line)] p-6 text-center text-[var(--color-ink-faint)]">
          {t("empty")}
        </p>
      ) : (
        <ul className="mt-8 divide-y divide-[var(--color-line)] border-y-[1.5px] border-[var(--color-ink)]">
          {sites.map((s) => (
            <li key={s.hostname} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-4">
              <div className="min-w-0 flex-1">
                {s.siteName && <span className="block truncate font-bold">{s.siteName}</span>}
                <span className="block truncate text-sm text-[var(--color-ink-soft)]">{s.hostname}</span>
              </div>
              <span
                className={`rounded-full border-[1.5px] px-3 py-1 text-sm font-bold tabular-nums ${GRADE_STYLE[s.grade]}`}
              >
                {t("rate", { rate: s.rate })}
              </span>
              {s.lastScannedAt && (
                <time
                  dateTime={s.lastScannedAt}
                  className="w-full text-xs tabular-nums text-[var(--color-ink-faint)] sm:w-auto"
                >
                  {t("lastScanned", {
                    date: format.dateTime(new Date(s.lastScannedAt), { dateStyle: "medium" }),
                  })}
                </time>
              )}
              {/* 색인 가능한 사이트 요약 페이지로 — 전체 보고서 링크는 상세 안에 (크롤 막다른 길 해소) */}
              <Link
                href={`/directory/${encodeURIComponent(s.hostname)}`}
                className="inline-flex min-h-[44px] items-center text-sm font-bold text-[var(--color-seal)] underline underline-offset-4"
              >
                {t("viewDetail")}
              </Link>
            </li>
          ))}
        </ul>
      )}

      {/* 비로그인 방문자 전환 마찰 완화 — 로그인 게이트(dashboard) 대신 서비스 소개 랜딩으로 */}
      <p className="mt-8 text-sm text-[var(--color-ink-soft)]">
        {t("cta")}{" "}
        <Link href="/" className="font-bold text-[var(--color-seal)] underline underline-offset-4">
          {t("ctaLink")}
        </Link>
      </p>
    </div>
  );
}
