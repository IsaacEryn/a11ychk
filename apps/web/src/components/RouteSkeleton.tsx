import { getTranslations } from "next-intl/server";

/**
 * 라우트 전환 중 스켈레톤 — 큰 보고서·대시보드로 이동할 때 흰 화면 대기를 없앤다.
 *
 * 이걸 쓰는 loading.tsx는 **느린 세그먼트에만** 두어야 한다. [locale] 바로 아래에 두면
 * 그 아래 전부가 Suspense 경계 안으로 들어가고, 셸이 200으로 먼저 나간 뒤에야 본문이
 * 렌더된다. 그러면 없는 주소에서 notFound()를 던져도 상태 코드를 바꿀 수 없어
 * 200 + 404 화면(soft 404)이 되고, 검색엔진이 오타 URL까지 크롤링한다.
 */
export async function RouteSkeleton() {
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
