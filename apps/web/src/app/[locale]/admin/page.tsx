import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { bulkSetPlan, replyInquiry, resetQuota, setUserLimits, toggleBlockUser } from "@/lib/actions";
import { StatusBadge } from "@/components/StatusBadge";
import { PLANS, PLAN_IDS, getCustomLimits, getPlan, resolveLimits } from "@/lib/quota";
import { UserLimitsForm } from "./UserLimitsForm";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "admin" });
  return { title: t("title"), robots: { index: false } };
}

function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * 24 * 3600_000).toISOString();
}

export default async function AdminPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("admin");
  const tDash = await getTranslations("dashboard");
  const format = await getFormatter();

  // 관리자 확인 (RLS와 별개로 서버에서 role 검증)
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/${locale}/login`);
  const { data: me } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  if (me?.role !== "admin") redirect(`/${locale}/dashboard`);

  const admin = createAdminClient();
  const thirtyDaysAgo = isoDaysAgo(30);

  const [users, scans30d, running, openInquiries, recentScans, allUsers, inquiries] = await Promise.all([
    admin.from("profiles").select("id", { count: "exact", head: true }),
    admin.from("scans").select("id", { count: "exact", head: true }).gte("created_at", thirtyDaysAgo),
    admin.from("scans").select("id", { count: "exact", head: true }).in("status", ["queued", "running"]),
    admin.from("inquiries").select("id", { count: "exact", head: true }).eq("status", "open"),
    admin
      .from("scans")
      .select("id, root_url, status, error, created_at, profiles(nickname)")
      .order("created_at", { ascending: false })
      .limit(30),
    admin
      .from("profiles")
      .select("id, nickname, role, blocked, created_at, scan_limit_override")
      .order("created_at", { ascending: false })
      .limit(100),
    admin
      .from("inquiries")
      .select("id, type, title, body, status, admin_reply, created_at, profiles(nickname)")
      .order("created_at", { ascending: false })
      .limit(50),
  ]);

  const stats = [
    [t("stats.users"), users.count ?? 0],
    [t("stats.scans30d"), scans30d.count ?? 0],
    [t("stats.running"), running.count ?? 0],
    [t("stats.openInquiries"), openInquiries.count ?? 0],
  ] as const;

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
      <h1 className="font-display text-3xl font-bold">{t("title")}</h1>

      {/* 통계 */}
      <dl className="mt-8 grid grid-cols-2 gap-4 md:grid-cols-4">
        {stats.map(([label, value]) => (
          <div key={label} className="doc-card p-5">
            <dt className="text-sm font-semibold text-[var(--color-ink-soft)]">{label}</dt>
            <dd className="font-display mt-1 text-4xl font-extrabold text-[var(--color-seal)]">{value}</dd>
          </div>
        ))}
      </dl>

      {/* 검사 로그 */}
      <section aria-labelledby="admin-scans-heading" className="mt-12">
        <h2 id="admin-scans-heading" className="font-display text-2xl font-bold">
          {t("scans.title")}
        </h2>
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
              {(recentScans.data ?? []).map((s) => (
                <tr key={s.id} className="border-b border-[var(--color-line)]">
                  <td className="whitespace-nowrap py-2 pr-3">{(s.profiles as unknown as { nickname: string } | null)?.nickname}</td>
                  <td className="max-w-64 truncate py-2 pr-3">{s.root_url}</td>
                  <td className="py-2 pr-3">
                    <StatusBadge status={s.status} label={tDash(`status.${s.status as "queued" | "running" | "done" | "failed"}`)} />
                  </td>
                  <td className="whitespace-nowrap py-2 pr-3 tabular-nums text-[var(--color-ink-faint)]">
                    {format.dateTime(new Date(s.created_at), { dateStyle: "short", timeStyle: "short" })}
                  </td>
                  <td className="max-w-56 truncate py-2 text-[var(--color-crit)]">{s.error}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* 사용자 관리 */}
      <section aria-labelledby="admin-users-heading" className="mt-12">
        <h2 id="admin-users-heading" className="font-display text-2xl font-bold">
          {t("users.title")}
        </h2>

        {/* 요금제(그룹) 일괄 배정 */}
        <form action={bulkSetPlan} className="mt-4 flex flex-wrap items-end gap-2 border-[1.5px] border-dashed border-[var(--color-line)] p-4">
          <div>
            <label htmlFor="bulk-plan" className="mb-1 block text-sm font-semibold">
              {t("users.bulkPlanLabel")}
            </label>
            <select
              id="bulk-plan"
              name="plan"
              defaultValue="free"
              className="rounded border-[1.5px] border-[var(--color-ink)] bg-[var(--color-paper)] px-3 py-2 text-sm"
            >
              {PLAN_IDS.map((p) => (
                <option key={p} value={p}>
                  {t(`users.plans.${p}`)} ({PLANS[p].daily}/{PLANS[p].weekly}/{PLANS[p].monthly})
                </option>
              ))}
            </select>
          </div>
          <button
            type="submit"
            className="rounded border-[1.5px] border-[var(--color-ink)] px-4 py-2 text-sm font-bold hover:bg-[var(--color-paper-warm)]"
          >
            {t("users.bulkApply")}
          </button>
          <p className="w-full text-xs text-[var(--color-ink-faint)]">{t("users.bulkHint")}</p>
        </form>

        <ul className="mt-5 space-y-4">
          {(allUsers.data ?? []).map((u) => {
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
                  effective={limits}
                  planOptions={PLAN_IDS.map((p) => ({ id: p, label: t(`users.plans.${p}`), limits: PLANS[p] }))}
                  labels={{
                    plan: t("users.planLabel"),
                    daily: tDash("quota.daily"),
                    weekly: tDash("quota.weekly"),
                    monthly: tDash("quota.monthly"),
                    save: t("users.saveLimits"),
                    customHint: t("users.customHint"),
                    effective: t("users.effective"),
                  }}
                />

                {/* 초기화 · 차단 */}
                <div className="mt-3 flex flex-wrap items-end gap-2 border-t border-dashed border-[var(--color-line)] pt-3">
                  <form action={resetQuota} className="flex items-end gap-2">
                    <input type="hidden" name="id" value={u.id} />
                    <div>
                      <label htmlFor={`scope-${u.id}`} className="mb-1 block text-xs font-semibold">
                        {t("users.resetScopeLabel")}
                      </label>
                      <select
                        id={`scope-${u.id}`}
                        name="scope"
                        defaultValue="all"
                        className="rounded border-[1.5px] border-[var(--color-line)] bg-[var(--color-paper)] px-2 py-1.5 text-xs"
                      >
                        <option value="all">{t("users.resetScope.all")}</option>
                        <option value="daily">{t("users.resetScope.daily")}</option>
                        <option value="weekly">{t("users.resetScope.weekly")}</option>
                        <option value="monthly">{t("users.resetScope.monthly")}</option>
                      </select>
                    </div>
                    <button
                      type="submit"
                      className="rounded border-[1.5px] border-[var(--color-line)] px-3 py-1.5 text-xs font-bold text-[var(--color-ink-soft)] hover:border-[var(--color-seal)] hover:text-[var(--color-seal)]"
                    >
                      {t("users.resetApply")}
                    </button>
                  </form>
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
        </ul>
      </section>

      {/* 문의 관리 */}
      <section aria-labelledby="admin-inquiries-heading" className="mt-12">
        <h2 id="admin-inquiries-heading" className="font-display text-2xl font-bold">
          {t("inquiriesSection.title")}
        </h2>
        <ul className="mt-4 space-y-4">
          {(inquiries.data ?? []).map((q) => (
            <li key={q.id} className="doc-card p-5">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="font-bold">{q.title}</span>
                <span className="text-[var(--color-ink-faint)]">
                  {t("inquiriesSection.from")}: {(q.profiles as unknown as { nickname: string } | null)?.nickname} ·{" "}
                  {format.dateTime(new Date(q.created_at), { dateStyle: "short" })} · {q.type} · {q.status}
                </span>
              </div>
              <p className="mt-2 whitespace-pre-wrap text-sm text-[var(--color-ink-soft)]">{q.body}</p>
              <form action={replyInquiry} className="mt-3 border-t border-dashed border-[var(--color-line)] pt-3">
                <input type="hidden" name="id" value={q.id} />
                <label htmlFor={`reply-${q.id}`} className="mb-1 block text-xs font-bold">
                  {t("inquiriesSection.replyLabel")}
                </label>
                <textarea
                  id={`reply-${q.id}`}
                  name="reply"
                  rows={2}
                  required
                  defaultValue={q.admin_reply ?? ""}
                  className="w-full rounded border-[1.5px] border-[var(--color-line)] bg-[var(--color-paper)] px-3 py-2 text-sm"
                />
                <button
                  type="submit"
                  className="mt-2 rounded border-[1.5px] border-[var(--color-seal)] px-3 py-1.5 text-sm font-bold text-[var(--color-seal)] hover:bg-[var(--color-seal-tint)]"
                >
                  {t("inquiriesSection.send")}
                </button>
              </form>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
