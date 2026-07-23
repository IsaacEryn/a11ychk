import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { redirect } from "next/navigation";
import { Link } from "@/i18n/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  PLAN_RANK,
  checkQuota,
  getEarnedPlan,
  getPlan,
  getResets,
  resolveLimits,
  type PlanId,
} from "@/lib/quota";
import { getPlansActive } from "@/lib/appSettings";
import { ensureReferralCode } from "@/lib/referral/code";
import { REFERRAL_VALID_CAP, REFERRAL_VALID_GOAL } from "@/lib/referral/constants";
import { StatusBadge } from "@/components/StatusBadge";
import { NicknameForm } from "./NicknameForm";
import { PreferredStandardForm } from "./PreferredStandardForm";
import { MissionCard, type ReferralRow } from "./ReferralCard";
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

  const [{ data: profile }, { data: scans }, prefRow] = await Promise.all([
    supabase.from("profiles").select("nickname, scan_limit_override, earned_plan, referral_daily_bonus").eq("id", user.id).single(),
    supabase
      .from("scans")
      .select("id, root_url, status, created_at, summary, title:report_meta->>title")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(50),
    // migration 0017 미적용 시 컬럼 부재로 실패 → null 관용 (별도 쿼리로 격리)
    supabase
      .from("profiles")
      .select("preferred_standard")
      .eq("id", user.id)
      .maybeSingle()
      .then((r) => r, () => ({ data: null })),
  ]);
  const preferredStandard = ((prefRow.data as { preferred_standard?: string } | null)?.preferred_standard ?? null) as
    | "wcag"
    | "kwcag"
    | null;
  const mpAdmin = createAdminClient();
  // 달성 등급·피초대 보너스 (migration 0024 — 컬럼 부재 시 undefined → 기본 동작)
  const earned = getEarnedPlan((profile as { earned_plan?: unknown } | null)?.earned_plan);
  const rawBonus = (profile as { referral_daily_bonus?: unknown } | null)?.referral_daily_bonus;
  const dailyBonus = typeof rawBonus === "number" ? rawBonus : 0;

  const plansActive = await getPlansActive(mpAdmin);
  const quota = await checkQuota(
    mpAdmin,
    user.id,
    resolveLimits(profile?.scan_limit_override, plansActive, earned, dailyBonus),
    getResets(profile?.scan_limit_override),
  );

  // ── 초대 현황 — referrals는 service role 전용(RLS 정책 0)이라 서버에서 admin으로 조회.
  //    코드가 없으면 여기서 lazy 생성. 0024 미적용 환경은 null/빈 목록으로 조용히 비활성.
  const referralCode = await ensureReferralCode(mpAdmin, user.id);
  const { data: referralRows } = await mpAdmin
    .from("referrals")
    .select("id, status, suspect_reason, appeal_note, created_at")
    .eq("referrer_id", user.id)
    .order("created_at", { ascending: false })
    .limit(30)
    .then((r) => r, () => ({ data: null }));
  const referrals: ReferralRow[] = (referralRows ?? []).map((r) => ({
    id: r.id as string,
    status: r.status as ReferralRow["status"],
    suspectReason: (r.suspect_reason as string | null) ?? null,
    appealNote: (r.appeal_note as string | null) ?? null,
    createdAt: r.created_at as string,
  }));
  const referralValidCount = referrals.filter((r) => r.status === "valid").length;
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.a11ychk.com";

  // ── 등급 표시 + 미션 진행 상태 ──
  // 유효 등급 = 배정 등급과 달성 등급 중 서열이 높은 쪽. 프로 미만이면 미션 안내를 노출한다.
  const assignedPlan = getPlan(profile?.scan_limit_override);
  const assignedRank = PLAN_RANK[assignedPlan];
  const earnedRank = earned ? PLAN_RANK[earned] : 0;
  const displayTier: PlanId = earned && earnedRank >= assignedRank ? earned : assignedPlan;
  const showMissions = Math.max(assignedRank, earnedRank) < PLAN_RANK.pro;

  // 미션2 하위 단계 — 도메인 소유확인·보고서 공개 (0024 미적용 시 빈 목록 → 미완)
  const { data: myDomains } = await mpAdmin
    .from("domains")
    .select("verified, public_listed")
    .eq("user_id", user.id)
    .then((r) => r, () => ({ data: null }));
  const mission = {
    m1Done: referralValidCount >= REFERRAL_VALID_GOAL,
    domainVerified: (myDomains ?? []).some((d) => d.verified === true),
    reportPublished: (myDomains ?? []).some((d) => d.public_listed === true),
    m2Done: earned === "plus2",
  };

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
          <PreferredStandardForm defaultValue={preferredStandard} />
          <p className="mt-4 break-all text-sm text-[var(--color-ink-faint)]">{user.email}</p>
        </section>

        {/* 등급 & 검사 사용량 (통합) */}
        <section aria-labelledby="tier-heading" className="doc-card p-6">
          <h2 id="tier-heading" className="font-display text-xl font-bold">
            {t("tier.title")}
          </h2>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-[var(--color-seal-tint)] px-3 py-1 text-sm font-bold text-[var(--color-seal)]">
              {t(`tier.${displayTier}`)}
            </span>
            {dailyBonus > 0 && (
              <span className="text-xs font-semibold text-[var(--color-seal)]">{t("tier.invitedBonus")}</span>
            )}
          </div>
          <p className="mt-4 text-sm font-semibold text-[var(--color-ink-soft)]">{t("usage.title")}</p>
          <dl className="mt-2 space-y-2">
            {(["daily", "weekly", "monthly"] as const).map((key) => (
              <div key={key} className="flex items-center justify-between border-b border-dashed border-[var(--color-line)] pb-1.5">
                <dt className="font-medium">{tDash(`quota.${key}`)}</dt>
                <dd className="font-bold tabular-nums">
                  {tDash("quota.unit", { used: quota.used[key], limit: quota.limits[key] })}
                </dd>
              </div>
            ))}
          </dl>
        </section>
      </div>

      {/* 등급 올리기 — 미션 진행 + 초대 (프로 등급 미만에게만 노출) */}
      {showMissions && (
        <MissionCard
          link={referralCode ? `${siteUrl}/join/${referralCode}` : null}
          validCount={referralValidCount}
          goal={REFERRAL_VALID_GOAL}
          cap={REFERRAL_VALID_CAP}
          mission1Done={mission.m1Done}
          domainVerified={mission.domainVerified}
          reportPublished={mission.reportPublished}
          mission2Done={mission.m2Done}
          rows={referrals}
        />
      )}

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
                      <td className="max-w-72 py-2.5 pr-3">
                        {typeof s.title === "string" && s.title.trim() ? (
                          <>
                            <span className="block truncate font-medium">{s.title}</span>
                            <span className="block truncate text-xs text-[var(--color-ink-faint)]">{s.root_url}</span>
                          </>
                        ) : (
                          <span className="block truncate font-medium">{s.root_url}</span>
                        )}
                      </td>
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
