import { requireAdmin } from "@/lib/adminGuard";
import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { adminBase } from "@/lib/adminSlug";
import { escapeLike } from "@/lib/like";
import { AUDIT_ACTIONS } from "@/lib/adminLogLabels";
import { Link } from "@/i18n/navigation";
import { Pager, PAGE_SIZE, parsePage } from "../../Pager";
import { FILTER_BTN, INPUT, TABLE, TH, TR, TR_HEAD } from "../../tableStyles";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "admin" });
  return { title: `${t("logs.tabs.audit")} — ${t("title")}` };
}

interface AuditLogRow {
  id: string;
  actor_id: string | null;
  action: string;
  target: string | null;
  detail: Record<string, unknown> | null;
  created_at: string;
  profiles: { nickname: string } | null;
}

/** 관리자 행위 감사 — 페이징 + 행위 필터 + 수행자 검색 (무기한 보존, migration 0006) */
export default async function AdminAuditLogsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ page?: string; action?: string; actor?: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requireAdmin(locale); // 병렬 렌더 누출 방지 — page 자체 가드 (layout 가드만으로는 불충분)
  const sp = await searchParams;
  const t = await getTranslations("admin");
  const format = await getFormatter();

  const page = parsePage(sp.page);
  const action = (AUDIT_ACTIONS as readonly string[]).includes(sp.action ?? "") ? sp.action : undefined;
  const actor = (sp.actor ?? "").trim();

  const admin = createAdminClient();

  // 수행자 닉네임 검색 — profiles 선조회 후 actor_id로 좁힌다 (0건이면 단락)
  let actorIds: string[] | null = null;
  if (actor) {
    const { data } = await admin
      .from("profiles")
      .select("id")
      .ilike("nickname", `%${escapeLike(actor)}%`)
      .limit(100);
    actorIds = (data ?? []).map((p) => p.id as string);
  }

  let rows: AuditLogRow[] = [];
  let total = 0;
  let unavailable = false;
  if (actorIds === null || actorIds.length > 0) {
    let query = admin
      .from("audit_logs")
      .select("id, actor_id, action, target, detail, created_at, profiles(nickname)", { count: "exact" })
      .order("created_at", { ascending: false })
      .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
    if (action) query = query.eq("action", action);
    if (actorIds) query = query.in("actor_id", actorIds);
    const res = await query.then(
      (r) => r,
      () => ({ data: null, count: null, error: { message: "unavailable" } }),
    );
    rows = (res.data ?? []) as unknown as AuditLogRow[];
    total = res.count ?? 0;
    unavailable = res.error != null;
  }

  // ── 대상 UUID → 닉네임/문의 제목. 사용자 대상은 드로어 링크로 (이메일 조회 N+1 제거) ──
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const targetIds = [...new Set(rows.map((l) => l.target).filter((x): x is string => !!x && UUID.test(x)))];
  const targetUsers = new Map<string, string>();
  const targetInquiries = new Map<string, string>();
  if (targetIds.length > 0) {
    const [profRes, inqRes] = await Promise.all([
      admin.from("profiles").select("id, nickname").in("id", targetIds),
      admin.from("inquiries").select("id, title").in("id", targetIds),
    ]);
    for (const p of profRes.data ?? []) targetUsers.set(p.id as string, p.nickname as string);
    for (const iq of inqRes.data ?? []) targetInquiries.set(iq.id as string, iq.title as string);
  }

  // 수행자 이메일 — 관리자 계정 몇 명뿐이라 distinct 조회는 상수 회수
  const emails = new Map<string, string>();
  const actorSet = [...new Set(rows.map((l) => l.actor_id).filter((x): x is string => !!x))];
  await Promise.all(
    actorSet.map(async (id) => {
      const { data } = await admin.auth.admin.getUserById(id).catch(() => ({ data: null }));
      if (data?.user?.email) emails.set(id, data.user.email);
    }),
  );

  const planNames: Record<string, string> = Object.fromEntries(
    ["free", "plus1", "plus2", "plus", "pro", "enterprise", "unlimited"].map((p) => [p, t(`users.plans.${p}`)]),
  );
  const scopeNames: Record<string, string> = Object.fromEntries(
    ["all", "daily", "weekly", "monthly", "extension"].map((s) => [s, t(`users.resetScope.${s}`)]),
  );

  /** 행위 코드 → 문장 라벨 (미등록 코드는 원문 그대로) */
  const actionLabel = (a: string): string =>
    (AUDIT_ACTIONS as readonly string[]).includes(a) ? t(`logs.actions.${a.replace(".", "_")}`) : a;

  /** detail jsonb → 읽기 쉬운 요약 */
  function detailLabel(l: AuditLogRow): string {
    const d = l.detail ?? {};
    const parts: string[] = [];
    if (typeof d.scope === "string") parts.push(scopeNames[d.scope] ?? d.scope);
    if (typeof d.plan === "string") parts.push(planNames[d.plan] ?? d.plan);
    if (typeof d.active === "boolean") parts.push(d.active ? t("logs.detailActive") : t("logs.detailInactive"));
    const limits: string[] = [];
    if (typeof d.daily === "number") limits.push(t("logs.detailDaily", { n: d.daily }));
    if (typeof d.weekly === "number") limits.push(t("logs.detailWeekly", { n: d.weekly }));
    if (typeof d.monthly === "number") limits.push(t("logs.detailMonthly", { n: d.monthly }));
    if (typeof d.pages === "number") limits.push(t("logs.detailPages", { n: d.pages }));
    if (d.pages === null) limits.push(t("logs.detailPagesCleared"));
    if (limits.length > 0) parts.push(limits.join(" · "));
    if (typeof d.count === "number") parts.push(t("logs.detailCount", { n: d.count }));
    if (typeof d.subject === "string") parts.push(`"${d.subject}"`);
    if (typeof d.url === "string") parts.push(d.url);
    return parts.join(" · ");
  }

  const filterQuery: Record<string, string> = {};
  if (action) filterQuery.action = action;
  if (actor) filterQuery.actor = actor;

  return (
    <section aria-labelledby="admin-audit-logs-heading" className="mt-5">
      <h3 id="admin-audit-logs-heading" className="sr-only">
        {t("logs.auditTitle")}
      </h3>

      {unavailable && (
        <p className="mt-2 border-[1.5px] border-dashed border-[var(--color-line)] p-4 text-sm text-[var(--color-ink-soft)]">
          {t("logs.notMigrated")}
        </p>
      )}

      <form method="get" className="flex flex-wrap items-end gap-2">
        <div>
          <label htmlFor="audit-action" className="mb-1 block text-sm font-semibold">
            {t("logs.colAction")}
          </label>
          <select id="audit-action" name="action" defaultValue={action ?? ""} className={INPUT}>
            <option value="">{t("logs.actionAll")}</option>
            {AUDIT_ACTIONS.map((a) => (
              <option key={a} value={a}>
                {t(`logs.actions.${a.replace(".", "_")}`)}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="audit-actor" className="mb-1 block text-sm font-semibold">
            {t("logs.actorSearch")}
          </label>
          <input id="audit-actor" type="search" name="actor" defaultValue={actor} className={INPUT} />
        </div>
        <button type="submit" className={FILTER_BTN}>
          {t("logs.apply")}
        </button>
      </form>

      <div className="mt-4 overflow-x-auto">
        <table className={TABLE}>
          <caption className="sr-only">{t("logs.auditTitle")}</caption>
          <thead>
            <tr className={TR_HEAD}>
              <th scope="col" className={TH}>{t("logs.colActor")}</th>
              <th scope="col" className={TH}>{t("logs.colAction")}</th>
              <th scope="col" className={TH}>{t("logs.colTarget")}</th>
              <th scope="col" className={TH}>{t("logs.colDetail")}</th>
              <th scope="col" className="py-2 font-bold">{t("logs.colDate")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((l) => (
              <tr key={l.id} className={TR}>
                <td className="whitespace-nowrap py-2 pr-3">
                  {l.profiles
                    ? l.actor_id && emails.has(l.actor_id)
                      ? `${l.profiles.nickname} (${emails.get(l.actor_id)})`
                      : l.profiles.nickname
                    : "—"}
                </td>
                <td className="py-2 pr-3 font-semibold">{actionLabel(l.action)}</td>
                <td className="max-w-64 truncate py-2 pr-3">
                  {l.target ? (
                    targetUsers.has(l.target) ? (
                      // 사용자 대상 — 이메일 병기 대신 상세 드로어로 연결 (조회 N+1 제거)
                      <Link
                        href={{ pathname: `${adminBase()}/users`, query: { user: l.target } }}
                        className="font-semibold underline underline-offset-2 hover:text-[var(--color-seal)]"
                      >
                        {targetUsers.get(l.target)}
                      </Link>
                    ) : targetInquiries.has(l.target) ? (
                      `"${targetInquiries.get(l.target)}"`
                    ) : (
                      <code className="font-mono text-xs">{l.target.slice(0, 8)}…</code>
                    )
                  ) : (
                    "—"
                  )}
                </td>
                <td className="max-w-64 py-2 pr-3 text-[var(--color-ink-soft)]">{detailLabel(l) || "—"}</td>
                <td className="whitespace-nowrap py-2 tabular-nums text-[var(--color-ink-faint)]">
                  {format.dateTime(new Date(l.created_at), { dateStyle: "short", timeStyle: "short" })}
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={5} className="py-4 text-sm text-[var(--color-ink-faint)]">
                  {t("logs.empty")}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <Pager pathname={`${adminBase()}/logs/audit`} query={filterQuery} page={page} total={total} />
    </section>
  );
}
