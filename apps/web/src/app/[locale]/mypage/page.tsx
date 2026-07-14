import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { redirect } from "next/navigation";
import { Link } from "@/i18n/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkQuota, getResets, resolveLimits } from "@/lib/quota";
import { StatusBadge } from "@/components/StatusBadge";
import { NicknameForm } from "./NicknameForm";
import type { ScanSummary } from "@a11ychk/core/catalog";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "mypage" });
  return { title: t("title") };
}

export default async function MyPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("mypage");
  const tDash = await getTranslations("dashboard");
  const format = await getFormatter();

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/${locale}/login`);

  const [{ data: profile }, { data: scans }] = await Promise.all([
    supabase.from("profiles").select("nickname, scan_limit_override").eq("id", user.id).single(),
    supabase
      .from("scans")
      .select("id, root_url, status, created_at, summary")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(50),
  ]);
  const quota = await checkQuota(
    createAdminClient(),
    user.id,
    resolveLimits(profile?.scan_limit_override),
    getResets(profile?.scan_limit_override),
  );

  return (
    <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6">
      <h1 className="font-display text-3xl font-bold">{t("title")}</h1>

      <div className="mt-8 grid gap-6 sm:grid-cols-2">
        {/* 프로필 */}
        <section aria-labelledby="profile-heading" className="doc-card p-6">
          <h2 id="profile-heading" className="font-display text-xl font-bold">
            {t("profile.title")}
          </h2>
          <NicknameForm defaultNickname={profile?.nickname ?? ""} />
          <p className="mt-4 break-all text-sm text-[var(--color-ink-faint)]">{user.email}</p>
        </section>

        {/* 사용량 */}
        <section aria-labelledby="usage-heading" className="doc-card p-6">
          <h2 id="usage-heading" className="font-display text-xl font-bold">
            {t("usage.title")}
          </h2>
          <dl className="mt-4 space-y-3">
            {(["daily", "weekly", "monthly"] as const).map((key) => (
              <div key={key} className="flex items-center justify-between border-b border-dashed border-[var(--color-line)] pb-2">
                <dt className="font-medium">{tDash(`quota.${key}`)}</dt>
                <dd className="font-bold tabular-nums">
                  {tDash("quota.unit", { used: quota.used[key], limit: quota.limits[key] })}
                </dd>
              </div>
            ))}
          </dl>
        </section>
      </div>

      {/* 검사 이력 */}
      <section aria-labelledby="history-heading" className="mt-10">
        <h2 id="history-heading" className="font-display text-2xl font-bold">
          {t("history.title")}
        </h2>
        {!scans || scans.length === 0 ? (
          <p className="mt-4 border-[1.5px] border-dashed border-[var(--color-line)] p-4 text-[var(--color-ink-faint)]">
            {t("history.empty")}
          </p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full border-collapse border-y-[1.5px] border-[var(--color-ink)] text-sm">
              <caption className="sr-only">{t("history.title")}</caption>
              <thead>
                <tr className="border-b-[1.5px] border-[var(--color-ink)] text-left">
                  <th scope="col" className="py-2 pr-3 font-bold">{t("history.colUrl")}</th>
                  <th scope="col" className="py-2 pr-3 font-bold">{t("history.colDate")}</th>
                  <th scope="col" className="py-2 pr-3 font-bold">{t("history.colStatus")}</th>
                  <th scope="col" className="py-2 font-bold">{t("history.colResult")}</th>
                </tr>
              </thead>
              <tbody>
                {scans.map((s) => {
                  const summary = s.summary as ScanSummary | null;
                  return (
                    <tr key={s.id} className="border-b border-[var(--color-line)]">
                      <td className="max-w-72 truncate py-2.5 pr-3 font-medium">{s.root_url}</td>
                      <td className="whitespace-nowrap py-2.5 pr-3 tabular-nums text-[var(--color-ink-faint)]">
                        {format.dateTime(new Date(s.created_at), { dateStyle: "short", timeStyle: "short" })}
                      </td>
                      <td className="py-2.5 pr-3">
                        <StatusBadge status={s.status} label={tDash(`status.${s.status as "queued" | "running" | "done" | "failed"}`)} />
                      </td>
                      <td className="py-2.5">
                        {s.status === "done" ? (
                          <Link href={`/scans/${s.id}/report`} className="font-bold text-[var(--color-seal)] underline underline-offset-4">
                            {summary ? t("history.complianceShort", { rate: summary.complianceRate }) : tDash("recent.viewReport")}
                          </Link>
                        ) : (
                          <Link href={`/scans/${s.id}`} className="underline underline-offset-4">
                            {tDash("recent.viewProgress")}
                          </Link>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
