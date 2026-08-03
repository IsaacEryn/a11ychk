import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import {
  KWCAG_BY_SLUG,
  KWCAG_ITEMS,
  KWCAG_PRINCIPLE_LABEL,
  RULE_CATALOG,
  WCAG_BY_ID,
  kwcagSlug,
  pickLocale as pick,
  understandingUrl,
} from "@a11ychk/core/catalog";
import { Link } from "@/i18n/navigation";
import { GuideText } from "@/components/GuideText";
import { localeAlternates } from "@/lib/seo/alternates";
import { JsonLd, breadcrumbJsonLd, howToJsonLd } from "@/components/JsonLd";

export function generateStaticParams() {
  return KWCAG_ITEMS.map((item) => ({ slug: kwcagSlug(item) }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}) {
  const { locale, slug } = await params;
  const item = KWCAG_BY_SLUG.get(slug);
  if (!item) return {};
  const t = await getTranslations({ locale, namespace: "guideItem" });
  const name = pick(item.name, locale);
  // 항목 고유 문장(검사 방법 첫 문장)을 앞세워 33개 준-중복 description을 차별화 —
  // 템플릿만으로는 검색엔진이 자체 생성 스니펫으로 대체해 버린다
  const unique = item.howToTest ? pick(item.howToTest, locale).split(/(?<=[.다])\s/)[0]?.slice(0, 110) : null;
  const base = t("metaDescription", { id: item.id, name, wcag: item.wcag.join(", ") });
  return {
    alternates: localeAlternates(locale, `/guide/${slug}`),
    // layout의 "%s — A11y Check" 템플릿을 태우면 제목이 검색 결과에서 잘릴 만큼 길어진다
    title: { absolute: t("metaTitle", { id: item.id, name }) },
    description: unique ? `${unique} ${base}`.slice(0, 300) : base,
  };
}

/**
 * KWCAG 검사항목 하나를 다루는 상세 페이지.
 *
 * 33개 항목이 /guide 한 장에 다 들어가 있어서, "대체 텍스트 검사 방법"처럼
 * 항목 단위로 찾아오는 사람이 착지할 자리가 없었다. 카탈로그에 이미 있는
 * 데이터(검사 방법·대응 성공기준·이 항목을 판정하는 규칙)를 항목마다 펼친다.
 */
export default async function GuideItemPage({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}) {
  const { locale, slug } = await params;
  setRequestLocale(locale);
  const item = KWCAG_BY_SLUG.get(slug);
  if (!item) notFound();

  const t = await getTranslations("guideItem");
  const name = pick(item.name, locale);
  const howToTest = item.howToTest ? pick(item.howToTest, locale) : null;
  // 이 항목을 자동으로 판정하는 규칙들 — 카탈로그 역방향 조회
  const rules = RULE_CATALOG.filter((r) => r.kwcag.includes(item.id));
  const principle = KWCAG_PRINCIPLE_LABEL[item.principle][locale === "en" ? "en" : "ko"];

  // 앞뒤 항목 — 33개를 순서대로 훑어볼 수 있게
  const idx = KWCAG_ITEMS.findIndex((i) => i.id === item.id);
  const prev = idx > 0 ? KWCAG_ITEMS[idx - 1] : null;
  const next = idx < KWCAG_ITEMS.length - 1 ? KWCAG_ITEMS[idx + 1] : null;

  // 관련 항목 — 같은 원칙 + 같은 WCAG SC 공유 + 같은 자동 규칙 공유 (토픽 클러스터 상호 링크)
  const relatedIds = new Set<string>();
  for (const other of KWCAG_ITEMS) {
    if (other.id === item.id) continue;
    const samePrinciple = other.principle === item.principle;
    const sharedSc = other.wcag.some((sc) => item.wcag.includes(sc));
    const sharedRule = rules.some((r) => r.kwcag.includes(other.id));
    if (sharedSc || sharedRule || samePrinciple) {
      // 강한 연관(SC·규칙 공유)을 먼저 채우고, 같은 원칙은 자리가 남을 때만
      if (sharedSc || sharedRule) relatedIds.add(other.id);
      else if (relatedIds.size < 4) relatedIds.add(other.id);
    }
    if (relatedIds.size >= 6) break;
  }
  const related = [...relatedIds]
    .map((id) => KWCAG_ITEMS.find((i) => i.id === id)!)
    .filter((i) => i.id !== prev?.id && i.id !== next?.id)
    .slice(0, 4);

  return (
    <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
      <JsonLd
        data={breadcrumbJsonLd([
          { name: t("breadcrumbGuide"), url: `/${locale}/guide` },
          { name: `${item.id} ${name}`, url: `/${locale}/guide/${slug}` },
        ])}
      />
      {howToTest && (
        <JsonLd data={howToJsonLd(t("h1", { name }), howToTest, `/${locale}/guide/${slug}`)} />
      )}

      <nav aria-label={t("breadcrumbLabel")} className="text-sm text-[var(--color-ink-soft)]">
        <Link href="/guide" className="underline underline-offset-4">
          {t("breadcrumbGuide")}
        </Link>
        <span className="mx-2" aria-hidden="true">
          /
        </span>
        <span>{principle}</span>
      </nav>

      <p className="mt-6 inline-block border-[1.5px] border-[var(--color-ink)] bg-[var(--color-paper-warm)] px-3 py-1 text-sm font-semibold">
        KWCAG 2.2 · {item.id}
        {item.addedIn22 && <span className="ml-2 text-[var(--color-seal)]">{t("new22")}</span>}
      </p>
      <h1 className="font-display mt-4 text-3xl font-bold leading-tight sm:text-4xl">
        {t("h1", { name })}
      </h1>
      <p className="mt-4 text-lg leading-relaxed text-[var(--color-ink-soft)]">
        {t("lead", { name, coverage: t(`coverage.${item.autoCoverage}`) })}
      </p>

      {/* 대응 기준 */}
      <section aria-labelledby="mapping-heading" className="mt-10">
        <h2 id="mapping-heading" className="font-display text-2xl font-bold">
          {t("mappingTitle")}
        </h2>
        <dl className="mt-4 grid gap-3 sm:grid-cols-2">
          <div className="doc-card p-5">
            <dt className="text-sm font-bold text-[var(--color-ink-soft)]">{t("kwcagLabel")}</dt>
            <dd className="mt-1 font-bold">
              {item.id} {name}
            </dd>
            <dd className="mt-1 text-sm text-[var(--color-ink-soft)]">{principle}</dd>
          </div>
          <div className="doc-card p-5">
            <dt className="text-sm font-bold text-[var(--color-ink-soft)]">{t("wcagLabel")}</dt>
            <dd className="mt-1 space-y-1">
              {item.wcag.map((scId) => {
                const c = WCAG_BY_ID.get(scId);
                const url = understandingUrl(scId);
                const label = c ? `${scId} ${pick(c.name, locale)} (${c.level})` : scId;
                return (
                  <span key={scId} className="block">
                    {url ? (
                      <a href={url} rel="noopener" className="underline underline-offset-4">
                        {label} ↗
                      </a>
                    ) : (
                      label
                    )}
                  </span>
                );
              })}
            </dd>
          </div>
        </dl>
      </section>

      {/* 검사 방법 */}
      {howToTest && (
        <section aria-labelledby="howto-heading" className="mt-10">
          <h2 id="howto-heading" className="font-display text-2xl font-bold">
            {t("howToTitle")}
          </h2>
          <p className="mt-4 leading-relaxed">{howToTest}</p>
        </section>
      )}

      {/* 이 항목을 자동으로 잡아내는 규칙 */}
      <section aria-labelledby="rules-heading" className="mt-10">
        <h2 id="rules-heading" className="font-display text-2xl font-bold">
          {t("rulesTitle")}
        </h2>
        {rules.length === 0 ? (
          <p className="mt-4 leading-relaxed text-[var(--color-ink-soft)]">{t("rulesEmpty")}</p>
        ) : (
          <>
            <p className="mt-3 text-sm text-[var(--color-ink-soft)]">
              {t("rulesIntro", { count: rules.length })}
            </p>
            <ul className="mt-4 space-y-4">
              {rules.map((rule) => (
                <li key={rule.ruleId} className="border-l-[3px] border-[var(--color-seal)] pl-4">
                  <h3 className="font-bold">
                    {pick(rule.title, locale)}{" "}
                    <code className="text-sm font-normal text-[var(--color-ink-soft)]">
                      {rule.ruleId}
                    </code>
                  </h3>
                  {/* 가이드는 경량 마크다운(코드 블록·인라인 코드·굵게) — 보고서와 같은
                      렌더러를 쓴다. 텍스트 노드로만 출력하므로 HTML 주입 위험이 없다. */}
                  <div className="mt-1.5 text-[var(--color-ink-soft)]">
                    <GuideText text={pick(rule.guide, locale)} />
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      {/* 이 페이지를 검사로 이어 주는 자리 */}
      <section aria-labelledby="cta-heading" className="mt-12 border-[1.5px] border-[var(--color-ink)] bg-[var(--color-seal-tint)] p-7">
        <h2 id="cta-heading" className="font-display text-xl font-bold">
          {t("ctaTitle")}
        </h2>
        <p className="mt-2 leading-relaxed text-[var(--color-ink-soft)]">{t("ctaDesc")}</p>
        {/* 랜딩 상단이 아니라 맛보기 폼으로 직행 — 검색 유입의 이탈을 줄인다 */}
        <Link
          href="/#teaser"
          className="mt-4 inline-block rounded border-[1.5px] border-[var(--color-seal)] bg-[var(--color-seal)] px-5 py-2.5 font-bold text-[var(--color-paper)] hover:bg-[var(--color-seal-deep)] hover:border-[var(--color-seal-deep)]"
        >
          {t("ctaButton")}
        </Link>
      </section>

      {/* 관련 항목 — 같은 성공기준·규칙·원칙으로 묶이는 항목 상호 링크 */}
      {related.length > 0 && (
        <section aria-labelledby="related-heading" className="mt-10">
          <h2 id="related-heading" className="font-display text-lg font-bold">
            {t("relatedTitle")}
          </h2>
          <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-sm">
            {related.map((r) => (
              <li key={r.id}>
                <Link href={`/guide/${kwcagSlug(r)}`} className="font-semibold underline underline-offset-4 hover:text-[var(--color-seal)]">
                  {r.id} {pick(r.name, locale)}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* 앞뒤 항목 */}
      <nav aria-label={t("siblingLabel")} className="mt-10 flex flex-wrap justify-between gap-4 border-t-[1.5px] border-[var(--color-line)] pt-6">
        {prev ? (
          <Link href={`/guide/${kwcagSlug(prev)}`} className="max-w-[45%] underline underline-offset-4">
            ← {prev.id} {pick(prev.name, locale)}
          </Link>
        ) : (
          <span />
        )}
        {next && (
          <Link href={`/guide/${kwcagSlug(next)}`} className="max-w-[45%] text-right underline underline-offset-4">
            {next.id} {pick(next.name, locale)} →
          </Link>
        )}
      </nav>
    </div>
  );
}
