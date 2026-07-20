import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";

export default async function LandingPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("landing");

  // 검색엔진 구조화 데이터 — 정적 값만 사용(사용자 입력 없음)
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "WebApplication",
    name: "A11y Check",
    url: "https://www.a11ychk.com",
    applicationCategory: "DeveloperApplication",
    operatingSystem: "Web",
    description:
      locale === "en"
        ? "Automated web accessibility audit reports based on WCAG 2.2 and KWCAG 2.2"
        : "WCAG 2.2 + KWCAG 2.2 기준 웹 접근성 자동 점검 보고서·개선 가이드",
    offers: { "@type": "Offer", price: "0", priceCurrency: "KRW" },
    inLanguage: ["ko", "en"],
  };

  return (
    <div className="mx-auto max-w-6xl px-4 sm:px-6">
      <script
        type="application/ld+json"
        // 정적 JSON-LD (표준 패턴) — 사용자 입력이 섞이지 않는 리터럴만 직렬화
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
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
          {/* 실제 예시 보고서 — 공유 링크가 설정된 경우에만 노출.
              자사 사이트(a11ychk.com) 자체 검사 결과 = 접근성 선언문의 자체 점검 실증 */}
          {process.env.NEXT_PUBLIC_DEMO_REPORT_URL && (
            <p className="rise rise-4 mt-4">
              <a
                href={process.env.NEXT_PUBLIC_DEMO_REPORT_URL}
                className="text-base font-semibold text-[var(--color-seal)] underline underline-offset-4 hover:text-[var(--color-seal-deep)]"
              >
                {t("ctaDemoReport")} →
              </a>
            </p>
          )}
        </div>

        {/* 보고서 미리보기 (예시임을 명확히 표시) */}
        <div className="hidden md:block">
          <div aria-hidden="true" className="rise rise-4 doc-card relative rotate-1 overflow-hidden p-6">
            {/* 대각선 SAMPLE 워터마크 — 순수 장식이라 SVG로 렌더 (HTML 텍스트로 두면
                의도적 저대비가 명도 대비 검사에 걸린다. 보이는 안내는 배지·캡션이 담당) */}
            <svg
              aria-hidden="true"
              className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 -rotate-[24deg] select-none text-[var(--color-ink)] opacity-[0.07]"
              width="380"
              height="80"
              viewBox="0 0 380 80"
            >
              <text
                x="50%"
                y="50%"
                textAnchor="middle"
                dominantBaseline="central"
                fill="currentColor"
                style={{ font: "800 60px var(--font-display)", letterSpacing: "0.2em" }}
              >
                SAMPLE
              </text>
            </svg>
            <span className="absolute right-3 top-3 rounded-sm bg-[var(--color-mark)] px-2 py-0.5 text-xs font-extrabold text-[var(--color-ink-on-mark)]">
              {t("demo.sampleBadge")}
            </span>
          <div className="flex items-center justify-between border-b-[1.5px] border-[var(--color-ink)] pb-3 pr-14">
            <span className="font-display text-sm font-bold">{t("demo.title")}</span>
            <span className="rounded-full border-[1.5px] border-[var(--color-seal)] px-2 py-0.5 text-xs font-bold text-[var(--color-seal)]">
              KWCAG 2.2
            </span>
          </div>
          <div className="mt-4 flex items-end gap-3">
            <span className="font-display text-6xl font-extrabold text-[var(--color-seal)]">87.5</span>
            <span className="pb-2 text-sm text-[var(--color-ink-faint)]">{t("demo.rate")}</span>
          </div>
          <ul className="mt-5 space-y-2 text-sm">
            {[
              [t("demo.critical"), "2", "var(--color-crit)"],
              [t("demo.serious"), "5", "var(--color-crit)"],
              [t("demo.moderate"), "11", "var(--color-ink-soft)"],
              [t("demo.manual"), "24", "var(--color-seal)"],
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
          {/* 예시 캡션 (보이는 텍스트 — 실제 결과로 오인 방지) */}
          <p className="rise rise-4 mt-4 text-center text-sm text-[var(--color-ink-faint)]">{t("demo.sampleCaption")}</p>
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
              <span className="font-display text-5xl font-extrabold text-[var(--color-deco)]" aria-hidden="true">
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
