import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { unstable_cache } from "next/cache";
import { Link } from "@/i18n/navigation";
import { collectImpactStats } from "@/lib/impactStats";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "impact" });
  return { title: t("title"), description: t("desc") };
}

/** 공개 임팩트 지표 — 1시간 캐시 (집계는 lib/impactStats 공유) */
const getImpactStats = unstable_cache(collectImpactStats, ["impact-stats"], { revalidate: 3600 });

export default async function ImpactPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("impact");
  const format = await getFormatter();
  const stats = await getImpactStats();

  const n = (v: number) => format.number(v);

  const mainStats = [
    { label: t("stats.sites"), value: n(stats.sites) },
    { label: t("stats.scans"), value: n(stats.scans) },
    { label: t("stats.pages"), value: n(stats.pages) },
    { label: t("stats.findings"), value: n(stats.findings) },
  ];

  return (
    <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
      <p className="text-sm font-bold uppercase tracking-widest text-[var(--color-seal)]">{t("eyebrow")}</p>
      <h1 className="font-display mt-1 text-3xl font-bold">{t("title")}</h1>
      <p className="mt-2 max-w-2xl leading-relaxed text-[var(--color-ink-soft)]">{t("desc")}</p>

      {/* 누적 지표 */}
      <dl className="mt-8 grid grid-cols-2 gap-4 md:grid-cols-4">
        {mainStats.map((s) => (
          <div key={s.label} className="doc-card p-5">
            <dt className="text-sm font-semibold text-[var(--color-ink-soft)]">{s.label}</dt>
            <dd className="font-display mt-1 text-4xl font-extrabold tabular-nums text-[var(--color-seal)]">{s.value}</dd>
          </div>
        ))}
      </dl>

      {/* 개선 확인 */}
      <section aria-labelledby="improve-heading" className="doc-card mt-6 p-6">
        <h2 id="improve-heading" className="font-display text-xl font-bold">
          {t("improve.title")}
        </h2>
        <p className="mt-1.5 text-sm text-[var(--color-ink-soft)]">{t("improve.desc")}</p>
        <dl className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className="border-l-[3px] border-[var(--color-seal)] pl-3">
            <dt className="text-sm font-medium text-[var(--color-ink-soft)]">{t("improve.rescanned")}</dt>
            <dd className="font-display text-3xl font-extrabold tabular-nums">{n(stats.rescannedSites)}</dd>
          </div>
          <div className="border-l-[3px] border-[var(--color-seal)] pl-3">
            <dt className="text-sm font-medium text-[var(--color-ink-soft)]">{t("improve.improved")}</dt>
            <dd className="font-display text-3xl font-extrabold tabular-nums text-[var(--color-seal)]">
              {n(stats.improvedSites)}
            </dd>
          </div>
          <div className="border-l-[3px] border-[var(--color-seal)] pl-3">
            <dt className="text-sm font-medium text-[var(--color-ink-soft)]">{t("improve.avgGain")}</dt>
            <dd className="font-display text-3xl font-extrabold tabular-nums">
              {stats.improvedSites > 0 ? `+${stats.avgRateGain}%p` : "—"}
            </dd>
          </div>
        </dl>
      </section>

      {/* 활용 — 보고서가 실제 개선 작업으로 이어지는 지표 */}
      {(stats.sharedReports > 0 || stats.aiFixDownloads > 0) && (
        <section aria-labelledby="usage-heading" className="doc-card mt-6 p-6">
          <h2 id="usage-heading" className="font-display text-xl font-bold">
            {t("usage.title")}
          </h2>
          <p className="mt-1.5 text-sm text-[var(--color-ink-soft)]">{t("usage.desc")}</p>
          <dl className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="border-l-[3px] border-[var(--color-seal)] pl-3">
              <dt className="text-sm font-medium text-[var(--color-ink-soft)]">{t("usage.shared")}</dt>
              <dd className="font-display text-3xl font-extrabold tabular-nums">{n(stats.sharedReports)}</dd>
            </div>
            <div className="border-l-[3px] border-[var(--color-seal)] pl-3">
              <dt className="text-sm font-medium text-[var(--color-ink-soft)]">{t("usage.aiFix")}</dt>
              <dd className="font-display text-3xl font-extrabold tabular-nums">{n(stats.aiFixDownloads)}</dd>
            </div>
          </dl>
        </section>
      )}

      {/* 최근 30일 + 오픈소스 */}
      <div className="mt-6 grid gap-6 sm:grid-cols-2">
        <section aria-labelledby="recent-heading" className="doc-card p-6">
          <h2 id="recent-heading" className="font-display text-xl font-bold">
            {t("recent.title")}
          </h2>
          <p className="font-display mt-2 text-4xl font-extrabold tabular-nums text-[var(--color-seal)]">
            {n(stats.scans30d)}
          </p>
          <p className="mt-1 text-sm text-[var(--color-ink-soft)]">{t("recent.unit")}</p>
        </section>
        <section aria-labelledby="oss-heading" className="doc-card p-6">
          <h2 id="oss-heading" className="font-display text-xl font-bold">
            {t("oss.title")}
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-[var(--color-ink-soft)]">{t("oss.desc")}</p>
          <p className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-sm font-semibold">
            {stats.github && (
              <>
                <span>★ {n(stats.github.stars)} stars</span>
                <span>⑂ {n(stats.github.forks)} forks</span>
              </>
            )}
            <a
              href="https://github.com/IsaacEryn/a11ychk"
              className="text-[var(--color-seal)] underline underline-offset-4"
              rel="noopener"
            >
              {t("oss.link")}
            </a>
          </p>
          {stats.traffic && (
            <p className="mt-2 text-sm text-[var(--color-ink-soft)]">
              {t("oss.traffic", {
                views: n(stats.traffic.views),
                visitors: n(stats.traffic.uniqueViews),
                clones: n(stats.traffic.clones),
                since: format.dateTime(new Date(stats.traffic.since), { dateStyle: "medium" }),
              })}
            </p>
          )}
        </section>
      </div>

      {/* 방법론 각주 + CTA */}
      <p className="mt-6 text-xs leading-relaxed text-[var(--color-ink-faint)]">
        {t("note", { date: format.dateTime(new Date(stats.computedAt), { dateStyle: "medium", timeStyle: "short" }) })}
      </p>
      <p className="mt-6">
        <Link
          href="/scan"
          className="inline-block rounded border-[1.5px] border-[var(--color-seal)] bg-[var(--color-seal)] px-5 py-2.5 font-bold text-[var(--color-paper)] hover:bg-[var(--color-seal-deep)]"
        >
          {t("cta")}
        </Link>
      </p>
    </div>
  );
}
