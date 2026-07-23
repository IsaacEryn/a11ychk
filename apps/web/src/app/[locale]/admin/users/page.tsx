import { requireAdmin } from "@/lib/adminGuard";
import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getPlansActive } from "@/lib/appSettings";
import { setUserLimits, toggleBlockUser } from "@/lib/actions";
import {
  EXT_DAILY_LIMITS,
  MAX_PAGES_PER_SCAN,
  PLANS,
  ASSIGNABLE_PLAN_IDS,
  getCustomLimits,
  getCustomPages,
  getPlan,
  getEarnedPlan,
  resolveLimits,
} from "@/lib/quota";
import { QuotaResetForm } from "../QuotaResetForm";
import { UserLimitsForm } from "../UserLimitsForm";
import { SendEmailForm } from "./SendEmailForm";

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
  await requireAdmin(locale); // 병렬 렌더 누출 방지 — page 자체 가드 (layout 가드만으로는 불충분)
  const { q } = await searchParams;
  const t = await getTranslations("admin");
  const tDash = await getTranslations("dashboard");
  const format = await getFormatter();

  const admin = createAdminClient();
  // 요금제 시행 여부에 따라 유효 한도가 달라진다 — 실제 적용값을 표시
  const plansActive = await getPlansActive(admin);
  let query = admin
    .from("profiles")
    .select("id, nickname, role, blocked, created_at, scan_limit_override, earned_plan, referral_daily_bonus")
    .order("created_at", { ascending: false })
    .limit(100);
  const search = (q ?? "").trim();
  // LIKE 특수문자 이스케이프 — 백슬래시를 먼저 처리해야 %/_ 이스케이프가 깨지지 않는다
  if (search) {
    const escaped = search.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_");
    query = query.ilike("nickname", `%${escaped}%`);
  }
  const { data: allUsers } = await query;

  // 오늘 확장 검사 사용량 — 목록 사용자 대상 일괄 조회 (테이블 미적용 시 빈 맵)
  const extUsedToday = new Map<string, number>();
  if (allUsers && allUsers.length > 0) {
    const { data: extRows } = await admin
      .from("extension_usage")
      .select("user_id, count")
      .eq("day", new Date().toISOString().slice(0, 10))
      .in("user_id", allUsers.map((u) => u.id));
    for (const r of extRows ?? []) extUsedToday.set(r.user_id as string, (r.count as number) ?? 0);
  }

  return (
    <section aria-labelledby="admin-users-heading" className="mt-8">
      <h2 id="admin-users-heading" className="font-display text-2xl font-bold">
        {t("users.title")}
      </h2>

      {/* 요금제 시행이 꺼져 있으면 아래 등급 배정이 무효임을 명시 (배정만 하고 시행 토글을 안 켠 혼란 방지) */}
      {!plansActive && (
        <p role="note" className="mt-3 border-l-[3px] border-[var(--color-mark)] bg-[var(--color-warn-tint)] px-4 py-3 text-sm font-medium">
          {t("users.plansInactive")}{" "}
          <a href={`/${locale}/admin/settings`} className="font-bold underline underline-offset-4">
            {t("users.plansInactiveLink")}
          </a>
        </p>
      )}

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
          const earned = getEarnedPlan((u as { earned_plan?: unknown }).earned_plan);
          const rawBonus = (u as { referral_daily_bonus?: unknown }).referral_daily_bonus;
          const limits = resolveLimits(
            u.scan_limit_override,
            plansActive,
            earned,
            typeof rawBonus === "number" ? rawBonus : 0,
          );
          // 관리자 개별 지정 확장 한도 — 없으면 undefined(등급 기본 사용)
          const rawExt = (u.scan_limit_override as Record<string, unknown> | null)?.extDaily;
          const extOverride = typeof rawExt === "number" && Number.isInteger(rawExt) && rawExt >= 0 ? rawExt : undefined;
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
                {earned && (
                  <span className="rounded-full bg-[var(--color-seal-tint)] px-2 py-0.5 text-xs font-bold text-[var(--color-seal)]">
                    {t(`users.earned.${earned}`)}
                  </span>
                )}
                <span className="ml-auto text-xs tabular-nums text-[var(--color-ink-faint)]">
                  {/* 오늘 확장 검사 사용량 / 유효 한도 (개별 지정 > 등급 기본) */}
                  {t("users.extToday", {
                    used: extUsedToday.get(u.id) ?? 0,
                    limit: extOverride ?? EXT_DAILY_LIMITS[plan],
                  })}
                  {" · "}
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
                customExtDaily={extOverride}
                extDailyDefault={EXT_DAILY_LIMITS[plan]}
                effective={limits}
                maxPages={MAX_PAGES_PER_SCAN}
                planOptions={ASSIGNABLE_PLAN_IDS.map((p) => ({
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

              {/* 메일 보내기 (접기형) */}
              <SendEmailForm userId={u.id} />
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
