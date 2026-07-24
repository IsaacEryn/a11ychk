import { getTranslations } from "next-intl/server";
import {
  WCAG_CRITERIA,
  getKwcagOnlyManualItems,
  getManualChecksByWcag,
  understandingUrl,
} from "@a11ychk/core/catalog";

function pick(text: { ko: string; en?: string }, locale: string): string {
  return locale === "en" && text.en ? text.en : text.ko;
}

/** A/AA 수준 배지 */
function LevelBadge({ level, aria }: { level: string; aria: string }) {
  return (
    <span
      aria-label={`${aria} ${level}`}
      className="ml-2 rounded-full border border-[var(--color-line)] px-1.5 py-0.5 align-middle text-[10px] font-bold text-[var(--color-ink-soft)]"
    >
      {level}
    </span>
  );
}

/**
 * 수동 검사 항목 — WCAG 성공기준 축(A/AA 표시), 검사 방법은 대응 KWCAG 항목(sources)에서.
 * 소유자 전용(점검 워크플로 안내). 공유·비소유자 뷰엔 미노출.
 */
export async function ManualSection({ locale }: { locale: string }) {
  const t = await getTranslations("report");
  const checks = getManualChecksByWcag();
  const covered = new Set(checks.map((c) => c.scId));
  // KWCAG 출처 가이드가 없는 나머지 A/AA SC — 목록에서 빠뜨리지 않되 Understanding 링크로 안내
  const noGuide = WCAG_CRITERIA.filter((c) => !covered.has(c.id));
  const kwcagOnly = getKwcagOnlyManualItems();

  return (
    <section data-only-all aria-labelledby="manual-heading" className="print-break-before mt-12">
      <h2 id="manual-heading" className="font-display text-2xl font-bold">
        {t("manual.title")}
      </h2>
      <p className="mt-1.5 text-sm text-[var(--color-ink-soft)]">{t("manual.desc")}</p>

      <ul className="mt-5 space-y-4">
        {checks.map((c) => (
          <li key={c.scId} className="print-avoid-break border-[1.5px] border-[var(--color-line)] bg-[var(--color-paper-warm)] p-5">
            <h3 className="font-bold">
              <span className="mr-2 tabular-nums text-[var(--color-ink-faint)]">{c.scId}</span>
              {pick(c.name, locale)}
              <LevelBadge level={c.level} aria={t("manual.levelAria")} />
            </h3>
            <p className="mt-1 text-xs text-[var(--color-ink-faint)]">
              {t("manual.kwcagRef")}: {c.sources.map((s) => `${s.kwcagId} ${pick(s.name, locale)}`).join(" · ")}
            </p>
            {c.sources.map(
              (s) =>
                s.howToTest && (
                  <p key={s.kwcagId} className="mt-2 text-sm leading-relaxed text-[var(--color-ink-soft)]">
                    <strong className="text-[var(--color-ink)]">
                      {t("manual.howToTest")}
                      {c.sources.length > 1 ? ` (${s.kwcagId})` : ""}:
                    </strong>{" "}
                    {pick(s.howToTest, locale)}
                  </p>
                ),
            )}
          </li>
        ))}
      </ul>

      {/* KWCAG 출처 가이드가 없는 SC — 자동 검사와 병행해 Understanding 문서로 확인 */}
      {noGuide.length > 0 && (
        <div className="mt-8">
          <h3 className="font-display text-lg font-bold">{t("manual.noGuideTitle")}</h3>
          <p className="mt-1 text-sm text-[var(--color-ink-soft)]">{t("manual.noGuideDesc")}</p>
          <ul className="mt-3 grid gap-2 sm:grid-cols-2">
            {noGuide.map((c) => {
              const url = understandingUrl(c.id);
              return (
                <li key={c.id} className="flex items-baseline gap-2 text-sm">
                  <span className="tabular-nums text-[var(--color-ink-faint)]">{c.id}</span>
                  <span className="min-w-0 flex-1">
                    {pick(c.name, locale)}
                    <LevelBadge level={c.level} aria={t("manual.levelAria")} />
                  </span>
                  {url && (
                    <a
                      href={url}
                      target="_blank"
                      rel="noreferrer"
                      className="whitespace-nowrap font-semibold text-[var(--color-seal)] underline underline-offset-4"
                    >
                      {t("manual.understanding")}
                    </a>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* KWCAG 고유 항목 — WCAG 대응이 없는 국내 기준 추가 항목 */}
      {kwcagOnly.length > 0 && (
        <div className="mt-8">
          <h3 className="font-display text-lg font-bold">{t("manual.kwcagOnlyTitle")}</h3>
          <ul className="mt-3 space-y-4">
            {kwcagOnly.map((item) => (
              <li key={item.id} className="print-avoid-break border-[1.5px] border-dashed border-[var(--color-line)] p-5">
                <h4 className="font-bold">
                  <span className="mr-2 tabular-nums text-[var(--color-ink-faint)]">{item.id}</span>
                  {pick(item.name, locale)}
                </h4>
                {item.howToTest && (
                  <p className="mt-2 text-sm leading-relaxed text-[var(--color-ink-soft)]">
                    <strong className="text-[var(--color-ink)]">{t("manual.howToTest")}:</strong>{" "}
                    {pick(item.howToTest, locale)}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
