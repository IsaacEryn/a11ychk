import { requireAdmin } from "@/lib/adminGuard";
import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getPlansActive } from "@/lib/appSettings";
import { adminBase } from "@/lib/adminSlug";
import { escapeLike } from "@/lib/like";
import { EXT_DAILY_LIMITS, getEarnedPlan, getPlan } from "@/lib/quota";
import { Link } from "@/i18n/navigation";
import { Pager, PAGE_SIZE, parsePage } from "../Pager";
import { FILTER_BTN, INPUT, TABLE, TH, TR, TR_HEAD } from "../tableStyles";
import { UserDrawer } from "./UserDrawer";
import { UserDetail, type UserProfileRow } from "./UserDetail";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "admin" });
  return { title: `${t("nav.users")} — ${t("title")}` };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PROFILE_COLS = "id, nickname, role, blocked, created_at, scan_limit_override, earned_plan, referral_daily_bonus";

/** 사용자 관리 — 리스트 + 페이징 + 검색, 사용자별 설정은 상세 드로어(?user=)에서 */
export default async function AdminUsersPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ q?: string; page?: string; user?: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requireAdmin(locale); // 병렬 렌더 누출 방지 — page 자체 가드 (layout 가드만으로는 불충분)
  const sp = await searchParams;
  const t = await getTranslations("admin");
  const format = await getFormatter();

  const page = parsePage(sp.page);
  const search = (sp.q ?? "").trim();
  const drawerUserId = sp.user && UUID.test(sp.user) ? sp.user : undefined;

  const admin = createAdminClient();
  // 요금제 시행 여부에 따라 유효 한도가 달라진다 — 실제 적용값을 표시
  const plansActive = await getPlansActive(admin);

  // 검색 — @가 있으면 이메일로 간주하고 login_logs 경유(최근 90일 로그인 사용자만
  // 매치 — auth.users는 PostgREST로 조회할 수 없다), 아니면 닉네임 ilike
  let emailMatchIds: string[] | null = null;
  if (search.includes("@")) {
    const { data } = await admin
      .from("login_logs")
      .select("user_id")
      .ilike("email", `%${escapeLike(search)}%`)
      .not("user_id", "is", null)
      .order("created_at", { ascending: false })
      .limit(500);
    emailMatchIds = [...new Set((data ?? []).map((r) => r.user_id as string))];
  }

  let users: UserProfileRow[] = [];
  let total = 0;
  if (emailMatchIds === null || emailMatchIds.length > 0) {
    let query = admin
      .from("profiles")
      .select(PROFILE_COLS, { count: "exact" })
      .order("created_at", { ascending: false })
      .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
    if (emailMatchIds) query = query.in("id", emailMatchIds);
    else if (search) query = query.ilike("nickname", `%${escapeLike(search)}%`);
    const { data, count } = await query;
    users = (data ?? []) as unknown as UserProfileRow[];
    total = count ?? 0;
  }

  // 오늘 확장 검사 사용량 — 목록 사용자 대상 일괄 조회 (테이블 미적용 시 빈 맵)
  const today = new Date().toISOString().slice(0, 10);
  const extUsedToday = new Map<string, number>();
  if (users.length > 0) {
    const { data: extRows } = await admin
      .from("extension_usage")
      .select("user_id, count")
      .eq("day", today)
      .in("user_id", users.map((u) => u.id));
    for (const r of extRows ?? []) extUsedToday.set(r.user_id as string, (r.count as number) ?? 0);
  }

  // 드로어 대상 — 목록에 없어도(다른 페이지·검색 밖·감사 로그 딥링크) 단건 조회로 연다
  let drawer: { u: UserProfileRow; email: string | null; extUsed: number } | null = null;
  if (drawerUserId) {
    const inList = users.find((u) => u.id === drawerUserId);
    const u =
      inList ??
      (((await admin.from("profiles").select(PROFILE_COLS).eq("id", drawerUserId).maybeSingle()).data ??
        null) as UserProfileRow | null);
    if (u) {
      const { data: authUser } = await admin.auth.admin.getUserById(u.id).catch(() => ({ data: null }));
      let extUsed = extUsedToday.get(u.id);
      if (extUsed === undefined) {
        const { data: ext } = await admin
          .from("extension_usage")
          .select("count")
          .eq("day", today)
          .eq("user_id", u.id)
          .maybeSingle();
        extUsed = (ext?.count as number | undefined) ?? 0;
      }
      drawer = { u, email: authUser?.user?.email ?? null, extUsed };
    }
  }

  const filterQuery: Record<string, string> = {};
  if (search) filterQuery.q = search;
  const listQs = new URLSearchParams({ ...filterQuery, ...(page > 1 ? { page: String(page) } : {}) }).toString();
  const closeHref = `${adminBase()}/users${listQs ? `?${listQs}` : ""}`;

  return (
    <section aria-labelledby="admin-users-heading" className="mt-8">
      <h2 id="admin-users-heading" className="font-display text-2xl font-bold">
        {t("users.title")}
      </h2>

      {/* 요금제 시행이 꺼져 있으면 아래 등급 배정이 무효임을 명시 (배정만 하고 시행 토글을 안 켠 혼란 방지) */}
      {!plansActive && (
        <p role="note" className="mt-3 border-l-[3px] border-[var(--color-mark)] bg-[var(--color-warn-tint)] px-4 py-3 text-sm font-medium">
          {t("users.plansInactive")}{" "}
          <Link href={`${adminBase()}/settings`} className="font-bold underline underline-offset-4">
            {t("users.plansInactiveLink")}
          </Link>
        </p>
      )}

      {/* 닉네임·이메일 검색 (GET 폼) */}
      <form method="get" className="mt-4 flex flex-wrap items-end gap-2">
        <div>
          <label htmlFor="user-search" className="mb-1 block text-sm font-semibold">
            {t("users.searchLabel")}
          </label>
          <input id="user-search" type="search" name="q" defaultValue={search} className={INPUT} aria-describedby="user-search-hint" />
          <p id="user-search-hint" className="mt-1 text-xs text-[var(--color-ink-faint)]">
            {t("users.emailHint")}
          </p>
        </div>
        <button type="submit" className={FILTER_BTN}>
          {t("users.searchApply")}
        </button>
      </form>

      <div className="mt-5 overflow-x-auto">
        <table className={TABLE}>
          <caption className="sr-only">{t("users.title")}</caption>
          <thead>
            <tr className={TR_HEAD}>
              <th scope="col" className={TH}>{t("users.colNickname")}</th>
              <th scope="col" className={TH}>{t("users.colRole")}</th>
              <th scope="col" className={TH}>{t("users.colPlan")}</th>
              <th scope="col" className={TH}>{t("users.colExt")}</th>
              <th scope="col" className={TH}>{t("users.colJoined")}</th>
              <th scope="col" className="py-2 font-bold">
                <span className="sr-only">{t("users.manage")}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => {
              const plan = getPlan(u.scan_limit_override);
              const earned = getEarnedPlan(u.earned_plan);
              const rawExt = (u.scan_limit_override as Record<string, unknown> | null)?.extDaily;
              const extLimit =
                typeof rawExt === "number" && Number.isInteger(rawExt) && rawExt >= 0 ? rawExt : EXT_DAILY_LIMITS[plan];
              return (
                <tr key={u.id} className={TR}>
                  <td className="whitespace-nowrap py-2 pr-3 font-semibold">
                    {u.nickname}
                    {u.blocked && (
                      <span className="ml-1.5 rounded-full bg-[var(--color-crit-tint)] px-2 py-0.5 text-xs font-bold text-[var(--color-crit)]">
                        {t("users.blockedBadge")}
                      </span>
                    )}
                  </td>
                  <td className="py-2 pr-3">{u.role}</td>
                  <td className="whitespace-nowrap py-2 pr-3">
                    {t(`users.plans.${plan}`)}
                    {earned && (
                      <span className="ml-1.5 rounded-full bg-[var(--color-seal-tint)] px-2 py-0.5 text-xs font-bold text-[var(--color-seal)]">
                        {t(`users.earned.${earned}`)}
                      </span>
                    )}
                  </td>
                  <td className="whitespace-nowrap py-2 pr-3 tabular-nums">
                    {extUsedToday.get(u.id) ?? 0} / {extLimit}
                  </td>
                  <td className="whitespace-nowrap py-2 pr-3 tabular-nums text-[var(--color-ink-faint)]">
                    {format.dateTime(new Date(u.created_at), { dateStyle: "short" })}
                  </td>
                  <td className="py-2">
                    <Link
                      href={{
                        pathname: `${adminBase()}/users`,
                        query: { ...filterQuery, ...(page > 1 ? { page: String(page) } : {}), user: u.id },
                      }}
                      data-user-trigger={u.id}
                      className="text-xs font-bold text-[var(--color-seal)] underline underline-offset-2 hover:text-[var(--color-seal-deep)]"
                    >
                      {t("users.manage")}
                    </Link>
                  </td>
                </tr>
              );
            })}
            {users.length === 0 && (
              <tr>
                <td colSpan={6} className="py-4 text-sm text-[var(--color-ink-faint)]">
                  {t("users.noResults")}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <Pager pathname={`${adminBase()}/users`} query={filterQuery} page={page} total={total} />

      {drawer && (
        <UserDrawer
          key={drawer.u.id}
          closeHref={closeHref}
          userId={drawer.u.id}
          title={drawer.u.nickname}
          closeLabel={t("users.close")}
        >
          <UserDetail u={drawer.u} email={drawer.email} extUsedToday={drawer.extUsed} plansActive={plansActive} />
        </UserDrawer>
      )}
    </section>
  );
}
