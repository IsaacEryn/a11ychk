import { getTranslations } from "next-intl/server";

/** 보고서 로딩 스켈레톤 — 첫 진입·재검증 동안 즉시 피드백을 준다. */
export default async function ReportLoading() {
  const t = await getTranslations("errors");
  return (
    <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6" aria-busy="true" aria-live="polite">
      <span className="sr-only">{t("loading")}</span>
      <div className="animate-pulse space-y-6" aria-hidden="true">
        <div className="flex justify-between gap-3">
          <div className="h-9 w-40 rounded bg-[var(--color-line)]" />
          <div className="h-9 w-52 rounded bg-[var(--color-line)]" />
        </div>
        <div className="h-40 rounded-lg bg-[var(--color-line)]" />
        <div className="grid gap-5 lg:grid-cols-2">
          <div className="h-52 rounded-lg bg-[var(--color-line)]" />
          <div className="h-52 rounded-lg bg-[var(--color-line)]" />
        </div>
        <div className="h-64 rounded-lg bg-[var(--color-line)]" />
      </div>
    </div>
  );
}
