import { adminBase } from "@/lib/adminSlug";
import { requireAdmin } from "@/lib/adminGuard";
import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { MAX_CONCURRENT_SCANS } from "@/lib/scan/drain";
import { CRON_STALE_HOURS, isCronStale } from "@/lib/cronRun";
import { collectImpactStats } from "@/lib/impactStats";
import { RefreshStatsForm } from "./RefreshStatsForm";
import { StatusBadge } from "@/components/StatusBadge";

function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * 24 * 3600_000).toISOString();
}

/** ISO 시각으로부터 지금까지 경과한 분(음수 방지). 컴포넌트 본문 밖에서 Date.now 호출 */
function minutesSince(iso: string | null): number {
  if (!iso) return 0;
  return Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
}

/** 관리자 대시보드 — 요약 지표 + 최근 항목. 상세 관리는 하위 페이지에서 */
export default async function AdminDashboardPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requireAdmin(locale); // 병렬 렌더 누출 방지 — page 자체 가드 (layout 가드만으로는 불충분)
  const t = await getTranslations("admin");
  const base = adminBase(); // 슬러그 반영 관리자 기준 경로
  const tDash = await getTranslations("dashboard");
  const format = await getFormatter();

  const admin = createAdminClient();
  const thirtyDaysAgo = isoDaysAgo(30);

  const [
    users,
    scans30d,
    failed30d,
    running,
    runningNow,
    queuedNow,
    oldestQueued,
    openInquiries,
    recentScans,
    openList,
  ] = await Promise.all([
    admin.from("profiles").select("id", { count: "exact", head: true }),
    admin.from("scans").select("id", { count: "exact", head: true }).gte("created_at", thirtyDaysAgo),
    admin
      .from("scans")
      .select("id", { count: "exact", head: true })
      .eq("status", "failed")
      .gte("created_at", thirtyDaysAgo),
    admin.from("scans").select("id", { count: "exact", head: true }).in("status", ["queued", "running"]),
    admin.from("scans").select("id", { count: "exact", head: true }).eq("status", "running"),
    admin.from("scans").select("id", { count: "exact", head: true }).eq("status", "queued"),
    admin.from("scans").select("created_at").eq("status", "queued").order("created_at").limit(1).maybeSingle(),
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
  ]);

  // 성장·확산 지표 (/impact와 동일 집계 — 관리자 모니터링용)
  const growth = await collectImpactStats();

  // ── 크론 실행 상태 (cron_runs, 0030) — 미적용 환경은 조회 실패를 관용해 "기록 없음" 표시 ──
  type CronRunRow = { started_at: string; finished_at: string | null; ok: boolean | null };
  const cronJobs = await Promise.all(
    (["scheduled-scans", "repo-stats"] as const).map(async (job) => {
      const { data } = await admin
        .from("cron_runs")
        .select("started_at, finished_at, ok")
        .eq("job", job)
        .order("started_at", { ascending: false })
        .limit(1)
        .maybeSingle()
        .then(
          (r) => r,
          () => ({ data: null }),
        );
      const run = data as CronRunRow | null;
      return { job, run, stale: isCronStale(run?.started_at ?? null, CRON_STALE_HOURS) };
    }),
  );

  const total30 = scans30d.count ?? 0;
  const failed30 = failed30d.count ?? 0;
  const failedRate = total30 === 0 ? 0 : Math.round((failed30 / total30) * 1000) / 10;

  // ── 동시성 모니터: running/queued 및 최장 대기(가장 오래된 queued) ──
  const runningCount = runningNow.count ?? 0;
  const queuedCount = queuedNow.count ?? 0;
  const oldestWaitMin = minutesSince(oldestQueued.data?.created_at ?? null);
  // 백로그가 쌓이는지 판정: running이 상한에 도달했고 대기가 있으면 포화
  const queueSaturated = queuedCount > 0 && runningCount >= MAX_CONCURRENT_SCANS;

  const stats = [
    { label: t("stats.users"), value: String(users.count ?? 0), href: `${base}/users` },
    { label: t("stats.scans30d"), value: String(total30), href: `${base}/scans` },
    { label: t("stats.failedRate"), value: `${failedRate}%`, href: `${base}/scans?status=failed`, sub: `${failed30}/${total30}` },
    { label: t("stats.running"), value: String(running.count ?? 0), href: `${base}/scans` },
    { label: t("stats.openInquiries"), value: String(openInquiries.count ?? 0), href: `${base}/inquiries` },
  ];

  return (
    <>
      {/* 요약 지표 */}
      <dl className="mt-8 grid grid-cols-2 gap-4 md:grid-cols-5">
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

      {/* 동시성 모니터 — 실행/대기·최장 대기·전역 상한. 부하 진단·수동 개입용 */}
      <section aria-labelledby="admin-queue-heading" className="mt-8 doc-card p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="admin-queue-heading" className="font-display text-xl font-bold">
            {t("queue.title")}
          </h2>
          <span
            className={`rounded-full px-3 py-1 text-xs font-bold ${
              queueSaturated
                ? "bg-[var(--color-warn-tint)] text-[var(--color-ink)]"
                : "bg-[var(--color-seal-tint)] text-[var(--color-seal)]"
            }`}
          >
            {queueSaturated ? t("queue.saturated") : t("queue.healthy")}
          </span>
        </div>
        <dl className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
          {[
            { label: t("queue.running"), value: `${runningCount} / ${MAX_CONCURRENT_SCANS}` },
            { label: t("queue.queued"), value: String(queuedCount) },
            {
              label: t("queue.oldestWait"),
              value: queuedCount > 0 ? t("queue.minutes", { min: oldestWaitMin }) : "—",
            },
            { label: t("queue.max"), value: String(MAX_CONCURRENT_SCANS) },
          ].map((s) => (
            <div key={s.label} className="border-l-[3px] border-[var(--color-seal)] pl-3">
              <dt className="text-sm font-medium text-[var(--color-ink-soft)]">{s.label}</dt>
              <dd className="font-display mt-0.5 text-2xl font-extrabold tabular-nums">{s.value}</dd>
            </div>
          ))}
        </dl>
      </section>

      {/* 정기 작업(크론) 상태 — cron_runs 최근 실행. 26시간 초과 무실행이면 경고색 */}
      <section aria-labelledby="admin-cron-heading" className="mt-8 doc-card p-6">
        <h2 id="admin-cron-heading" className="font-display text-xl font-bold">
          {t("cron.title")}
        </h2>
        <dl className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
          {cronJobs.map(({ job, run, stale }) => {
            const state = !run
              ? { label: t("cron.none"), cls: "text-[var(--color-ink-faint)]" }
              : stale
                ? { label: t("cron.stale"), cls: "text-[var(--color-crit)]" }
                : run.ok === true
                  ? { label: t("cron.ok"), cls: "text-[var(--color-seal)]" }
                  : run.ok === false
                    ? { label: t("cron.fail"), cls: "text-[var(--color-crit)]" }
                    : { label: t("cron.incomplete"), cls: "text-[var(--color-ink-soft)]" };
            return (
              <div
                key={job}
                className={`border-l-[3px] pl-3 ${stale || run?.ok === false ? "border-[var(--color-crit)]" : "border-[var(--color-seal)]"}`}
              >
                <dt className="text-sm font-medium text-[var(--color-ink-soft)]">{t(`cron.jobs.${job}`)}</dt>
                <dd className={`font-display mt-0.5 text-xl font-extrabold ${state.cls}`}>{state.label}</dd>
                <dd className="mt-1 text-xs tabular-nums text-[var(--color-ink-faint)]">
                  {run
                    ? `${t("cron.lastRun")}: ${format.dateTime(new Date(run.started_at), { dateStyle: "short", timeStyle: "short" })}`
                    : t("cron.noneHint")}
                </dd>
              </div>
            );
          })}
        </dl>
      </section>

      {/* 성장·확산 지표 (GitHub·트래픽·확산) */}
      <section aria-labelledby="admin-growth-heading" className="mt-10 doc-card p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="admin-growth-heading" className="font-display text-xl font-bold">
            {t("growth.title")}
          </h2>
          <div className="flex items-center gap-3">
            <Link
              href="/impact"
              className="text-sm font-semibold text-[var(--color-seal)] underline underline-offset-4"
            >
              {t("growth.publicPage")}
            </Link>
            <RefreshStatsForm />
          </div>
        </div>
        <dl className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {[
            { label: t("growth.stars"), value: growth.github ? format.number(growth.github.stars) : "—" },
            { label: t("growth.forks"), value: growth.github ? format.number(growth.github.forks) : "—" },
            { label: t("growth.clones"), value: growth.traffic ? format.number(growth.traffic.clones) : "—" },
            { label: t("growth.views"), value: growth.traffic ? format.number(growth.traffic.views) : "—" },
            { label: t("growth.sites"), value: format.number(growth.sites) },
            { label: t("growth.improved"), value: format.number(growth.improvedSites) },
            { label: t("growth.shared"), value: format.number(growth.sharedReports) },
            { label: t("growth.aiFix"), value: format.number(growth.aiFixDownloads) },
          ].map((s) => (
            <div key={s.label} className="border-l-[3px] border-[var(--color-seal)] pl-3">
              <dt className="text-sm font-medium text-[var(--color-ink-soft)]">{s.label}</dt>
              <dd className="font-display mt-0.5 text-2xl font-extrabold tabular-nums">{s.value}</dd>
            </div>
          ))}
        </dl>
        {growth.traffic && (
          <p className="mt-3 text-xs text-[var(--color-ink-faint)]">
            {t("growth.since", {
              date: format.dateTime(new Date(growth.traffic.since), { dateStyle: "medium" }),
            })}
          </p>
        )}
      </section>

      <div className="mt-10 grid gap-8 lg:grid-cols-2">
        {/* 최근 검사 */}
        <section aria-labelledby="admin-recent-scans-heading">
          <div className="flex items-baseline justify-between">
            <h2 id="admin-recent-scans-heading" className="font-display text-xl font-bold">
              {t("dashboard.recentScans")}
            </h2>
            <Link href={`${base}/scans`} className="text-sm font-semibold text-[var(--color-seal)] underline underline-offset-4">
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
              href={`${base}/inquiries`}
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
