import { requireAdmin } from "@/lib/adminGuard";
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
  actor_id: string | null;
  action: string;
  target: string | null;
  detail: Record<string, unknown> | null;
  created_at: string;
  profiles: { nickname: string } | null;
}

interface AppErrorRow {
  id: string;
  digest: string | null;
  message: string;
  path: string | null;
  method: string | null;
  created_at: string;
}

/** 로그 — 로그인 기록 + 관리자 행위 감사 (migration 0006 미적용 시 안내만 표시) */
export default async function AdminLogsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requireAdmin(locale); // 병렬 렌더 누출 방지 — page 자체 가드 (layout 가드만으로는 불충분)
  const t = await getTranslations("admin");
  const format = await getFormatter();

  const admin = createAdminClient();
  // 테이블 미적용(마이그레이션 전)이어도 페이지가 깨지지 않도록 오류를 삼킨다
  const [loginRes, auditRes, errorRes] = await Promise.all([
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
      .select("id, actor_id, action, target, detail, created_at, profiles(nickname)")
      .order("created_at", { ascending: false })
      .limit(50)
      .then(
        (r) => r,
        () => ({ data: null, error: { message: "unavailable" } }),
      ),
    admin
      .from("app_errors")
      .select("id, digest, message, path, method, created_at")
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
  const appErrors = (errorRes.data ?? []) as unknown as AppErrorRow[];
  const errorsMigrated = errorRes.error == null;

  // ── 인간 친화 표시: 대상 UUID → 닉네임/문의 제목, 사용자에는 이메일 병기 ──
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const targetIds = [...new Set(auditLogs.map((l) => l.target).filter((x): x is string => !!x && UUID.test(x)))];
  const targetNames = new Map<string, string>();
  const userIds = new Set<string>(auditLogs.map((l) => l.actor_id).filter((x): x is string => !!x));
  if (targetIds.length > 0) {
    const [profRes, inqRes] = await Promise.all([
      admin.from("profiles").select("id, nickname").in("id", targetIds),
      admin.from("inquiries").select("id, title").in("id", targetIds),
    ]);
    for (const p of profRes.data ?? []) {
      targetNames.set(p.id, p.nickname as string);
      userIds.add(p.id as string);
    }
    for (const q of inqRes.data ?? []) targetNames.set(q.id, `"${q.title}"`);
  }

  // 이메일은 auth.users에만 있어 admin API로 조회 (수행자·사용자 대상 한정, 소량)
  const emails = new Map<string, string>();
  await Promise.all(
    [...userIds].map(async (id) => {
      const { data } = await admin.auth.admin.getUserById(id).catch(() => ({ data: null }));
      if (data?.user?.email) emails.set(id, data.user.email);
    }),
  );

  /** "닉네임 (이메일)" — 이메일을 못 찾으면 닉네임만 */
  function nameWithEmail(nickname: string, id: string | null): string {
    const email = id ? emails.get(id) : undefined;
    return email ? `${nickname} (${email})` : nickname;
  }

  const planNames: Record<string, string> = {
    free: t("users.plans.free"),
    plus1: t("users.plans.plus1"),
    plus2: t("users.plans.plus2"),
    plus: t("users.plans.plus"),
    pro: t("users.plans.pro"),
    enterprise: t("users.plans.enterprise"),
    unlimited: t("users.plans.unlimited"),
  };
  const scopeNames: Record<string, string> = {
    all: t("users.resetScope.all"),
    daily: t("users.resetScope.daily"),
    weekly: t("users.resetScope.weekly"),
    monthly: t("users.resetScope.monthly"),
    extension: t("users.resetScope.extension"),
  };

  /** 오류 메시지 → 분류 라벨 (원문은 함께 표시) */
  function errorKind(message: string): string {
    if (/is not defined|is not a function|Cannot read|undefined is not|ReferenceError|TypeError/i.test(message))
      return t("logs.errorKind.code");
    if (/timeout|timed out/i.test(message)) return t("logs.errorKind.timeout");
    if (/fetch failed|ECONN|ENOTFOUND|EAI_AGAIN|network|socket hang up/i.test(message))
      return t("logs.errorKind.network");
    if (/postgres|supabase|PGRST|relation .+ does not exist|duplicate key|violates/i.test(message))
      return t("logs.errorKind.db");
    return t("logs.errorKind.generic");
  }

  /** 오류 경로 → 페이지/API 이름 (전체 경로는 함께 표시) */
  function pathKind(path: string | null): string {
    if (!path) return t("logs.pathKind.other");
    const p = path.replace(/^\/(ko|en)(?=\/|$)/, "");
    if (p === "" || p === "/") return t("logs.pathKind.landing");
    if (/^\/scans\/[^/]+\/report/.test(p)) return t("logs.pathKind.report");
    if (/^\/scans\/[^/]+/.test(p)) return t("logs.pathKind.scanDetail");
    if (p.startsWith("/scan")) return t("logs.pathKind.scanForm");
    if (p.startsWith("/dashboard")) return t("logs.pathKind.dashboard");
    if (p.startsWith("/admin")) return t("logs.pathKind.admin");
    if (/^\/api\/scans\/[^/]+\/pdf/.test(p)) return t("logs.pathKind.apiPdf");
    if (/^\/api\/scans\/[^/]+\/csv/.test(p)) return t("logs.pathKind.apiCsv");
    if (/^\/api\/scans\/[^/]+\/earl/.test(p)) return t("logs.pathKind.apiEarl");
    if (/^\/api\/scans\/[^/]+\/ai-fix/.test(p)) return t("logs.pathKind.apiAiFix");
    if (p.startsWith("/api/scans")) return t("logs.pathKind.apiScanCreate");
    if (p.startsWith("/api/ext")) return t("logs.pathKind.apiExt");
    if (p.startsWith("/api/cron")) return t("logs.pathKind.apiCron");
    if (p.startsWith("/api/badge")) return t("logs.pathKind.apiBadge");
    return t("logs.pathKind.other");
  }

  /** 행위 코드 → 한국어 문장 라벨 */
  function actionLabel(action: string): string {
    const known = [
      "user.block",
      "user.unblock",
      "user.set_limits",
      "user.reset_quota",
      "user.email",
      "plans.toggle",
      "plans.bulk_set",
      "pages.bulk_set",
      "inquiry.reply",
      "auth.login",
      "stats.refresh",
      "referral.approve",
      "referral.reject",
      "referral.promote",
      "referral.clearEarned",
      "scan.admin_retry",
      "report.view",
      "announcement.publish",
      "announcement.clear",
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
    if (typeof d.subject === "string") parts.push(`"${d.subject}"`);
    if (typeof d.url === "string") parts.push(d.url);
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
                  <td className="whitespace-nowrap py-2 pr-3">
                    {l.profiles ? nameWithEmail(l.profiles.nickname, l.actor_id) : "—"}
                  </td>
                  <td className="py-2 pr-3 font-semibold">{actionLabel(l.action)}</td>
                  <td className="max-w-64 truncate py-2 pr-3">
                    {l.target ? (
                      targetNames.has(l.target) ? (
                        nameWithEmail(targetNames.get(l.target)!, l.target)
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

      {/* 서버 오류 (자체 에러 모니터링 — migration 0008) */}
      <section aria-labelledby="admin-errors-heading" className="mt-10">
        <h3 id="admin-errors-heading" className="font-display text-xl font-bold">
          {t("logs.errorsTitle")}
        </h3>
        {!errorsMigrated && (
          <p className="mt-3 border-[1.5px] border-dashed border-[var(--color-line)] p-4 text-sm text-[var(--color-ink-soft)]">
            {t("logs.errorsNotMigrated")}
          </p>
        )}
        {errorsMigrated && (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full border-collapse border-y-[1.5px] border-[var(--color-ink)] text-sm">
              <caption className="sr-only">{t("logs.errorsTitle")}</caption>
              <thead>
                <tr className="border-b-[1.5px] border-[var(--color-ink)] text-left">
                  <th scope="col" className="py-2 pr-3 font-bold">{t("logs.colPath")}</th>
                  <th scope="col" className="py-2 pr-3 font-bold">{t("logs.colMessage")}</th>
                  <th scope="col" className="py-2 font-bold">{t("logs.colDate")}</th>
                </tr>
              </thead>
              <tbody>
                {appErrors.map((e) => (
                  <tr key={e.id} className="border-b border-[var(--color-line)] align-top">
                    <td className="max-w-56 py-2 pr-3">
                      <span className="font-semibold">{pathKind(e.path)}</span>
                      <span className="mt-0.5 block break-all font-mono text-xs text-[var(--color-ink-faint)]">
                        {e.method} {e.path}
                      </span>
                    </td>
                    <td className="max-w-96 py-2 pr-3">
                      <span className="font-semibold text-[var(--color-crit)]">{errorKind(e.message)}</span>
                      <span className="mt-0.5 line-clamp-2 block break-all font-mono text-xs text-[var(--color-ink-soft)]">
                        {e.message}
                      </span>
                    </td>
                    <td className="whitespace-nowrap py-2 tabular-nums text-[var(--color-ink-faint)]">
                      {format.dateTime(new Date(e.created_at), { dateStyle: "short", timeStyle: "short" })}
                    </td>
                  </tr>
                ))}
                {appErrors.length === 0 && (
                  <tr>
                    <td colSpan={3} className="py-4 text-sm text-[var(--color-ink-faint)]">
                      {t("logs.errorsEmpty")}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
