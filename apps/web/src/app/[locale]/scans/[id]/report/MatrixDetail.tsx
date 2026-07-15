import { getTranslations } from "next-intl/server";
import {
  KWCAG_ITEMS,
  getRuleEntry,
  understandingUrl,
  type LocalizedText,
} from "@a11ychk/core/catalog";
import { GuideText } from "@/components/GuideText";

function pick(text: LocalizedText, locale: string): string {
  return locale === "en" && text.en ? text.en : text.ko;
}

/**
 * 매트릭스 행 인라인 상세 (화면 전용) — 스크롤 없이 그 자리에서 펼쳐 본다.
 * - fix: 위반 규칙별 개선 방법 (카탈로그 가이드)
 * - review: 자동 판정 불가 규칙의 확인 방법
 * - manual: 수동 검사 방법 (KWCAG howToTest + W3C Understanding 링크)
 */
export async function MatrixDetail({
  kind,
  ruleIds = [],
  scId,
  howToTest,
  locale,
}: {
  kind: "fix" | "review" | "manual";
  ruleIds?: string[];
  /** WCAG 행: Understanding 링크·KWCAG 검사방법 매핑에 사용 */
  scId?: string;
  /** KWCAG 행: 항목 자체의 검사 방법 */
  howToTest?: LocalizedText;
  locale: string;
}) {
  const t = await getTranslations("report.inline");
  const wUrl = scId ? understandingUrl(scId) : undefined;

  // manual(WCAG 행): 해당 SC에 매핑된 KWCAG 항목의 검사 방법을 모아 보여준다
  const manualItems =
    kind === "manual" && scId
      ? KWCAG_ITEMS.filter((i) => i.wcag.includes(scId) && i.howToTest)
      : [];

  const summaryLabel =
    kind === "fix"
      ? t("fixSummary", { count: ruleIds.length })
      : kind === "review"
        ? t("reviewSummary", { count: ruleIds.length })
        : t("manualSummary");

  return (
    <details className="no-print mt-1.5 font-normal">
      <summary className="cursor-pointer text-xs font-bold text-[var(--color-seal)] underline underline-offset-2">
        {summaryLabel}
      </summary>
      <div className="mt-2 max-w-2xl space-y-3 border-[1.5px] border-[var(--color-line)] bg-[var(--color-paper-warm)] p-3">
        {kind === "review" && <p className="text-xs text-[var(--color-ink-soft)]">{t("reviewIntro")}</p>}

        {(kind === "fix" || kind === "review") &&
          ruleIds.map((ruleId) => {
            const entry = getRuleEntry(ruleId);
            return (
              <div key={ruleId}>
                <h4 className="text-sm font-bold">{pick(entry.title, locale)}</h4>
                <div className="mt-1">
                  <GuideText text={pick(entry.guide, locale)} />
                </div>
              </div>
            );
          })}

        {kind === "manual" &&
          (howToTest ? (
            <p className="text-sm leading-relaxed">{pick(howToTest, locale)}</p>
          ) : manualItems.length > 0 ? (
            manualItems.map((item) => (
              <div key={item.id}>
                <h4 className="text-sm font-bold">
                  <span className="mr-1.5 tabular-nums text-[var(--color-ink-faint)]">KWCAG {item.id}</span>
                  {pick(item.name, locale)}
                </h4>
                <p className="mt-1 text-sm leading-relaxed">{item.howToTest ? pick(item.howToTest, locale) : ""}</p>
              </div>
            ))
          ) : (
            <p className="text-sm text-[var(--color-ink-soft)]">{t("manualFallback")}</p>
          ))}

        {wUrl && (
          <p className="text-xs">
            <a href={wUrl} rel="noopener" target="_blank" className="font-semibold text-[var(--color-seal)] underline underline-offset-2">
              {t("understanding")} ↗<span className="sr-only"> ({t("newWindow")})</span>
            </a>
          </p>
        )}
      </div>
    </details>
  );
}
