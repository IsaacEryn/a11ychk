import { getTranslations } from "next-intl/server";
import { KWCAG_BY_ID } from "@a11ychk/core/catalog";
import type { CertReadiness } from "../certReadiness";

function pick(text: { ko: string; en?: string }, locale: string): string {
  return locale === "en" && text.en ? text.en : text.ko;
}

/** 인증 준비 요약 — 전문가 심사 합격선(평균 95%) 근사 (KWCAG 인증 기준 귀속) */
export async function CertSection({ locale, cert }: { locale: string; cert: CertReadiness }) {
  if (cert.averageRate == null) return null;
  const t = await getTranslations("report");
  return (
    <section aria-labelledby="cert-heading" className="blind-mask print-avoid-break mt-10 doc-card p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="cert-heading" className="font-display text-xl font-bold">
          {t("cert.title")}
        </h2>
        <span
          className={`rounded-full border-[1.5px] px-3 py-1 text-sm font-bold ${
            cert.band === "pass"
              ? "border-[var(--color-seal)] bg-[var(--color-seal-tint)] text-[var(--color-pass)]"
              : cert.band === "second"
                ? "border-[var(--color-line)] bg-[var(--color-warn-tint)] text-[var(--color-ink)]"
                : "border-[var(--color-crit)] bg-[var(--color-crit-tint)] text-[var(--color-crit)]"
          }`}
        >
          {t(`cert.band.${cert.band}`)}
        </span>
      </div>
      <div className="mt-3 flex items-end gap-3">
        <span className="font-display text-5xl font-extrabold tabular-nums">{cert.averageRate}</span>
        <span className="pb-1.5 text-sm text-[var(--color-ink-faint)]">
          % · {t("cert.evaluated", { evaluated: cert.evaluatedCount, total: cert.totalCount })}
        </span>
      </div>
      {cert.belowItems.length > 0 && (
        <div className="mt-4">
          <p className="text-sm font-bold">{t("cert.belowTitle", { count: cert.belowItems.length })}</p>
          <ul className="mt-2 flex flex-wrap gap-2">
            {cert.belowItems.map((b) => {
              const item = KWCAG_BY_ID.get(b.itemId);
              return (
                <li
                  key={b.itemId}
                  className="rounded border-[1.5px] border-[var(--color-crit)] bg-[var(--color-crit-tint)] px-2 py-1 text-xs font-semibold text-[var(--color-crit)]"
                >
                  {b.itemId} {item ? pick(item.name, locale) : ""} · {b.rate}%
                </li>
              );
            })}
          </ul>
        </div>
      )}
      <p className="mt-4 text-xs leading-relaxed text-[var(--color-ink-faint)]">{t("cert.note")}</p>
    </section>
  );
}
