import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";

export default async function LandingPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("landing");

  return (
    <div className="mx-auto max-w-6xl px-4 sm:px-6">
      {/* ─── Hero ─── */}
      <section className="grid gap-10 py-16 md:grid-cols-[1.2fr_1fr] md:items-center md:py-24">
        <div>
          <p className="rise rise-1 inline-block border-[1.5px] border-[var(--color-ink)] bg-[var(--color-paper-warm)] px-3 py-1 text-sm font-semibold tracking-wide">
            {t("heroEyebrow")}
          </p>
          <h1 className="rise rise-2 font-display mt-6 text-4xl font-extrabold leading-[1.25] sm:text-5xl sm:leading-[1.22]">
            {t("heroTitle1")}
            <br />
            <span className="marker px-1">{t("heroTitleMark")}</span> {t("heroTitle2")}
          </h1>
          <p className="rise rise-3 mt-6 max-w-xl text-lg text-[var(--color-ink-soft)]">{t("heroDesc")}</p>
          <div className="rise rise-4 mt-8 flex flex-wrap gap-3">
            <Link
              href="/dashboard"
              className="rounded border-[1.5px] border-[var(--color-seal)] bg-[var(--color-seal)] px-6 py-3 text-base font-bold text-[var(--color-paper)] shadow-[4px_4px_0_0_var(--color-line)] transition-transform hover:-translate-y-0.5 hover:bg-[var(--color-seal-deep)] hover:border-[var(--color-seal-deep)]"
            >
              {t("ctaPrimary")}
            </Link>
            <Link
              href="/guide"
              className="rounded border-[1.5px] border-[var(--color-ink)] px-6 py-3 text-base font-bold hover:bg-[var(--color-paper-warm)]"
            >
              {t("ctaSecondary")}
            </Link>
          </div>
        </div>

        {/* 보고서 미리보기 카드 (장식) */}
        <div aria-hidden="true" className="rise rise-4 doc-card hidden rotate-1 p-6 md:block">
          <div className="flex items-center justify-between border-b-[1.5px] border-[var(--color-ink)] pb-3">
            <span className="font-display text-sm font-bold">웹 접근성 점검 보고서</span>
            <span className="rounded-full border-[1.5px] border-[var(--color-seal)] px-2 py-0.5 text-xs font-bold text-[var(--color-seal)]">
              KWCAG 2.2
            </span>
          </div>
          <div className="mt-4 flex items-end gap-3">
            <span className="font-display text-6xl font-extrabold text-[var(--color-seal)]">87.5</span>
            <span className="pb-2 text-sm text-[var(--color-ink-faint)]">% 자동 검사 준수율</span>
          </div>
          <ul className="mt-5 space-y-2 text-sm">
            {[
              ["치명적", "2", "var(--color-crit)"],
              ["심각", "5", "var(--color-crit)"],
              ["보통", "11", "var(--color-ink-soft)"],
              ["수동 검사", "24", "var(--color-seal)"],
            ].map(([label, n, color]) => (
              <li key={label} className="flex items-center justify-between border-b border-dashed border-[var(--color-line)] pb-1.5">
                <span>{label}</span>
                <span className="font-bold" style={{ color }}>
                  {n}
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-4 text-xs text-[var(--color-ink-faint)]">a11ychk.com · axe-core 4.10</p>
        </div>
      </section>

      {/* ─── 기능 ─── */}
      <section aria-labelledby="features-heading" className="py-14">
        <h2 id="features-heading" className="font-display text-3xl font-bold">
          {t("featuresTitle")}
        </h2>
        <div className="mt-8 grid gap-5 sm:grid-cols-2">
          {(
            [
              ["autoTitle", "autoDesc", "M4 12l5 5L20 6"],
              ["kwcagTitle", "kwcagDesc", "M12 3v18M3 12h18"],
              ["reportTitle", "reportDesc", "M6 3h9l5 5v13H6zM14 3v6h6"],
              ["manualTitle", "manualDesc", "M12 5a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM12 9v4M12 16h.01"],
            ] as const
          ).map(([titleKey, descKey, path], i) => (
            <article key={titleKey} className={`doc-card p-6 ${i % 2 === 1 ? "sm:translate-y-4" : ""}`}>
              <svg
                aria-hidden="true"
                width="28"
                height="28"
                viewBox="0 0 24 24"
                fill="none"
                stroke="var(--color-seal)"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d={path} />
              </svg>
              <h3 className="font-display mt-3 text-xl font-bold">{t(`features.${titleKey}`)}</h3>
              <p className="mt-2 text-[var(--color-ink-soft)]">{t(`features.${descKey}`)}</p>
            </article>
          ))}
        </div>
      </section>

      {/* ─── 진행 순서 ─── */}
      <section aria-labelledby="how-heading" className="py-14">
        <h2 id="how-heading" className="font-display text-3xl font-bold">
          {t("howTitle")}
        </h2>
        <ol className="mt-8 grid gap-5 md:grid-cols-3">
          {([1, 2, 3] as const).map((n) => (
            <li key={n} className="relative border-l-[3px] border-[var(--color-seal)] pl-5">
              <span className="font-display text-5xl font-extrabold text-[var(--color-line)]" aria-hidden="true">
                {n.toString().padStart(2, "0")}
              </span>
              <h3 className="font-display mt-1 text-lg font-bold">{t(`how${n}Title`)}</h3>
              <p className="mt-1.5 text-[var(--color-ink-soft)]">{t(`how${n}Desc`)}</p>
            </li>
          ))}
        </ol>
      </section>

      {/* ─── 정직한 자동 검사 + 오픈소스 ─── */}
      <section className="grid gap-5 py-14 md:grid-cols-2">
        <div className="border-[1.5px] border-[var(--color-ink)] bg-[var(--color-seal-tint)] p-7">
          <h2 className="font-display text-2xl font-bold">{t("honestyTitle")}</h2>
          <p className="mt-3 text-[var(--color-ink-soft)]">{t("honestyDesc")}</p>
        </div>
        <div className="border-[1.5px] border-[var(--color-ink)] bg-[var(--color-paper-warm)] p-7">
          <h2 className="font-display text-2xl font-bold">{t("openSourceTitle")}</h2>
          <p className="mt-3 text-[var(--color-ink-soft)]">{t("openSourceDesc")}</p>
          <a
            href="https://github.com/isaaceryn/a11ychk"
            rel="noopener"
            className="mt-4 inline-block font-bold underline underline-offset-4"
          >
            github.com/isaaceryn/a11ychk ↗
          </a>
        </div>
      </section>
    </div>
  );
}
