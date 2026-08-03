import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { unstable_cache } from "next/cache";
import { KWCAG_ITEMS, kwcagSlug, pickLocale } from "@a11ychk/core/catalog";
import { Link } from "@/i18n/navigation";
import { getListedSiteDetail } from "@/lib/directory";
import { localeAlternates } from "@/lib/seo/alternates";
import { JsonLd, breadcrumbJsonLd } from "@/components/JsonLd";

/**
 * 공개 디렉터리 사이트 요약 — 등재 사이트당 하나씩 생기는 색인 가능한 착지면.
 * 기존 /site/{host} 리졸버는 보고서(비색인)로 302라 크롤 막다른 길이었다.
 * 상세는 준수율·등급·점검일과 위반 항목의 개선 가이드 연결을 담는다.
 */

const getDetail = unstable_cache(getListedSiteDetail, ["directory-site-detail"], { revalidate: 60 });

/** 깨진 퍼센트 인코딩(%zz)이 오면 decodeURIComponent가 throw — 500 대신 404로 */
function safeDecode(raw: string): string | null {
  try {
    return decodeURIComponent(raw);
  } catch {
    return null;
  }
}

export async function generateMetadata({ params }: { params: Promise<{ locale: string; hostname: string }> }) {
  const { locale, hostname: raw } = await params;
  const hostname = safeDecode(raw);
  const detail = hostname ? await getDetail(hostname) : null;
  if (!detail || !hostname) return {};
  const t = await getTranslations({ locale, namespace: "directory" });
  return {
    alternates: localeAlternates(locale, `/directory/${encodeURIComponent(hostname)}`),
    title: t("detail.metaTitle", { name: detail.siteName ?? detail.hostname }),
    description: t("detail.metaDescription", { name: detail.siteName ?? detail.hostname, rate: detail.rate }),
  };
}

export default async function DirectorySitePage({
  params,
}: {
  params: Promise<{ locale: string; hostname: string }>;
}) {
  const { locale, hostname: raw } = await params;
  setRequestLocale(locale);
  const hostname = safeDecode(raw);
  const detail = hostname ? await getDetail(hostname) : null;
  // 미등재·소유 미확인·임계 미만·깨진 인코딩 — 목록과 같은 기준으로 404
  if (!detail) notFound();

  const t = await getTranslations("directory");
  const format = await getFormatter();
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.a11ychk.com";

  // 위반이 걸린 KWCAG 항목 → 개선 가이드 내부 링크 (상위 5개)
  const failedItems = detail.failedItemIds
    .map((id) => KWCAG_ITEMS.find((it) => it.id === id))
    .filter((it): it is (typeof KWCAG_ITEMS)[number] => !!it)
    .slice(0, 5);

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
      <JsonLd
        data={breadcrumbJsonLd([
          { name: t("title"), url: `/${locale}/directory` },
          { name: detail.hostname, url: `/${locale}/directory/${encodeURIComponent(detail.hostname)}` },
        ])}
      />
      <nav aria-label={t("detail.breadcrumb")} className="text-sm">
        <Link href="/directory" className="font-semibold text-[var(--color-seal)] underline underline-offset-4">
          ← {t("title")}
        </Link>
      </nav>

      <h1 className="font-display mt-4 text-3xl font-bold break-all">
        {detail.siteName ?? detail.hostname}
      </h1>
      {detail.siteName && <p className="mt-1 break-all text-[var(--color-ink-soft)]">{detail.hostname}</p>}

      <div className="doc-card mt-6 p-6">
        <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
          <div>
            <p className="text-sm font-bold text-[var(--color-ink-soft)]">{t("detail.rateLabel")}</p>
            <p className="font-display mt-1 text-5xl font-extrabold leading-none text-[var(--color-seal)] tabular-nums">
              {detail.rate}
              <span className="text-xl">%</span>
            </p>
          </div>
          <dl className="space-y-1 text-sm text-[var(--color-ink-soft)]">
            {detail.lastScannedAt && (
              <div className="flex gap-2">
                <dt className="font-semibold">{t("detail.scannedAt")}</dt>
                <dd>
                  <time dateTime={detail.lastScannedAt}>
                    {format.dateTime(new Date(detail.lastScannedAt), { dateStyle: "medium" })}
                  </time>
                </dd>
              </div>
            )}
            {detail.scannedPages !== null && (
              <div className="flex gap-2">
                <dt className="font-semibold">{t("detail.pages")}</dt>
                <dd className="tabular-nums">{detail.scannedPages}</dd>
              </div>
            )}
            <div className="flex gap-2">
              <dt className="font-semibold">{t("detail.violations")}</dt>
              <dd className="tabular-nums">{detail.totalViolations}</dd>
            </div>
          </dl>
        </div>
        <p className="mt-4 text-xs leading-relaxed text-[var(--color-ink-faint)]">{t("disclaimer")}</p>
      </div>

      {failedItems.length > 0 && (
        <section aria-labelledby="dir-items-heading" className="mt-8">
          <h2 id="dir-items-heading" className="font-display text-xl font-bold">
            {t("detail.itemsTitle")}
          </h2>
          <p className="mt-1 text-sm text-[var(--color-ink-soft)]">{t("detail.itemsDesc")}</p>
          <ul className="mt-3 space-y-2">
            {failedItems.map((item) => (
              <li key={item.id}>
                <Link
                  href={`/guide/${kwcagSlug(item)}`}
                  className="font-semibold text-[var(--color-seal)] underline underline-offset-4"
                >
                  {item.id} {pickLocale(item.name, locale)}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="mt-8 flex flex-wrap items-center gap-4">
        {/* 전체 보고서 — 비색인 영역이라 크롤러에게는 따라가지 말라고 알린다 */}
        <a
          href={`${siteUrl}/site/${encodeURIComponent(detail.hostname)}`}
          rel="nofollow"
          className="rounded border-[1.5px] border-[var(--color-ink)] px-5 py-2.5 font-semibold hover:bg-[var(--color-paper-warm)]"
        >
          {t("viewReport")}
        </a>
        <Link
          href="/"
          className="rounded border-[1.5px] border-[var(--color-seal)] bg-[var(--color-seal)] px-5 py-2.5 font-bold text-[var(--color-paper)] hover:bg-[var(--color-seal-deep)]"
        >
          {t("detail.scanCta")}
        </Link>
      </div>
    </div>
  );
}
