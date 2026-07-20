import { getTranslations } from "next-intl/server";

/** 라우트 전환 중 스켈레톤 — 큰 보고서 이동 시 흰 화면 대기를 방지한다. */
export default async function Loading() {
  const t = await getTranslations("errors");
  return (
    <div className="mx-auto max-w-4xl px-4 py-16 sm:px-6" aria-busy="true" aria-live="polite">
      <span className="sr-only">{t("loading")}</span>
      <div className="animate-pulse space-y-4" aria-hidden="true">
        <div className="h-8 w-2/3 rounded bg-[var(--color-line)]" />
        <div className="h-4 w-1/3 rounded bg-[var(--color-line)]" />
        <div className="mt-8 space-y-3">
          <div className="h-4 w-full rounded bg-[var(--color-line)]" />
          <div className="h-4 w-11/12 rounded bg-[var(--color-line)]" />
          <div className="h-4 w-5/6 rounded bg-[var(--color-line)]" />
        </div>
      </div>
    </div>
  );
}
