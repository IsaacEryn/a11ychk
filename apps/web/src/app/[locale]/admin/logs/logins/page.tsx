import { requireAdmin } from "@/lib/adminGuard";
import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { adminBase } from "@/lib/adminSlug";
import { escapeLike } from "@/lib/like";
import { Pager, PAGE_SIZE, parsePage } from "../../Pager";
import { FILTER_BTN, INPUT, TABLE, TH, TR, TR_HEAD } from "../../tableStyles";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "admin" });
  return { title: `${t("logs.tabs.logins")} — ${t("title")}` };
}

const OUTCOMES = ["success", "mfa_failed"] as const;

interface LoginLogRow {
  id: string;
  email: string | null;
  provider: string | null;
  ip: string | null;
  /** 0031 — 'success' | 'mfa_failed' (미적용 환경은 undefined) */
  outcome?: string | null;
  created_at: string;
  profiles: { nickname: string } | null;
}

/** 로그인 기록 — 페이징 + 이메일 검색 + 결과 필터 (90일 보존, migration 0006) */
export default async function AdminLoginLogsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ page?: string; q?: string; outcome?: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requireAdmin(locale); // 병렬 렌더 누출 방지 — page 자체 가드 (layout 가드만으로는 불충분)
  const sp = await searchParams;
  const t = await getTranslations("admin");
  const format = await getFormatter();

  const page = parsePage(sp.page);
  const q = (sp.q ?? "").trim();
  const outcome = OUTCOMES.includes(sp.outcome as (typeof OUTCOMES)[number]) ? sp.outcome : undefined;

  const admin = createAdminClient();
  let query = admin
    .from("login_logs")
    .select("id, email, provider, ip, outcome, created_at, profiles(nickname)", { count: "exact" })
    .order("created_at", { ascending: false })
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
  if (q) query = query.ilike("email", `%${escapeLike(q)}%`);
  if (outcome) query = query.eq("outcome", outcome);
  // 테이블 미적용(마이그레이션 전)이어도 페이지가 깨지지 않도록 오류를 삼킨다
  const res = await query.then(
    (r) => r,
    () => ({ data: null, count: null, error: { message: "unavailable" } }),
  );

  const rows = (res.data ?? []) as unknown as LoginLogRow[];
  const total = res.count ?? 0;
  const filterQuery: Record<string, string> = {};
  if (q) filterQuery.q = q;
  if (outcome) filterQuery.outcome = outcome;

  return (
    <section aria-labelledby="admin-login-logs-heading" className="mt-5">
      <h3 id="admin-login-logs-heading" className="sr-only">
        {t("logs.loginTitle")}
      </h3>

      {res.error != null && page === 1 && (
        <p className="mt-2 border-[1.5px] border-dashed border-[var(--color-line)] p-4 text-sm text-[var(--color-ink-soft)]">
          {t("logs.notMigrated")}
        </p>
      )}

      <form method="get" className="flex flex-wrap items-end gap-2">
        <div>
          <label htmlFor="login-q" className="mb-1 block text-sm font-semibold">
            {t("logs.searchEmail")}
          </label>
          <input id="login-q" type="search" name="q" defaultValue={q} className={INPUT} />
        </div>
        <div>
          <label htmlFor="login-outcome" className="mb-1 block text-sm font-semibold">
            {t("logs.colOutcome")}
          </label>
          <select id="login-outcome" name="outcome" defaultValue={outcome ?? ""} className={INPUT}>
            <option value="">{t("logs.outcomeAll")}</option>
            {OUTCOMES.map((o) => (
              <option key={o} value={o}>
                {t(`logs.outcome.${o}`)}
              </option>
            ))}
          </select>
        </div>
        <button type="submit" className={FILTER_BTN}>
          {t("logs.apply")}
        </button>
      </form>

      <div className="mt-4 overflow-x-auto">
        <table className={TABLE}>
          <caption className="sr-only">{t("logs.loginTitle")}</caption>
          <thead>
            <tr className={TR_HEAD}>
              <th scope="col" className={TH}>{t("logs.colUser")}</th>
              <th scope="col" className={TH}>{t("logs.colEmail")}</th>
              <th scope="col" className={TH}>{t("logs.colProvider")}</th>
              <th scope="col" className={TH}>{t("logs.colIp")}</th>
              <th scope="col" className={TH}>{t("logs.colOutcome")}</th>
              <th scope="col" className="py-2 font-bold">{t("logs.colDate")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((l) => (
              <tr key={l.id} className={TR}>
                <td className="whitespace-nowrap py-2 pr-3">{l.profiles?.nickname ?? "—"}</td>
                <td className="py-2 pr-3">{l.email}</td>
                <td className="py-2 pr-3">
                  {l.provider === "google" ? "Google" : l.provider === "github" ? "GitHub" : l.provider}
                </td>
                <td className="py-2 pr-3 tabular-nums">{l.ip}</td>
                <td className="whitespace-nowrap py-2 pr-3">
                  {l.outcome === "mfa_failed" ? (
                    <span className="font-bold text-[var(--color-crit)]">{t("logs.outcome.mfa_failed")}</span>
                  ) : (
                    <span className="text-[var(--color-ink-faint)]">{t("logs.outcome.success")}</span>
                  )}
                </td>
                <td className="whitespace-nowrap py-2 tabular-nums text-[var(--color-ink-faint)]">
                  {format.dateTime(new Date(l.created_at), { dateStyle: "short", timeStyle: "medium" })}
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={6} className="py-4 text-sm text-[var(--color-ink-faint)]">
                  {t("logs.empty")}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <Pager pathname={`${adminBase()}/logs/logins`} query={filterQuery} page={page} total={total} />
    </section>
  );
}
