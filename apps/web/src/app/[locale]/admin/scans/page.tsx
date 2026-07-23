import { requireAdmin } from "@/lib/adminGuard";
import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { StatusBadge } from "@/components/StatusBadge";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "admin" });
  return { title: `${t("nav.scans")} — ${t("title")}` };
}

const STATUSES = ["queued", "running", "done", "failed"] as const;
type ScanStatus = (typeof STATUSES)[number];

/** 검사 로그 — 최근 50건, 상태 필터 */
export default async function AdminScansPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ status?: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requireAdmin(locale); // 병렬 렌더 누출 방지 — page 자체 가드 (layout 가드만으로는 불충분)
  const { status } = await searchParams;
  const t = await getTranslations("admin");
  const tDash = await getTranslations("dashboard");
  const format = await getFormatter();

  const filter = STATUSES.includes(status as ScanStatus) ? (status as ScanStatus) : undefined;

  const admin = createAdminClient();
  let query = admin
    .from("scans")
    .select("id, root_url, status, error, created_at, profiles(nickname)")
    .order("created_at", { ascending: false })
    .limit(50);
  if (filter) query = query.eq("status", filter);
  const { data: scans } = await query;

  return (
    <section aria-labelledby="admin-scans-heading" className="mt-8">
      <h2 id="admin-scans-heading" className="font-display text-2xl font-bold">
        {t("scans.title")}
      </h2>

      {/* 상태 필터 (GET 폼) */}
      <form method="get" className="mt-4 flex flex-wrap items-end gap-2">
        <div>
          <label htmlFor="scan-status" className="mb-1 block text-sm font-semibold">
            {t("scans.filterLabel")}
          </label>
          <select
            id="scan-status"
            name="status"
            defaultValue={filter ?? ""}
            className="rounded border-[1.5px] border-[var(--color-ink)] bg-[var(--color-paper)] px-3 py-2 text-sm"
          >
            <option value="">{t("scans.filterAll")}</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {tDash(`status.${s}`)}
              </option>
            ))}
          </select>
        </div>
        <button
          type="submit"
          className="rounded border-[1.5px] border-[var(--color-ink)] px-4 py-2 text-sm font-bold hover:bg-[var(--color-paper-warm)]"
        >
          {t("scans.filterApply")}
        </button>
      </form>

      <div className="mt-4 overflow-x-auto">
        <table className="w-full border-collapse border-y-[1.5px] border-[var(--color-ink)] text-sm">
          <caption className="sr-only">{t("scans.title")}</caption>
          <thead>
            <tr className="border-b-[1.5px] border-[var(--color-ink)] text-left">
              <th scope="col" className="py-2 pr-3 font-bold">{t("scans.colUser")}</th>
              <th scope="col" className="py-2 pr-3 font-bold">{t("scans.colUrl")}</th>
              <th scope="col" className="py-2 pr-3 font-bold">{t("scans.colStatus")}</th>
              <th scope="col" className="py-2 pr-3 font-bold">{t("scans.colDate")}</th>
              <th scope="col" className="py-2 font-bold">{t("scans.colError")}</th>
            </tr>
          </thead>
          <tbody>
            {(scans ?? []).map((s) => (
              <tr key={s.id} className="border-b border-[var(--color-line)]">
                <td className="whitespace-nowrap py-2 pr-3">
                  {(s.profiles as unknown as { nickname: string } | null)?.nickname}
                </td>
                <td className="max-w-64 truncate py-2 pr-3">{s.root_url}</td>
                <td className="py-2 pr-3">
                  <StatusBadge status={s.status} label={tDash(`status.${s.status as ScanStatus}`)} />
                </td>
                <td className="whitespace-nowrap py-2 pr-3 tabular-nums text-[var(--color-ink-faint)]">
                  {format.dateTime(new Date(s.created_at), { dateStyle: "short", timeStyle: "short" })}
                </td>
                <td className="max-w-56 truncate py-2 text-[var(--color-crit)]">{s.error}</td>
              </tr>
            ))}
            {(scans ?? []).length === 0 && (
              <tr>
                <td colSpan={5} className="py-4 text-sm text-[var(--color-ink-faint)]">
                  {t("dashboard.empty")}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
