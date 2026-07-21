import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { redirect } from "next/navigation";
import { Link } from "@/i18n/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCachedUser } from "@/lib/supabase/user";
import { reclaimStaleScans } from "@/lib/scan/reclaimStale";
import { foldHost } from "@/lib/host";
import { checkQuota, getResets, getVerifiedDomainLimit, resolveLimits } from "@/lib/quota";
import { getPlansActive } from "@/lib/appSettings";
import { toggleAutoScan, toggleNotify } from "@/lib/actions";
import { AddDomainForm, DeleteDomainButton } from "./DomainForms";
import { StatusBadge } from "@/components/StatusBadge";
import { TrendChart } from "@/components/TrendChart";
import { DomainVerify } from "./DomainVerify";
import { BadgeEmbed } from "./BadgeEmbed";
import { ScanScheduleControl } from "./ScanScheduleControl";
import { PublicReportControl } from "./PublicReportControl";

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

  // 렌더 스코프 캐시 — 헤더와 getUser 왕복 공유
  const user = await getCachedUser();
  if (!user) redirect(`/${locale}/login`);
  const supabase = await createClient();

  // 좀비 검사 자가 치유 — 제한 시간을 넘긴 running/queued 검사를 failed로 정리해
  // "검사 중" 칩이 영원히 남거나 새 검사가 차단되는 것을 막는다.
  await reclaimStaleScans(createAdminClient(), { userId: user.id });

  const [{ data: profile }, { data: domains }, { data: scans }, { data: trendRows }] = await Promise.all([
    supabase.from("profiles").select("nickname, scan_limit_override").eq("id", user.id).single(),
    supabase.from("domains").select("*").eq("user_id", user.id).order("created_at"),
    supabase.from("scans").select("id, root_url, status, created_at, summary, title:report_meta->>title").eq("user_id", user.id).order("created_at", { ascending: false }).limit(8),
    // 추이용 — summary 전체 대신 점수만 뽑아 가볍게 (최근 완료 검사 60건)
    supabase
      .from("scans")
      .select("id, root_url, created_at, title:report_meta->>title, combined:summary->scores->combined->>rate, auto:summary->>complianceRate, nodes:summary->>totalViolationNodes")
      .eq("user_id", user.id)
      .eq("status", "done")
      .order("created_at", { ascending: false })
      .limit(60),
  ]);

  // 등급별 소유 확인 도메인 수 한도 (실제 요금제 시행 전이라도 배정 등급으로 즉시 적용)
  const verifyLimit = getVerifiedDomainLimit(profile?.scan_limit_override);
  const verifiedCount = (domains ?? []).filter((d) => d.verified).length;
  const atVerifyLimit = verifiedCount >= verifyLimit;

  // 등록 도메인(codeslog.com)과 검사 URL(www.codeslog.com)을 잇도록 www.은 접어서 비교 (lib/host 공용)
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

  // ── 도메인 총괄 — 호스트별 최신 완료 검사 요약 (trendRows 재사용, 추가 쿼리 없음) ──
  const latestByHost = new Map<
    string,
    { host: string; scanId: string; date: string; rate: number; nodes: number }
  >();
  for (const row of trendRows ?? []) {
    const rate = Number(row.combined ?? row.auto);
    if (!Number.isFinite(rate)) continue;
    try {
      const host = foldHost(new URL(row.root_url as string).hostname);
      if (!latestByHost.has(host)) {
        latestByHost.set(host, {
          host,
          scanId: row.id as string,
          date: row.created_at as string,
          rate: Math.round(rate * 10) / 10,
          nodes: Number(row.nodes) || 0,
        });
      }
    } catch {
      /* 건너뜀 */
    }
  }
  const overview = [...latestByHost.values()].sort((a, b) => a.host.localeCompare(b.host));

  // ── 공개 보고서 선택용 — 호스트별 완료 검사 목록 (trendRows 재사용, 도메인당 최근 15건) ──
  const reportsByHost = new Map<string, { id: string; date: string; rate: number; title: string | null }[]>();
  for (const row of trendRows ?? []) {
    const rate = Number(row.combined ?? row.auto);
    if (!Number.isFinite(rate)) continue;
    try {
      const host = foldHost(new URL(row.root_url as string).hostname);
      const list = reportsByHost.get(host) ?? [];
      if (list.length < 15) {
        list.push({
          id: row.id as string,
          date: row.created_at as string,
          rate: Math.round(rate * 10) / 10,
          title: (row.title as string | null) ?? null,
        });
      }
      reportsByHost.set(host, list);
    } catch {
      /* 건너뜀 */
    }
  }
  const autoScanHosts = new Set(
    (domains ?? []).filter((d) => d.auto_scan).map((d) => foldHost((d.hostname as string).toLowerCase())),
  );

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

      {/* 도메인 총괄 — 호스트별 최신 준수율 한눈에 */}
      {overview.length > 0 && (
        <section aria-labelledby="overview-heading" className="mt-10">
          <h2 id="overview-heading" className="font-display text-2xl font-bold">
            {t("overview.title")}
          </h2>
          <p className="mt-1 text-sm text-[var(--color-ink-soft)]">{t("overview.desc")}</p>
          <ul className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {overview.map((o) => (
              <li key={o.host} className="doc-card p-5">
                <div className="flex items-start justify-between gap-2">
                  <span className="break-all font-bold">{o.host}</span>
                  {autoScanHosts.has(o.host) && (
                    <span className="whitespace-nowrap rounded-full border-[1.5px] border-[var(--color-seal)] px-2 py-0.5 text-xs font-bold text-[var(--color-seal)]">
                      {t("overview.autoOn")}
                    </span>
                  )}
                </div>
                <div className="mt-3 flex items-end gap-2">
                  <span
                    className={`font-display text-4xl font-extrabold tabular-nums ${
                      o.rate >= 95 ? "text-[var(--color-seal)]" : o.rate >= 80 ? "" : "text-[var(--color-crit)]"
                    }`}
                  >
                    {o.rate}
                  </span>
                  <span className="pb-1 text-sm text-[var(--color-ink-faint)]">% {t("overview.rate")}</span>
                </div>
                <p className="mt-2 text-sm text-[var(--color-ink-soft)]">{t("overview.nodes", { n: o.nodes })}</p>
                <p className="mt-0.5 text-xs text-[var(--color-ink-faint)]">
                  {t("overview.lastScan", { date: format.dateTime(new Date(o.date), { dateStyle: "medium" }) })}
                </p>
                <Link
                  href={`/scans/${o.scanId}/report`}
                  aria-label={`${o.host} ${t("overview.report")}`}
                  className="mt-3 inline-block text-sm font-bold text-[var(--color-seal)] underline underline-offset-4 hover:text-[var(--color-seal-deep)]"
                >
                  {t("overview.report")} →
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* 도메인 */}
      <section aria-labelledby="domains-heading" className="mt-10">
        <h2 id="domains-heading" className="font-display text-2xl font-bold">
          {t("domains.title")}
        </h2>

        {/* 소유 확인 한도 안내 — 등급별 상한과 현재 사용량, 초과 시 관리자 문의 유도 */}
        <p className="mt-2 text-sm text-[var(--color-ink-soft)]">
          {t("domains.verifyQuota", { count: verifiedCount, limit: verifyLimit })}{" "}
          {atVerifyLimit && (
            <Link href="/inquiries" className="font-semibold text-[var(--color-seal)] underline underline-offset-4">
              {t("domains.verifyQuotaContact")}
            </Link>
          )}
        </p>

        {/* 도메인 추가 — 검증 실패(형식·중복) 피드백 포함 (클라이언트 컴포넌트) */}
        <AddDomainForm />

        {!domains || domains.length === 0 ? (
          <p className="mt-4 border-[1.5px] border-dashed border-[var(--color-line)] p-4 text-[var(--color-ink-faint)]">
            {t("domains.empty")}
          </p>
        ) : (
          <ul className="mt-5 space-y-4">
            {domains.map((d) => (
              <li key={d.id} className="doc-card p-5">
                {/* 모바일: 제목/배지 → 액션을 세로 스택. 데스크톱: 한 줄(액션 우측 정렬) */}
                <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
                  <div className="flex flex-wrap items-center gap-2.5">
                    <span className="font-display text-lg font-bold break-all">{d.hostname}</span>
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
                  </div>
                  {/* 모바일에선 전체 폭 행 → 삭제가 ml-auto로 우측 끝에 분리(오탭 방지) */}
                  <div className="flex flex-wrap items-center gap-2.5 sm:ml-auto">
                    <form action={toggleAutoScan}>
                      <input type="hidden" name="id" value={d.id} />
                      <input type="hidden" name="enabled" value={String(d.auto_scan)} />
                      <button
                        type="submit"
                        className="rounded border-[1.5px] border-[var(--color-line)] px-3 py-1.5 text-sm font-semibold text-[var(--color-ink-soft)] hover:border-[var(--color-seal)] hover:text-[var(--color-seal)]"
                      >
                        {d.auto_scan ? t("domains.autoScanDisable") : t("domains.autoScanEnable")}
                      </button>
                    </form>
                    {d.auto_scan && (
                      <form action={toggleNotify}>
                        <input type="hidden" name="id" value={d.id} />
                        <input type="hidden" name="enabled" value={String(d.notify !== false)} />
                        <button
                          type="submit"
                          aria-pressed={d.notify !== false}
                          className="rounded border-[1.5px] border-[var(--color-line)] px-3 py-1.5 text-sm font-semibold text-[var(--color-ink-soft)] hover:border-[var(--color-seal)] hover:text-[var(--color-seal)]"
                        >
                          {d.notify !== false ? t("domains.notifyDisable") : t("domains.notifyEnable")}
                        </button>
                      </form>
                    )}
                    {/* 파괴적 삭제 — 확인 단계 포함, ml-auto로 오탭 방지 */}
                    <DeleteDomainButton domainId={d.id} hostname={d.hostname as string} />
                  </div>
                </div>
                {/* 정기 검사 주기 설정 + 실행 시점 안내 (자동 검사 켜짐일 때만) */}
                {d.auto_scan && (
                  <ScanScheduleControl domainId={d.id} frequency={(d.scan_frequency as string) ?? "daily"} />
                )}
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
                    <p className="mt-1">{t("domains.verifyIntro")}</p>
                    {/* 초보자 안내: 3가지 중 하나만 하면 됨을 강조 */}
                    <p className="mt-2 rounded border-l-[3px] border-[var(--color-seal)] bg-[var(--color-seal-tint)] px-3 py-2 font-semibold text-[var(--color-ink)]">
                      {t("domains.verifyOnlyOne")}
                    </p>
                    <ul className="mt-3 space-y-3">
                      <li>
                        <p className="font-semibold text-[var(--color-ink)]">{t("domains.verifyFileTitle")}</p>
                        <p className="mt-0.5">{t("domains.verifyFileDesc")}</p>
                        <p className="mt-1">
                          {t("domains.verifyFilePath")}{" "}
                          <code className="break-all rounded bg-[var(--color-paper-warm)] px-1.5 py-0.5 text-[0.85em]">
                            /.well-known/a11ychk-verify.txt
                          </code>
                        </p>
                        <p className="mt-1">
                          {t("domains.verifyFileContent")}{" "}
                          <code className="break-all rounded bg-[var(--color-paper-warm)] px-1.5 py-0.5 text-[0.85em]">
                            {d.verify_token}
                          </code>
                        </p>
                      </li>
                      <li>
                        <p className="font-semibold text-[var(--color-ink)]">{t("domains.verifyMetaTitle")}</p>
                        <p className="mt-0.5">{t("domains.verifyMetaDesc")}</p>
                        <code className="mt-1 block break-all rounded bg-[var(--color-paper-warm)] px-1.5 py-0.5 text-[0.85em]">
                          {`<meta name="a11ychk-verify" content="${d.verify_token}">`}
                        </code>
                      </li>
                      <li>
                        <p className="font-semibold text-[var(--color-ink)]">{t("domains.verifyDnsTitle")}</p>
                        <p className="mt-0.5">{t("domains.verifyDnsDesc")}</p>
                        <code className="mt-1 block break-all rounded bg-[var(--color-paper-warm)] px-1.5 py-0.5 text-[0.85em]">
                          {t("domains.verifyDnsRecord", { host: d.hostname, token: d.verify_token })}
                        </code>
                      </li>
                    </ul>
                    <DomainVerify domainId={d.id} atLimit={atVerifyLimit} limit={verifyLimit} />
                  </div>
                )}
                {d.verified && (
                  <div className="mt-3 border-t border-dashed border-[var(--color-line)] pt-3 text-sm text-[var(--color-ink-soft)]">
                    <p className="mb-2 font-semibold">{t("domains.badgeTitle")}</p>
                    {/* 공개 보고서 지정 — 공개 여부·디렉터리 등재·배지 링크 대상을 한 컨트롤로 */}
                    <PublicReportControl
                      domainId={d.id}
                      publicListed={d.public_listed === true}
                      publicScanId={(d.public_scan_id as string | null) ?? null}
                      reports={reportsByHost.get(foldHost((d.hostname as string).toLowerCase())) ?? []}
                      locale={locale}
                    />
                    {/* 배지 미리보기 + HTML/Markdown 코드 + 복사 (공개 지정 시 지정 보고서로 링크) */}
                    <BadgeEmbed
                      siteUrl={siteUrl}
                      hostname={d.hostname}
                      publicListed={d.public_listed === true}
                      alt={t("domains.badgeAlt")}
                    />
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
          <div className="mt-4 flex flex-col items-start gap-4 border-[1.5px] border-dashed border-[var(--color-line)] p-6">
            <p className="text-[var(--color-ink-soft)]">{t("recent.empty")}</p>
            <Link
              href="/scan"
              className="rounded border-[1.5px] border-[var(--color-seal)] bg-[var(--color-seal)] px-5 py-2.5 font-bold text-[var(--color-paper)]"
            >
              {t("recent.emptyCta")}
            </Link>
          </div>
        ) : (
          <ul className="mt-4 divide-y divide-[var(--color-line)] border-y-[1.5px] border-[var(--color-ink)]">
            {scans.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-3">
                <StatusBadge status={s.status} label={t(`status.${s.status as "queued" | "running" | "done" | "failed"}`)} />
                {/* 보고서 제목을 저장한 검사는 제목 + 주소를 함께 표시 */}
                <span className="min-w-0 flex-1">
                  {typeof s.title === "string" && s.title.trim() ? (
                    <>
                      <span className="block truncate font-medium">{s.title}</span>
                      <span className="block truncate text-xs text-[var(--color-ink-faint)]">{s.root_url}</span>
                    </>
                  ) : (
                    <span className="block truncate font-medium">{s.root_url}</span>
                  )}
                </span>
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
