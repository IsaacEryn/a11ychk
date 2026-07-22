import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";

/** 비소유자(배지·공유 링크 방문자) 전환 CTA — 화면 전용, 인쇄 제외 */
export async function ViewerCta() {
  const t = await getTranslations("report");
  return (
    <aside aria-label={t("viewerCta.title")} className="no-print doc-card mt-10 p-6">
      <p className="font-display text-lg font-bold">{t("viewerCta.title")}</p>
      <p className="mt-1.5 text-sm leading-relaxed text-[var(--color-ink-soft)]">{t("viewerCta.desc")}</p>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Link
          href="/"
          className="rounded border-[1.5px] border-[var(--color-seal)] bg-[var(--color-seal)] px-5 py-2.5 font-bold text-[var(--color-paper)] hover:bg-[var(--color-seal-deep)]"
        >
          {t("viewerCta.primary")}
        </Link>
        <Link href="/directory" className="font-semibold text-[var(--color-seal)] underline underline-offset-4">
          {t("viewerCta.secondary")}
        </Link>
      </div>
    </aside>
  );
}
