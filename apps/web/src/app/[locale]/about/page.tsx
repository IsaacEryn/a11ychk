import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "about" });
  return { title: t("title"), description: t("intro") };
}

export default async function AboutPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("about");

  const features = ["auto", "workbench", "extension", "badge", "schedule"] as const;

  return (
    <div className="mx-auto max-w-4xl px-4 py-12 sm:px-6">
      <h1 className="font-display text-4xl font-bold">{t("title")}</h1>
      <p className="mt-4 max-w-2xl text-lg leading-relaxed text-[var(--color-ink-soft)]">{t("intro")}</p>

      {/* 이름 이야기 — 한글 이름과 유래 */}
      <section aria-labelledby="name-heading" className="doc-card mt-12 p-6 sm:p-8">
        <h2 id="name-heading" className="font-display text-2xl font-bold">
          {t("name.title")}
        </h2>
        <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2">
          {/* 브랜드 마크 (brand/a11y-check-mark.svg) */}
          <svg aria-hidden="true" viewBox="0 0 64 64" className="h-10 w-10 shrink-0">
            <rect width="64" height="64" rx="14" fill="#0f1c2e" />
            <circle cx="10" cy="54" r="4.2" fill="#4d8dff" />
            <circle cx="20" cy="54" r="3.2" fill="#4d8dff" />
            <circle cx="30" cy="54" r="2.2" fill="#4d8dff" opacity="0.7" />
            <circle cx="40" cy="54" r="1.4" fill="#4d8dff" opacity="0.45" />
            <circle cx="10" cy="44" r="3.2" fill="#4d8dff" />
            <circle cx="20" cy="44" r="2.2" fill="#4d8dff" opacity="0.7" />
            <circle cx="30" cy="44" r="1.4" fill="#4d8dff" opacity="0.45" />
            <circle cx="10" cy="34" r="2.2" fill="#4d8dff" opacity="0.7" />
            <circle cx="20" cy="34" r="1.4" fill="#4d8dff" opacity="0.45" />
            <circle cx="10" cy="24" r="1.4" fill="#4d8dff" opacity="0.45" />
            <path d="M22 32 L31 41.5 L52 14" fill="none" stroke="#ffffff" strokeWidth="7" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <p className="font-display text-3xl font-extrabold tracking-tight">{t("name.korean")}</p>
          <p className="text-lg text-[var(--color-ink-faint)]">{t("name.english")}</p>
        </div>
        <p className="mt-4 max-w-2xl leading-relaxed text-[var(--color-ink-soft)]">{t("name.a11yDesc")}</p>
        <dl className="mt-5 grid gap-4 sm:grid-cols-2">
          <div className="border-l-[3px] border-[var(--color-seal)] pl-4">
            <dt className="font-bold">{t("name.part1Title")}</dt>
            <dd className="mt-1 text-sm leading-relaxed text-[var(--color-ink-soft)]">{t("name.part1Desc")}</dd>
          </div>
          <div className="border-l-[3px] border-[var(--color-seal)] pl-4">
            <dt className="font-bold">{t("name.part2Title")}</dt>
            <dd className="mt-1 text-sm leading-relaxed text-[var(--color-ink-soft)]">{t("name.part2Desc")}</dd>
          </div>
        </dl>
        <p className="mt-5 border-t border-dashed border-[var(--color-line)] pt-4 font-semibold">{t("name.slogan")}</p>
      </section>

      {/* 방법론 */}
      <section aria-labelledby="method-heading" className="mt-12">
        <h2 id="method-heading" className="font-display text-2xl font-bold">
          {t("methodTitle")}
        </h2>
        <p className="mt-3 leading-relaxed text-[var(--color-ink-soft)]">{t("methodDesc")}</p>
        <ul className="mt-4 grid gap-3 sm:grid-cols-3">
          {(["wcagem", "wcag", "kwcag"] as const).map((key) => (
            <li key={key} className="doc-card p-5">
              <h3 className="font-display text-lg font-bold text-[var(--color-seal)]">{t(`method.${key}.name`)}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-[var(--color-ink-soft)]">{t(`method.${key}.desc`)}</p>
            </li>
          ))}
        </ul>
      </section>

      {/* 기능 */}
      <section aria-labelledby="features-heading" className="mt-12">
        <h2 id="features-heading" className="font-display text-2xl font-bold">
          {t("featuresTitle")}
        </h2>
        <ul className="mt-4 space-y-3">
          {features.map((key) => (
            <li key={key} className="border-l-[3px] border-[var(--color-seal)] pl-4">
              <h3 className="font-bold">{t(`features.${key}.name`)}</h3>
              <p className="mt-0.5 text-sm leading-relaxed text-[var(--color-ink-soft)]">{t(`features.${key}.desc`)}</p>
            </li>
          ))}
        </ul>
      </section>

      {/* 정직성 + 오픈소스 */}
      <section className="mt-12 grid gap-5 md:grid-cols-2">
        <div className="border-[1.5px] border-[var(--color-ink)] bg-[var(--color-seal-tint)] p-6">
          <h2 className="font-display text-xl font-bold">{t("honestyTitle")}</h2>
          <p className="mt-2 text-sm leading-relaxed text-[var(--color-ink-soft)]">{t("honestyDesc")}</p>
        </div>
        <div className="border-[1.5px] border-[var(--color-ink)] bg-[var(--color-paper-warm)] p-6">
          <h2 className="font-display text-xl font-bold">{t("openTitle")}</h2>
          <p className="mt-2 text-sm leading-relaxed text-[var(--color-ink-soft)]">{t("openDesc")}</p>
          <a
            href="https://github.com/IsaacEryn/a11ychk"
            rel="noopener"
            className="mt-3 inline-block text-sm font-bold underline underline-offset-4"
          >
            github.com/IsaacEryn/a11ychk ↗
          </a>
        </div>
      </section>

      {/* CTA */}
      <section className="mt-12 flex flex-wrap items-center gap-3 border-t-[1.5px] border-[var(--color-ink)] pt-8">
        <Link
          href="/scan"
          className="rounded border-[1.5px] border-[var(--color-seal)] bg-[var(--color-seal)] px-6 py-2.5 font-bold text-[var(--color-paper)] shadow-[3px_3px_0_0_var(--color-line)] hover:bg-[var(--color-seal-deep)]"
        >
          {t("ctaScan")}
        </Link>
        <Link
          href="/inquiries"
          className="rounded border-[1.5px] border-[var(--color-ink)] px-5 py-2.5 font-semibold hover:bg-[var(--color-paper-warm)]"
        >
          {t("ctaContact")}
        </Link>
      </section>
    </div>
  );
}
