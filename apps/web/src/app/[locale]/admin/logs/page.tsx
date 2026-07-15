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
                  <td className="py-2 pr-3">{l.provider}</td>
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
                  <td className="py-2 pr-3 font-mono text-xs">{l.action}</td>
                  <td className="max-w-40 truncate py-2 pr-3 font-mono text-xs">{l.target}</td>
                  <td className="max-w-56 truncate py-2 pr-3 font-mono text-xs">
                    {l.detail ? JSON.stringify(l.detail) : ""}
                  </td>
                  <td className="whitespace-nowrap py-2 tabular-nums text-[var(--color-ink-faint)]">
                    {format.dateTime(new Date(l.created_at), { dateStyle: "short", timeStyle: "medium" })}
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
