import { getTranslations } from "next-intl/server";
import { getManualCheckItems } from "@a11ychk/core/catalog";

function pick(text: { ko: string; en?: string }, locale: string): string {
  return locale === "en" && text.en ? text.en : text.ko;
}

/** 수동 검사 항목 — 소유자 전용(점검 워크플로 안내). 공유·비소유자 뷰엔 미노출 */
export async function ManualSection({ locale }: { locale: string }) {
  const t = await getTranslations("report");
  const manualItems = getManualCheckItems();
  return (
    <section data-only-all aria-labelledby="manual-heading" className="print-break-before mt-12">
      <h2 id="manual-heading" className="font-display text-2xl font-bold">
        {t("manual.title")}
      </h2>
      <p className="mt-1.5 text-sm text-[var(--color-ink-soft)]">{t("manual.desc")}</p>
      <ul className="mt-5 space-y-4">
        {manualItems.map((item) => (
          <li key={item.id} className="print-avoid-break border-[1.5px] border-[var(--color-line)] bg-[var(--color-paper-warm)] p-5">
            <h3 className="font-bold">
              <span className="mr-2 tabular-nums text-[var(--color-ink-faint)]">{item.id}</span>
              {pick(item.name, locale)}
            </h3>
            {item.howToTest && (
              <p className="mt-2 text-sm leading-relaxed text-[var(--color-ink-soft)]">
                <strong className="text-[var(--color-ink)]">{t("manual.howToTest")}:</strong> {pick(item.howToTest, locale)}
              </p>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
