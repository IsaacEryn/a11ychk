import { getFormatter, getTranslations } from "next-intl/server";
import { setUserLimits, toggleBlockUser } from "@/lib/actions";
import {
  MAX_PAGES_PER_SCAN,
  TIERS,
  ASSIGNABLE_PLAN_IDS,
  getCustomLimits,
  getCustomPages,
  getCustomInt,
  getPlan,
  getEarnedPlan,
  getOverrideUntil,
  isOverrideExpired,
} from "@/lib/quota";
import { resolveEntitlement, type SubscriptionGrantRow } from "@/lib/entitlements";
import { QuotaResetForm } from "../QuotaResetForm";
import { UserLimitsForm } from "../UserLimitsForm";
import { SendEmailForm } from "./SendEmailForm";

export interface UserProfileRow {
  id: string;
  nickname: string;
  role: string;
  blocked: boolean;
  created_at: string;
  scan_limit_override: unknown;
  earned_plan?: unknown;
  referral_daily_bonus?: unknown;
}

/**
 * 사용자 상세 (드로어 본문) — 헤더 + 한도·초기화·차단·메일 폼.
 * 액션들의 revalidateLocalized("/admin/users")가 현재 URL(?user= 포함)을
 * 재검증하므로 저장 후 값 갱신에 추가 배선이 필요 없다.
 */
export async function UserDetail({
  u,
  email,
  extUsedToday,
  subscriptions,
}: {
  u: UserProfileRow;
  email: string | null;
  extUsedToday: number;
  /** 권한 근거 후보 구독(진행 중인 행) */
  subscriptions: SubscriptionGrantRow[];
}) {
  const t = await getTranslations("admin");
  const tDash = await getTranslations("dashboard");
  const format = await getFormatter();

  const plan = getPlan(u.scan_limit_override);
  const earned = getEarnedPlan(u.earned_plan);
  const ent = resolveEntitlement(u, subscriptions);
  // 관리자 개별 지정 확장 한도 — 없으면 undefined(등급 기본 사용)
  const extOverride = getCustomInt(u.scan_limit_override, "extDaily");

  return (
    <div className="mt-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-full bg-[var(--color-paper-warm)] px-2 py-0.5 text-xs font-semibold text-[var(--color-ink-soft)]">
          {u.role}
        </span>
        {u.blocked && (
          <span className="rounded-full bg-[var(--color-crit-tint)] px-2 py-0.5 text-xs font-bold text-[var(--color-crit)]">
            {t("users.blockedBadge")}
          </span>
        )}
        {earned && (
          <span className="rounded-full bg-[var(--color-seal-tint)] px-2 py-0.5 text-xs font-bold text-[var(--color-seal)]">
            {t(`users.earned.${earned}`)}
          </span>
        )}
      </div>
      <dl className="mt-3 space-y-1 text-sm text-[var(--color-ink-soft)]">
        {email && (
          <div className="flex gap-2">
            <dt className="font-semibold">{t("logs.colEmail")}</dt>
            <dd>{email}</dd>
          </div>
        )}
        <div className="flex gap-2">
          <dt className="font-semibold">{t("users.colJoined")}</dt>
          <dd className="tabular-nums">{format.dateTime(new Date(u.created_at), { dateStyle: "short" })}</dd>
        </div>
        <div className="flex gap-2">
          <dt className="font-semibold">{t("users.colExt")}</dt>
          <dd className="tabular-nums">
            {extUsedToday} / {ent.limits.extDaily}
          </dd>
        </div>
        <div className="flex gap-2">
          <dt className="font-semibold">{t("users.grantsLabel")}</dt>
          <dd>
            {ent.grants
              .map((g) => {
                const tier = g.source === "earned" ? t(`users.earned.${g.tier}`) : t(`users.plans.${g.tier}`);
                const until = g.until ? ` ~${format.dateTime(new Date(g.until), { dateStyle: "short" })}` : "";
                return `${t(`users.grantSource.${g.source}`)} ${tier}${until}`;
              })
              .join(" · ")}
          </dd>
        </div>
      </dl>

      {/* 요금제·개별 한도 설정 */}
      <UserLimitsForm
        action={setUserLimits}
        userId={u.id}
        currentPlan={plan}
        custom={getCustomLimits(u.scan_limit_override)}
        customPages={getCustomPages(u.scan_limit_override)}
        customExtDaily={extOverride}
        customUntil={getOverrideUntil(u.scan_limit_override)?.slice(0, 10)}
        untilExpired={isOverrideExpired(u.scan_limit_override)}
        extDailyDefault={TIERS[plan].extDaily}
        effective={ent.limits}
        maxPages={MAX_PAGES_PER_SCAN}
        planOptions={ASSIGNABLE_PLAN_IDS.map((p) => ({
          id: p,
          label: t(`users.plans.${p}`),
          limits: TIERS[p],
          sampleSize: TIERS[p].sampleUnverified,
        }))}
        labels={{
          plan: t("users.planLabel"),
          daily: tDash("quota.daily"),
          weekly: tDash("quota.weekly"),
          monthly: tDash("quota.monthly"),
          pages: t("users.pagesLabel"),
          until: t("users.untilLabel"),
          untilHint: t("users.untilHint"),
          untilExpired: t("users.untilExpired"),
          pagesHint: t("users.pagesHint", { max: MAX_PAGES_PER_SCAN }),
          extDaily: t("users.extDailyLabel"),
          save: t("users.saveLimits"),
          customHint: t("users.customHint"),
          effective: t("users.effective"),
        }}
      />

      {/* 초기화 · 차단 */}
      <div className="mt-3 flex flex-wrap items-end gap-2 border-t border-dashed border-[var(--color-line)] pt-3">
        <QuotaResetForm userId={u.id} />
        {u.role !== "admin" && (
          <form action={toggleBlockUser} className="ml-auto">
            <input type="hidden" name="id" value={u.id} />
            <input type="hidden" name="blocked" value={String(u.blocked)} />
            <button
              type="submit"
              className={`rounded border-[1.5px] px-3 py-1.5 text-xs font-bold ${
                u.blocked
                  ? "border-[var(--color-seal)] text-[var(--color-seal)] hover:bg-[var(--color-seal-tint)]"
                  : "border-[var(--color-crit)] text-[var(--color-crit)] hover:bg-[var(--color-crit-tint)]"
              }`}
            >
              {u.blocked ? t("users.unblock") : t("users.block")}
            </button>
          </form>
        )}
      </div>

      {/* 메일 보내기 (접기형) */}
      <SendEmailForm userId={u.id} />
    </div>
  );
}
