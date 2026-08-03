import { requireAdmin } from "@/lib/adminGuard";
import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { adminBase } from "@/lib/adminSlug";
import { escapeLike } from "@/lib/like";
import { errorKindKey, pathKindKey } from "@/lib/adminLogLabels";
import { Pager, PAGE_SIZE, parsePage } from "../../Pager";
import { FILTER_BTN, INPUT, TABLE, TH, TR, TR_HEAD } from "../../tableStyles";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "admin" });
  return { title: `${t("logs.tabs.errors")} — ${t("title")}` };
}

interface AppErrorRow {
  id: string;
  message: string;
  path: string | null;
  method: string | null;
  created_at: string;
}

/** 서버 오류 — 페이징 + 경로·메시지 검색 (90일 보존, migration 0008) */
export default async function AdminErrorLogsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ page?: string; path?: string; q?: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requireAdmin(locale); // 병렬 렌더 누출 방지 — page 자체 가드 (layout 가드만으로는 불충분)
  const sp = await searchParams;
  const t = await getTranslations("admin");
  const format = await getFormatter();

  const page = parsePage(sp.page);
  // 경로와 메시지는 필드를 분리 — .or()에 사용자 입력을 넣으면 PostgREST 파서가 깨질 수 있다
  const pathQ = (sp.path ?? "").trim();
  const q = (sp.q ?? "").trim();

  const admin = createAdminClient();
  let query = admin
    .from("app_errors")
    .select("id, message, path, method, created_at", { count: "exact" })
    .order("created_at", { ascending: false })
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
  if (pathQ) query = query.ilike("path", `%${escapeLike(pathQ)}%`);
  if (q) query = query.ilike("message", `%${escapeLike(q)}%`);
  const res = await query.then(
    (r) => r,
    () => ({ data: null, count: null, error: { message: "unavailable" } }),
  );

  const rows = (res.data ?? []) as unknown as AppErrorRow[];
  const total = res.count ?? 0;
  const filterQuery: Record<string, string> = {};
  if (pathQ) filterQuery.path = pathQ;
  if (q) filterQuery.q = q;

  return (
    <section aria-labelledby="admin-errors-heading" className="mt-5">
      <h3 id="admin-errors-heading" className="sr-only">
        {t("logs.errorsTitle")}
      </h3>

      {res.error != null && page === 1 && (
        <p className="mt-2 border-[1.5px] border-dashed border-[var(--color-line)] p-4 text-sm text-[var(--color-ink-soft)]">
          {t("logs.errorsNotMigrated")}
        </p>
      )}

      <form method="get" className="flex flex-wrap items-end gap-2">
        <div>
          <label htmlFor="error-path" className="mb-1 block text-sm font-semibold">
            {t("logs.pathSearch")}
          </label>
          <input id="error-path" type="search" name="path" defaultValue={pathQ} className={INPUT} />
        </div>
        <div>
          <label htmlFor="error-q" className="mb-1 block text-sm font-semibold">
            {t("logs.messageSearch")}
          </label>
          <input id="error-q" type="search" name="q" defaultValue={q} className={INPUT} />
        </div>
        <button type="submit" className={FILTER_BTN}>
          {t("logs.apply")}
        </button>
      </form>

      <div className="mt-4 overflow-x-auto">
        <table className={TABLE}>
          <caption className="sr-only">{t("logs.errorsTitle")}</caption>
          <thead>
            <tr className={TR_HEAD}>
              <th scope="col" className={TH}>{t("logs.colPath")}</th>
              <th scope="col" className={TH}>{t("logs.colMessage")}</th>
              <th scope="col" className="py-2 font-bold">{t("logs.colDate")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((e) => (
              <tr key={e.id} className={`${TR} align-top`}>
                <td className="max-w-56 py-2 pr-3">
                  <span className="font-semibold">{t(`logs.pathKind.${pathKindKey(e.path)}`)}</span>
                  <span className="mt-0.5 block break-all font-mono text-xs text-[var(--color-ink-faint)]">
                    {e.method} {e.path}
                  </span>
                </td>
                <td className="max-w-96 py-2 pr-3">
                  <span className="font-semibold text-[var(--color-crit)]">
                    {t(`logs.errorKind.${errorKindKey(e.message)}`)}
                  </span>
                  <span className="mt-0.5 line-clamp-2 block break-all font-mono text-xs text-[var(--color-ink-soft)]">
                    {e.message}
                  </span>
                </td>
                <td className="whitespace-nowrap py-2 tabular-nums text-[var(--color-ink-faint)]">
                  {format.dateTime(new Date(e.created_at), { dateStyle: "short", timeStyle: "short" })}
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={3} className="py-4 text-sm text-[var(--color-ink-faint)]">
                  {t("logs.errorsEmpty")}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <Pager pathname={`${adminBase()}/logs/errors`} query={filterQuery} page={page} total={total} />
    </section>
  );
}
