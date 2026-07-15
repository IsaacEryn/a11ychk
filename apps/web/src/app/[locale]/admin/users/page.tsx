import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { setUserLimits, toggleBlockUser } from "@/lib/actions";
import {
  EXT_DAILY_DEFAULT,
  MAX_PAGES_PER_SCAN,
  PLANS,
  PLAN_IDS,
  getCustomLimits,
  getCustomPages,
  getExtDailyLimit,
  getPlan,
  resolveLimits,
} from "@/lib/quota";
import { QuotaResetForm } from "../QuotaResetForm";
import { UserLimitsForm } from "../UserLimitsForm";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "admin" });
  return { title: `${t("nav.users")} — ${t("title")}` };
}

/** 사용자 관리 — 목록·검색·요금제/한도·초기화·차단 */
export default async function AdminUsersPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ q?: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const { q } = await searchParams;
  const t = await getTranslations("admin");
  const tDash = await getTranslations("dashboard");
  const format = await getFormatter();

  const admin = createAdminClient();
  let query = admin
    .from("profiles")
    .select("id, nickname, role, blocked, created_at, scan_limit_override")
    .order("created_at", { ascending: false })
    .limit(100);
  const search = (q ?? "").trim();
  if (search) query = query.ilike("nickname", `%${search.replaceAll("%", "\\%").replaceAll("_", "\\_")}%`);
  const { data: allUsers } = await query;

  return (
    <section aria-labelledby="admin-users-heading" className="mt-8">
      <h2 id="admin-users-heading" className="font-display text-2xl font-bold">
        {t("users.title")}
      </h2>

      {/* 닉네임 검색 (GET 폼) */}
      <form method="get" className="mt-4 flex flex-wrap items-end gap-2">
        <div>
          <label htmlFor="user-search" className="mb-1 block text-sm font-semibold">
            {t("users.searchLabel")}
          </label>
          <input
            id="user-search"
            type="search"
            name="q"
            defaultValue={search}
            className="rounded border-[1.5px] border-[var(--color-ink)] bg-[var(--color-paper)] px-3 py-2 text-sm"
          />
        </div>
        <button
          type="submit"
          className="rounded border-[1.5px] border-[var(--color-ink)] px-4 py-2 text-sm font-bold hover:bg-[var(--color-paper-warm)]"
        >
          {t("users.searchApply")}
        </button>
      </form>

      <ul className="mt-5 space-y-4">
        {(allUsers ?? []).map((u) => {
          const plan = getPlan(u.scan_limit_override);
          const limits = resolveLimits(u.scan_limit_override);
          return (
            <li key={u.id} className="doc-card p-5">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-display text-lg font-bold">{u.nickname}</span>
                <span className="rounded-full bg-[var(--color-paper-warm)] px-2 py-0.5 text-xs font-semibold text-[var(--color-ink-soft)]">
                  {u.role}
                </span>
                {u.blocked && (
                  <span className="rounded-full bg-[var(--color-crit-tint)] px-2 py-0.5 text-xs font-bold text-[var(--color-crit)]">
                    {t("users.blockedBadge")}
                  </span>
                )}
                <span className="ml-auto text-xs tabular-nums text-[var(--color-ink-faint)]">
                  {t("users.colJoined")}: {format.dateTime(new Date(u.created_at), { dateStyle: "short" })}
                </span>
              </div>

              {/* 요금제·개별 한도 설정 */}
              <UserLimitsForm
                action={setUserLimits}
                userId={u.id}
                currentPlan={plan}
                custom={getCustomLimits(u.scan_limit_override)}
                customPages={getCustomPages(u.scan_limit_override)}
                customExtDaily={
                  getExtDailyLimit(u.scan_limit_override) === EXT_DAILY_DEFAULT &&
                  !(u.scan_limit_override as Record<string, unknown> | null)?.extDaily
                    ? undefined
                    : getExtDailyLimit(u.scan_limit_override)
                }
                extDailyDefault={EXT_DAILY_DEFAULT}
                effective={limits}
                maxPages={MAX_PAGES_PER_SCAN}
                planOptions={PLAN_IDS.map((p) => ({
                  id: p,
                  label: t(`users.plans.${p}`),
                  limits: PLANS[p],
                  sampleSize: PLANS[p].sampleSize,
                }))}
                labels={{
                  plan: t("users.planLabel"),
                  daily: tDash("quota.daily"),
                  weekly: tDash("quota.weekly"),
                  monthly: tDash("quota.monthly"),
                  pages: t("users.pagesLabel"),
                  pagesHint: t("users.pagesHint", { max: MAX_PAGES_PER_SCAN }),
                  extDaily: t("users.extDailyLabel"),
                  save: t("users.saveLimits"),
                  customHint: t("users.customHint"),
                  effective: t("users.effective"),
                }}
              />

              {/* 초기화 · 차단 */}
              <div className="mt-3 flex flex-wrap items-end gap-2 border-t border-dashed border-[var(--color-line)] pt-3">
                <QuotaResetForm userId={u.id} />
                {u.role !== "admin" && (
                  <form action={toggleBlockUser} className="ml-auto">
                    <input type="hidden" name="id" value={u.id} />
                    <input type="hidden" name="blocked" value={String(u.blocked)} />
                    <button
                      type="submit"
                      className={`rounded border-[1.5px] px-3 py-1.5 text-xs font-bold ${
                        u.blocked
                          ? "border-[var(--color-seal)] text-[var(--color-seal)] hover:bg-[var(--color-seal-tint)]"
                          : "border-[var(--color-crit)] text-[var(--color-crit)] hover:bg-[var(--color-crit-tint)]"
                      }`}
                    >
                      {u.blocked ? t("users.unblock") : t("users.block")}
                    </button>
                  </form>
                )}
              </div>
            </li>
          );
        })}
        {(allUsers ?? []).length === 0 && (
          <li className="py-4 text-sm text-[var(--color-ink-faint)]">{t("users.noResults")}</li>
        )}
      </ul>
    </section>
  );
}
