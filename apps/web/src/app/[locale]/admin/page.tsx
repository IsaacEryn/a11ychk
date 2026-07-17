import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { StatusBadge } from "@/components/StatusBadge";

function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * 24 * 3600_000).toISOString();
}

/** 관리자 대시보드 — 요약 지표 + 최근 항목. 상세 관리는 하위 페이지에서 */
export default async function AdminDashboardPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("admin");
  const tDash = await getTranslations("dashboard");
  const format = await getFormatter();

  const admin = createAdminClient();
  const thirtyDaysAgo = isoDaysAgo(30);

  const [users, scans30d, failed30d, running, openInquiries, recentScans, openList, shotsBytes] = await Promise.all([
    admin.from("profiles").select("id", { count: "exact", head: true }),
    admin.from("scans").select("id", { count: "exact", head: true }).gte("created_at", thirtyDaysAgo),
    admin
      .from("scans")
      .select("id", { count: "exact", head: true })
      .eq("status", "failed")
      .gte("created_at", thirtyDaysAgo),
    admin.from("scans").select("id", { count: "exact", head: true }).in("status", ["queued", "running"]),
    admin.from("inquiries").select("id", { count: "exact", head: true }).eq("status", "open"),
    admin
      .from("scans")
      .select("id, root_url, status, created_at, profiles(nickname)")
      .order("created_at", { ascending: false })
      .limit(5),
    admin
      .from("inquiries")
      .select("id, title, created_at, profiles(nickname)")
      .eq("status", "open")
      .order("created_at", { ascending: false })
      .limit(5),
    // 스크린샷 저장 용량 (0015 미적용이면 null → 지표 숨김)
    admin.rpc("shots_total_bytes").then(
      (r) => r,
      () => ({ data: null }),
    ),
  ]);

  const total30 = scans30d.count ?? 0;
  const failed30 = failed30d.count ?? 0;
  const failedRate = total30 === 0 ? 0 : Math.round((failed30 / total30) * 1000) / 10;

  // 스크린샷 저장 용량 — 전역 예산 700MB 대비 (0015 미적용이면 지표 생략)
  const SHOT_BUDGET_MB = 700;
  const shotsMb = shotsBytes.data != null ? Math.round(Number(shotsBytes.data) / 1024 / 1024) : null;

  const stats = [
    { label: t("stats.users"), value: String(users.count ?? 0), href: "/admin/users" },
    { label: t("stats.scans30d"), value: String(total30), href: "/admin/scans" },
    { label: t("stats.failedRate"), value: `${failedRate}%`, href: "/admin/scans?status=failed", sub: `${failed30}/${total30}` },
    { label: t("stats.running"), value: String(running.count ?? 0), href: "/admin/scans" },
    { label: t("stats.openInquiries"), value: String(openInquiries.count ?? 0), href: "/admin/inquiries" },
    ...(shotsMb != null
      ? [
          {
            label: t("stats.shotsStorage"),
            value: `${shotsMb}MB`,
            href: "/admin/scans",
            sub: `/ ${SHOT_BUDGET_MB}MB (${Math.round((shotsMb / SHOT_BUDGET_MB) * 100)}%)`,
          },
        ]
      : []),
  ];

  return (
    <>
      {/* 요약 지표 */}
      <dl className="mt-8 grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-6">
        {stats.map((s) => (
          <div key={s.label} className="doc-card p-5">
            <dt className="text-sm font-semibold text-[var(--color-ink-soft)]">{s.label}</dt>
            <dd className="font-display mt-1 text-4xl font-extrabold text-[var(--color-seal)]">
              {s.value}
              {s.sub && (
                <span className="ml-1.5 align-middle text-sm font-semibold text-[var(--color-ink-faint)]">{s.sub}</span>
              )}
            </dd>
            <dd className="mt-2">
              <Link href={s.href} className="text-xs font-semibold text-[var(--color-seal)] underline underline-offset-4">
                {t("dashboard.goDetail")}
              </Link>
            </dd>
          </div>
        ))}
      </dl>

      <div className="mt-10 grid gap-8 lg:grid-cols-2">
        {/* 최근 검사 */}
        <section aria-labelledby="admin-recent-scans-heading">
          <div className="flex items-baseline justify-between">
            <h2 id="admin-recent-scans-heading" className="font-display text-xl font-bold">
              {t("dashboard.recentScans")}
            </h2>
            <Link href="/admin/scans" className="text-sm font-semibold text-[var(--color-seal)] underline underline-offset-4">
              {t("dashboard.viewAll")}
            </Link>
          </div>
          <ul className="mt-3 divide-y divide-[var(--color-line)] border-y-[1.5px] border-[var(--color-ink)]">
            {(recentScans.data ?? []).map((s) => (
              <li key={s.id} className="flex items-center gap-3 py-2.5 text-sm">
                <StatusBadge
                  status={s.status}
                  label={tDash(`status.${s.status as "queued" | "running" | "done" | "failed"}`)}
                />
                <span className="min-w-0 flex-1 truncate">{s.root_url}</span>
                <span className="whitespace-nowrap text-xs tabular-nums text-[var(--color-ink-faint)]">
                  {(s.profiles as unknown as { nickname: string } | null)?.nickname} ·{" "}
                  {format.dateTime(new Date(s.created_at), { dateStyle: "short" })}
                </span>
              </li>
            ))}
            {(recentScans.data ?? []).length === 0 && (
              <li className="py-2.5 text-sm text-[var(--color-ink-faint)]">{t("dashboard.empty")}</li>
            )}
          </ul>
        </section>

        {/* 미답변 문의 */}
        <section aria-labelledby="admin-open-inquiries-heading">
          <div className="flex items-baseline justify-between">
            <h2 id="admin-open-inquiries-heading" className="font-display text-xl font-bold">
              {t("stats.openInquiries")}
            </h2>
            <Link
              href="/admin/inquiries"
              className="text-sm font-semibold text-[var(--color-seal)] underline underline-offset-4"
            >
              {t("dashboard.viewAll")}
            </Link>
          </div>
          <ul className="mt-3 divide-y divide-[var(--color-line)] border-y-[1.5px] border-[var(--color-ink)]">
            {(openList.data ?? []).map((q) => (
              <li key={q.id} className="flex items-center gap-3 py-2.5 text-sm">
                <span className="min-w-0 flex-1 truncate font-semibold">{q.title}</span>
                <span className="whitespace-nowrap text-xs tabular-nums text-[var(--color-ink-faint)]">
                  {(q.profiles as unknown as { nickname: string } | null)?.nickname} ·{" "}
                  {format.dateTime(new Date(q.created_at), { dateStyle: "short" })}
                </span>
              </li>
            ))}
            {(openList.data ?? []).length === 0 && (
              <li className="py-2.5 text-sm text-[var(--color-ink-faint)]">{t("dashboard.empty")}</li>
            )}
          </ul>
        </section>
      </div>
    </>
  );
}
