import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { createAdminClient } from "@/lib/supabase/admin";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "admin" });
  return { title: `${t("nav.logs")} — ${t("title")}` };
}

interface LoginLogRow {
  id: string;
  email: string | null;
  provider: string | null;
  ip: string | null;
  user_agent: string | null;
  created_at: string;
  profiles: { nickname: string } | null;
}

interface AuditLogRow {
  id: string;
  action: string;
  target: string | null;
  detail: Record<string, unknown> | null;
  created_at: string;
  profiles: { nickname: string } | null;
}

/** 로그 — 로그인 기록 + 관리자 행위 감사 (migration 0006 미적용 시 안내만 표시) */
export default async function AdminLogsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("admin");
  const format = await getFormatter();

  const admin = createAdminClient();
  // 테이블 미적용(마이그레이션 전)이어도 페이지가 깨지지 않도록 오류를 삼킨다
  const [loginRes, auditRes] = await Promise.all([
    admin
      .from("login_logs")
      .select("id, email, provider, ip, user_agent, created_at, profiles(nickname)")
      .order("created_at", { ascending: false })
      .limit(50)
      .then(
        (r) => r,
        () => ({ data: null, error: { message: "unavailable" } }),
      ),
    admin
      .from("audit_logs")
      .select("id, action, target, detail, created_at, profiles(nickname)")
      .order("created_at", { ascending: false })
      .limit(50)
      .then(
        (r) => r,
        () => ({ data: null, error: { message: "unavailable" } }),
      ),
  ]);

  const notMigrated = loginRes.error != null && auditRes.error != null;
  const loginLogs = (loginRes.data ?? []) as unknown as LoginLogRow[];
  const auditLogs = (auditRes.data ?? []) as unknown as AuditLogRow[];

  // ── 인간 친화 표시: 대상 UUID → 닉네임/문의 제목 ──
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const targetIds = [...new Set(auditLogs.map((l) => l.target).filter((x): x is string => !!x && UUID.test(x)))];
  const targetNames = new Map<string, string>();
  if (targetIds.length > 0) {
    const [profRes, inqRes] = await Promise.all([
      admin.from("profiles").select("id, nickname").in("id", targetIds),
      admin.from("inquiries").select("id, title").in("id", targetIds),
    ]);
    for (const p of profRes.data ?? []) targetNames.set(p.id, p.nickname as string);
    for (const q of inqRes.data ?? []) targetNames.set(q.id, `"${q.title}"`);
  }

  const planNames: Record<string, string> = {
    free: t("users.plans.free"),
    pro: t("users.plans.pro"),
    enterprise: t("users.plans.enterprise"),
  };
  const scopeNames: Record<string, string> = {
    all: t("users.resetScope.all"),
    daily: t("users.resetScope.daily"),
    weekly: t("users.resetScope.weekly"),
    monthly: t("users.resetScope.monthly"),
  };

  /** 행위 코드 → 한국어 문장 라벨 */
  function actionLabel(action: string): string {
    const known = [
      "user.block",
      "user.unblock",
      "user.set_limits",
      "user.reset_quota",
      "plans.toggle",
      "plans.bulk_set",
      "pages.bulk_set",
      "inquiry.reply",
    ];
    return known.includes(action) ? t(`logs.actions.${action.replace(".", "_")}`) : action;
  }

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
    return parts.join(" · ");
  }

  return (
    <div className="mt-8">
      <h2 className="font-display text-2xl font-bold">{t("logs.title")}</h2>

      {notMigrated && (
        <p className="mt-4 border-[1.5px] border-dashed border-[var(--color-line)] p-4 text-sm text-[var(--color-ink-soft)]">
          {t("logs.notMigrated")}
        </p>
      )}

      {/* 로그인 기록 */}
      <section aria-labelledby="admin-login-logs-heading" className="mt-6">
        <h3 id="admin-login-logs-heading" className="font-display text-xl font-bold">
          {t("logs.loginTitle")}
        </h3>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full border-collapse border-y-[1.5px] border-[var(--color-ink)] text-sm">
            <caption className="sr-only">{t("logs.loginTitle")}</caption>
            <thead>
              <tr className="border-b-[1.5px] border-[var(--color-ink)] text-left">
                <th scope="col" className="py-2 pr-3 font-bold">{t("logs.colUser")}</th>
                <th scope="col" className="py-2 pr-3 font-bold">{t("logs.colEmail")}</th>
                <th scope="col" className="py-2 pr-3 font-bold">{t("logs.colProvider")}</th>
                <th scope="col" className="py-2 pr-3 font-bold">{t("logs.colIp")}</th>
                <th scope="col" className="py-2 font-bold">{t("logs.colDate")}</th>
              </tr>
            </thead>
            <tbody>
              {loginLogs.map((l) => (
                <tr key={l.id} className="border-b border-[var(--color-line)]">
                  <td className="whitespace-nowrap py-2 pr-3">{l.profiles?.nickname ?? "—"}</td>
                  <td className="py-2 pr-3">{l.email}</td>
                  <td className="py-2 pr-3">
                    {l.provider === "google" ? "Google" : l.provider === "github" ? "GitHub" : l.provider}
                  </td>
                  <td className="py-2 pr-3 tabular-nums">{l.ip}</td>
                  <td className="whitespace-nowrap py-2 tabular-nums text-[var(--color-ink-faint)]">
                    {format.dateTime(new Date(l.created_at), { dateStyle: "short", timeStyle: "medium" })}
                  </td>
                </tr>
              ))}
              {loginLogs.length === 0 && (
                <tr>
                  <td colSpan={5} className="py-4 text-sm text-[var(--color-ink-faint)]">
                    {t("logs.empty")}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* 관리자 행위 감사 */}
      <section aria-labelledby="admin-audit-logs-heading" className="mt-10">
        <h3 id="admin-audit-logs-heading" className="font-display text-xl font-bold">
          {t("logs.auditTitle")}
        </h3>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full border-collapse border-y-[1.5px] border-[var(--color-ink)] text-sm">
            <caption className="sr-only">{t("logs.auditTitle")}</caption>
            <thead>
              <tr className="border-b-[1.5px] border-[var(--color-ink)] text-left">
                <th scope="col" className="py-2 pr-3 font-bold">{t("logs.colActor")}</th>
                <th scope="col" className="py-2 pr-3 font-bold">{t("logs.colAction")}</th>
                <th scope="col" className="py-2 pr-3 font-bold">{t("logs.colTarget")}</th>
                <th scope="col" className="py-2 pr-3 font-bold">{t("logs.colDetail")}</th>
                <th scope="col" className="py-2 font-bold">{t("logs.colDate")}</th>
              </tr>
            </thead>
            <tbody>
              {auditLogs.map((l) => (
                <tr key={l.id} className="border-b border-[var(--color-line)]">
                  <td className="whitespace-nowrap py-2 pr-3">{l.profiles?.nickname ?? "—"}</td>
                  <td className="py-2 pr-3 font-semibold">{actionLabel(l.action)}</td>
                  <td className="max-w-44 truncate py-2 pr-3">
                    {l.target ? (targetNames.get(l.target) ?? <code className="font-mono text-xs">{l.target.slice(0, 8)}…</code>) : "—"}
                  </td>
                  <td className="max-w-64 py-2 pr-3 text-[var(--color-ink-soft)]">{detailLabel(l) || "—"}</td>
                  <td className="whitespace-nowrap py-2 tabular-nums text-[var(--color-ink-faint)]">
                    {format.dateTime(new Date(l.created_at), { dateStyle: "short", timeStyle: "short" })}
                  </td>
                </tr>
              ))}
              {auditLogs.length === 0 && (
                <tr>
                  <td colSpan={5} className="py-4 text-sm text-[var(--color-ink-faint)]">
                    {t("logs.empty")}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
