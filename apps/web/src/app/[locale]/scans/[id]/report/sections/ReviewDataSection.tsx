import { getTranslations } from "next-intl/server";
import type { PageSignature } from "@a11ychk/core/catalog";
import type { PageRow } from "../loadReport";

/**
 * 확인용 수집 자료 (signature.review) — 값은 존재하나 품질은 사람이 확증 (1.1.1·2.4.4·3.3.2 등).
 * view=all 전용 — 숨김은 CSS(data-only-all)가 담당해 토글 즉시 반영.
 */
export async function ReviewDataSection({ pages }: { pages: PageRow[] }) {
  // 값이 하나라도 있는 페이지만
  const reviewPages = (pages ?? [])
    .filter((p) => p.status === "done")
    .map((p) => ({ url: p.url as string, review: (p.signature as PageSignature | null)?.review }))
    .filter(
      (p): p is { url: string; review: NonNullable<PageSignature["review"]> } =>
        !!p.review && (p.review.alts.length > 0 || p.review.labels.length > 0 || p.review.genericLinks.length > 0),
    );
  if (reviewPages.length === 0) return null;
  const t = await getTranslations("report");
  return (
    <section data-only-all aria-labelledby="review-data-heading" className="print-break-before mt-12">
      <h2 id="review-data-heading" className="font-display text-2xl font-bold">
        {t("reviewData.title")}
      </h2>
      <p className="mt-1.5 text-sm text-[var(--color-ink-soft)]">{t("reviewData.desc")}</p>
      <div className="mt-4 space-y-3">
        {reviewPages.map(({ url, review }) => (
          <details key={url} className="border-[1.5px] border-[var(--color-line)] bg-[var(--color-paper-warm)]">
            <summary className="cursor-pointer break-all p-4 text-sm font-bold">{url}</summary>
            <div className="space-y-4 border-t border-dashed border-[var(--color-line)] p-4">
              {(
                [
                  ["alts", t("reviewData.alts"), t("reviewData.altsHint")],
                  ["labels", t("reviewData.labels"), t("reviewData.labelsHint")],
                  ["genericLinks", t("reviewData.genericLinks"), t("reviewData.genericLinksHint")],
                ] as const
              ).map(([key, label, hint]) =>
                review[key].length > 0 ? (
                  <div key={key}>
                    <h3 className="text-sm font-bold">{label}</h3>
                    <p className="mt-0.5 text-xs text-[var(--color-ink-faint)]">{hint}</p>
                    <ul className="mt-2 space-y-1">
                      {review[key].map((s, i) => (
                        <li key={i} className="flex flex-wrap items-baseline gap-x-3 text-sm">
                          <span className="font-semibold">“{s.text}”</span>
                          <code className="break-all font-mono text-xs text-[var(--color-ink-faint)]">{s.selector}</code>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null,
              )}
            </div>
          </details>
        ))}
      </div>
    </section>
  );
}
