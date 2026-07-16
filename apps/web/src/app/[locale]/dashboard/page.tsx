import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { redirect } from "next/navigation";
import { Link } from "@/i18n/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkQuota, getResets, resolveLimits } from "@/lib/quota";
import { getPlansActive } from "@/lib/appSettings";
import { addDomain, deleteDomain, toggleAutoScan, verifyDomain } from "@/lib/actions";
import { StatusBadge } from "@/components/StatusBadge";
import { TrendChart } from "@/components/TrendChart";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "dashboard" });
  return { title: t("title") };
}

export default async function DashboardPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("dashboard");
  const format = await getFormatter();
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.a11ychk.com";

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/${locale}/login`);

  const [{ data: profile }, { data: domains }, { data: scans }, { data: trendRows }] = await Promise.all([
    supabase.from("profiles").select("nickname, scan_limit_override").eq("id", user.id).single(),
    supabase.from("domains").select("*").eq("user_id", user.id).order("created_at"),
    supabase.from("scans").select("id, root_url, status, created_at, summary").eq("user_id", user.id).order("created_at", { ascending: false }).limit(8),
    // 추이용 — summary 전체 대신 점수만 뽑아 가볍게 (최근 완료 검사 60건)
    supabase
      .from("scans")
      .select("root_url, created_at, combined:summary->scores->combined->>rate, auto:summary->>complianceRate")
      .eq("user_id", user.id)
      .eq("status", "done")
      .order("created_at", { ascending: false })
      .limit(60),
  ]);

  // 호스트별 준수율 추이 (오래된 → 최신, 도메인당 최근 12회)
  // 등록 도메인(codeslog.com)과 검사 URL(www.codeslog.com)을 잇도록 www.은 접어서 비교
  const foldHost = (h: string) => h.replace(/^www\./, "");
  const trendByHost = new Map<string, { date: string; rate: number }[]>();
  for (const row of trendRows ?? []) {
    const rate = Number(row.combined ?? row.auto);
    if (!Number.isFinite(rate)) continue;
    try {
      const host = foldHost(new URL(row.root_url as string).hostname);
      const list = trendByHost.get(host) ?? [];
      if (list.length < 12) list.push({ date: row.created_at as string, rate: Math.round(rate * 10) / 10 });
      trendByHost.set(host, list);
    } catch {
      /* root_url 파싱 실패 — 건너뜀 */
    }
  }
  for (const list of trendByHost.values()) list.reverse();

  const admin = createAdminClient();
  const plansActive = await getPlansActive(admin);
  const quota = await checkQuota(
    admin,
    user.id,
    resolveLimits(profile?.scan_limit_override, plansActive),
    getResets(profile?.scan_limit_override),
  );

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
      <h1 className="font-display text-3xl font-bold">{t("title")}</h1>
      <p className="mt-1 text-[var(--color-ink-soft)]">{t("greeting", { name: profile?.nickname ?? "" })}</p>

      <div className="mt-8 grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        {/* 새 검사 CTA — 검사 수행은 전용 페이지에서 */}
        <section aria-labelledby="scan-cta-heading" className="doc-card flex flex-col justify-between p-6">
          <div>
            <h2 id="scan-cta-heading" className="font-display text-xl font-bold">
              {t("scanCta.title")}
            </h2>
            <p className="mt-2 text-[var(--color-ink-soft)]">{t("scanCta.desc")}</p>
          </div>
          <div className="mt-5 flex flex-wrap gap-3">
            <Link
              href="/scan"
              className="rounded border-[1.5px] border-[var(--color-seal)] bg-[var(--color-seal)] px-6 py-2.5 font-bold text-[var(--color-paper)] shadow-[3px_3px_0_0_var(--color-line)] hover:bg-[var(--color-seal-deep)]"
            >
              {t("scanCta.button")}
            </Link>
            <Link
              href="/extension/connect"
              className="rounded border-[1.5px] border-[var(--color-ink)] px-5 py-2.5 font-semibold hover:bg-[var(--color-paper-warm)]"
            >
              {t("scanForm.extensionLink")}
            </Link>
          </div>
        </section>

        {/* 남은 횟수 */}
        <section aria-labelledby="quota-heading" className="doc-card p-6">
          <h2 id="quota-heading" className="font-display text-xl font-bold">
            {t("quota.title")}
          </h2>
          <dl className="mt-4 space-y-3">
            {(["daily", "weekly", "monthly"] as const).map((key) => (
              <div key={key} className="flex items-center justify-between border-b border-dashed border-[var(--color-line)] pb-2">
                <dt className="font-medium">{t(`quota.${key}`)}</dt>
                <dd className="font-bold tabular-nums">
                  {t("quota.unit", { used: quota.used[key], limit: quota.limits[key] })}
                </dd>
              </div>
            ))}
          </dl>
        </section>
      </div>

      {/* 도메인 */}
      <section aria-labelledby="domains-heading" className="mt-10">
        <h2 id="domains-heading" className="font-display text-2xl font-bold">
          {t("domains.title")}
        </h2>

        <form action={addDomain} className="mt-4 flex max-w-lg flex-wrap items-end gap-2">
          <div className="min-w-52 flex-1">
            <label htmlFor="hostname" className="mb-1 block text-sm font-semibold">
              {t("domains.hostnameLabel")}
            </label>
            <input
              id="hostname"
              name="hostname"
              type="text"
              required
              autoComplete="off"
              inputMode="url"
              className="w-full rounded border-[1.5px] border-[var(--color-ink)] bg-[var(--color-paper)] px-3 py-2"
            />
          </div>
          <button
            type="submit"
            className="rounded border-[1.5px] border-[var(--color-seal)] bg-[var(--color-seal)] px-4 py-2 font-semibold text-[var(--color-paper)] hover:bg-[var(--color-seal-deep)]"
          >
            {t("domains.add")}
          </button>
        </form>

        {!domains || domains.length === 0 ? (
          <p className="mt-4 border-[1.5px] border-dashed border-[var(--color-line)] p-4 text-[var(--color-ink-faint)]">
            {t("domains.empty")}
          </p>
        ) : (
          <ul className="mt-5 space-y-4">
            {domains.map((d) => (
              <li key={d.id} className="doc-card p-5">
                <div className="flex flex-wrap items-center gap-3">
                  <span className="font-display text-lg font-bold">{d.hostname}</span>
                  {d.verified ? (
                    <span className="rounded-full border-[1.5px] border-[var(--color-seal)] px-2.5 py-0.5 text-xs font-bold text-[var(--color-seal)]">
                      ✓ {t("domains.verified")}
                    </span>
                  ) : (
                    <span className="rounded-full border-[1.5px] border-[var(--color-line)] px-2.5 py-0.5 text-xs font-bold text-[var(--color-ink-faint)]">
                      {t("domains.unverified")}
                    </span>
                  )}
                  {d.auto_scan && (
                    <span className="rounded-full bg-[var(--color-seal-tint)] px-2.5 py-0.5 text-xs font-bold text-[var(--color-seal)]">
                      {t("domains.autoScanOn")}
                    </span>
                  )}
                  <div className="ml-auto flex flex-wrap gap-2">
                    <form action={toggleAutoScan}>
                      <input type="hidden" name="id" value={d.id} />
                      <input type="hidden" name="enabled" value={String(d.auto_scan)} />
                      <button
                        type="submit"
                        className="rounded border-[1.5px] border-[var(--color-line)] px-3 py-1 text-sm font-semibold text-[var(--color-ink-soft)] hover:border-[var(--color-seal)] hover:text-[var(--color-seal)]"
                      >
                        {d.auto_scan ? t("domains.autoScanDisable") : t("domains.autoScanEnable")}
                      </button>
                    </form>
                    {!d.verified && (
                      <form action={verifyDomain}>
                        <input type="hidden" name="id" value={d.id} />
                        <button type="submit" className="rounded border-[1.5px] border-[var(--color-seal)] px-3 py-1 text-sm font-semibold text-[var(--color-seal)] hover:bg-[var(--color-seal-tint)]">
                          {t("domains.verify")}
                        </button>
                      </form>
                    )}
                    <form action={deleteDomain}>
                      <input type="hidden" name="id" value={d.id} />
                      <button type="submit" className="rounded border-[1.5px] border-[var(--color-line)] px-3 py-1 text-sm font-semibold text-[var(--color-ink-faint)] hover:border-[var(--color-crit)] hover:text-[var(--color-crit)]">
                        {t("domains.delete")}
                      </button>
                    </form>
                  </div>
                </div>
                {(trendByHost.get(foldHost(d.hostname))?.length ?? 0) >= 2 && (
                  <div className="mt-3 border-t border-dashed border-[var(--color-line)] pt-3">
                    <p className="text-sm font-semibold text-[var(--color-ink-soft)]">{t("domains.trendTitle")}</p>
                    <TrendChart
                      points={trendByHost.get(foldHost(d.hostname))!}
                      label={t("domains.trendLabel", { host: d.hostname })}
                      locale={locale}
                    />
                  </div>
                )}
                {!d.verified && (
                  <div className="mt-3 border-t border-dashed border-[var(--color-line)] pt-3 text-sm text-[var(--color-ink-soft)]">
                    <p className="font-semibold">{t("domains.verifyTitle")}</p>
                    <ol className="mt-1.5 list-decimal space-y-1 pl-5">
                      <li>
                        <code className="break-all rounded bg-[var(--color-paper-warm)] px-1.5 py-0.5 text-[0.85em]">
                          {t("domains.verifyDns", { host: d.hostname, token: d.verify_token })}
                        </code>
                      </li>
                      <li>
                        <code className="break-all rounded bg-[var(--color-paper-warm)] px-1.5 py-0.5 text-[0.85em]">
                          {t("domains.verifyMeta", { token: d.verify_token })}
                        </code>
                      </li>
                    </ol>
                  </div>
                )}
                {d.verified && (
                  <div className="mt-3 border-t border-dashed border-[var(--color-line)] pt-3 text-sm text-[var(--color-ink-soft)]">
                    <p className="mb-2 flex items-center gap-2 font-semibold">
                      {t("domains.badgeTitle")}
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={`/api/badge/${encodeURIComponent(d.hostname)}`} alt={t("domains.badgeAlt")} height={20} />
                    </p>
                    <code className="block break-all rounded bg-[var(--color-paper-warm)] px-2 py-1.5 text-[0.8em]">
                      {`<a href="${siteUrl}/ko"><img src="${siteUrl}/api/badge/${d.hostname}" alt="${t("domains.badgeAlt")}"></a>`}
                    </code>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* 최근 검사 */}
      <section aria-labelledby="recent-heading" className="mt-10">
        <h2 id="recent-heading" className="font-display text-2xl font-bold">
          {t("recent.title")}
        </h2>
        {!scans || scans.length === 0 ? (
          <p className="mt-4 border-[1.5px] border-dashed border-[var(--color-line)] p-4 text-[var(--color-ink-faint)]">
            {t("recent.empty")}
          </p>
        ) : (
          <ul className="mt-4 divide-y divide-[var(--color-line)] border-y-[1.5px] border-[var(--color-ink)]">
            {scans.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-3">
                <StatusBadge status={s.status} label={t(`status.${s.status as "queued" | "running" | "done" | "failed"}`)} />
                <span className="min-w-0 flex-1 truncate font-medium">{s.root_url}</span>
                <time dateTime={s.created_at} className="text-sm tabular-nums text-[var(--color-ink-faint)]">
                  {format.dateTime(new Date(s.created_at), { dateStyle: "medium", timeStyle: "short" })}
                </time>
                <Link
                  href={s.status === "done" ? `/scans/${s.id}/report` : `/scans/${s.id}`}
                  className="text-sm font-bold text-[var(--color-seal)] underline underline-offset-4"
                >
                  {s.status === "done" ? t("recent.viewReport") : t("recent.viewProgress")}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
