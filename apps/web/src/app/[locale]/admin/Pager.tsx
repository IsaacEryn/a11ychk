import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";

export const PAGE_SIZE = 50;

/** ?page= 값 정리 — 양의 정수가 아니면 1페이지 */
export function parsePage(raw: string | undefined): number {
  const n = Number(raw);
  return Number.isInteger(n) && n >= 1 ? n : 1;
}

/**
 * 관리자 목록 공용 페이저 — 이전/다음 + 현재 범위. 필터 searchParams를 보존한 채
 * page만 바꾼다(1페이지는 파라미터를 지워 URL을 짧게). 경계에서는 링크를 렌더하지
 * 않는다(비활성 링크보다 명확). total 0이면 아무것도 그리지 않는다.
 */
export async function Pager({
  pathname,
  query,
  page,
  total,
}: {
  /** adminBase() 반영 경로 (로케일 무접두 — next-intl Link가 로케일을 붙인다) */
  pathname: string;
  /** page를 제외한 현재 필터 파라미터 */
  query: Record<string, string>;
  page: number;
  total: number;
}) {
  const t = await getTranslations("admin.pager");
  if (total <= 0) return null;

  const lastPage = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const from = (page - 1) * PAGE_SIZE + 1;
  const to = Math.min(page * PAGE_SIZE, total);
  const href = (p: number) => ({
    pathname,
    query: p <= 1 ? query : { ...query, page: String(p) },
  });
  const linkCls =
    "rounded border-[1.5px] border-[var(--color-ink)] px-3 py-1.5 text-sm font-bold hover:bg-[var(--color-paper-warm)]";

  return (
    <nav aria-label={t("label")} className="mt-4 flex items-center gap-3">
      {page > 1 && (
        <Link rel="prev" href={href(page - 1)} className={linkCls}>
          {t("prev")}
        </Link>
      )}
      <span className="text-sm tabular-nums text-[var(--color-ink-soft)]">
        {t("range", { from, to, total })}
      </span>
      {page < lastPage && (
        <Link rel="next" href={href(page + 1)} className={linkCls}>
          {t("next")}
        </Link>
      )}
    </nav>
  );
}
