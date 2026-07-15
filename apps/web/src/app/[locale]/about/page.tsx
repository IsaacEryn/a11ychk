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
