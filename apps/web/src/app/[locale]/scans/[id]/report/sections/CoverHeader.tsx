import { getFormatter, getTranslations } from "next-intl/server";
import type { ReportMeta, ScanSummary } from "@a11ychk/core/catalog";

/** 표지/메타 — 보고서 제목·대상·일시·엔진 등 표지 정보 */
export async function CoverHeader({
  meta,
  rootUrl,
  finishedAt,
  createdAt,
  summary,
}: {
  meta: ReportMeta | null;
  rootUrl: string;
  finishedAt: string | null;
  createdAt: string;
  summary: ScanSummary;
}) {
  const t = await getTranslations("report");
  const format = await getFormatter();
  return (
    <header className="doc-card p-8">
      <p className="flex items-center gap-2 text-sm font-bold tracking-widest text-[var(--color-seal)]">
        {/* 브랜드 마크 (brand/a11y-check-mark.svg) — 인쇄물 표지에도 포함 */}
        <svg aria-hidden="true" viewBox="0 0 64 64" className="h-5 w-5 shrink-0">
          <rect width="64" height="64" rx="14" fill="#0f1c2e" />
          <circle cx="11" cy="53" r="5" fill="#4d8dff" />
          <circle cx="24" cy="53" r="3.5" fill="#4d8dff" opacity="0.8" />
          <circle cx="11" cy="40" r="3.5" fill="#4d8dff" opacity="0.8" />
          <path d="M20 34 L30 44 L52 15" fill="none" stroke="#ffffff" strokeWidth="9" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        A11y Check · a11ychk.com
      </p>
      <h1 className="font-display mt-2 text-3xl font-extrabold sm:text-4xl">{meta?.title || t("docTitle")}</h1>
      <dl className="mt-6 grid gap-x-8 gap-y-2 text-sm sm:grid-cols-2">
        {meta?.siteName && (
          <div className="flex gap-2">
            <dt className="shrink-0 font-bold">{t("meta.siteName")}</dt>
            <dd>{meta.siteName}</dd>
          </div>
        )}
        {meta?.evaluatorName && (
          <div className="flex gap-2">
            <dt className="shrink-0 font-bold">{t("meta.evaluator")}</dt>
            <dd>{meta.evaluatorName}</dd>
          </div>
        )}
        {meta?.organization && (
          <div className="flex gap-2">
            <dt className="shrink-0 font-bold">{t("meta.organization")}</dt>
            <dd>{meta.organization}</dd>
          </div>
        )}
        <div className="flex gap-2">
          <dt className="shrink-0 font-bold">{t("meta.url")}</dt>
          <dd className="break-all">{rootUrl}</dd>
        </div>
        <div className="flex gap-2">
          <dt className="shrink-0 font-bold">{t("meta.date")}</dt>
          <dd>
            {format.dateTime(new Date(finishedAt ?? createdAt), { dateStyle: "long", timeStyle: "short" })}
          </dd>
        </div>
        <div className="flex gap-2">
          <dt className="shrink-0 font-bold">{t("meta.pages")}</dt>
          <dd>{t("meta.pagesUnit", { count: summary.scannedPageCount })}</dd>
        </div>
        <div className="flex gap-2">
          <dt className="shrink-0 font-bold">{t("meta.engine")}</dt>
          <dd>
            {summary.engine.name} v{summary.engine.axeVersion} · WCAG 2.2 · KWCAG 2.2
          </dd>
        </div>
      </dl>
    </header>
  );
}
