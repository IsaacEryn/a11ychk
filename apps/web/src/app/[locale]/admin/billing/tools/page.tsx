import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { requireAdmin } from "@/lib/adminGuard";
import { adminBase } from "@/lib/adminSlug";
import { billingMode, tossKeys } from "@/lib/billing/config";
import { loadEncKey } from "@/lib/billing/crypto";
import { isMissingTable } from "@/lib/billing/dbErrors";
import { createAdminClient } from "@/lib/supabase/admin";
import { AdminLink } from "../../AdminLink";
import { TABLE, TH, TR, TR_HEAD } from "../../tableStyles";
import { BillingSubnav } from "../BillingSubnav";
import { displayStatus } from "../subscriptionStatus";
import { PullDueForm } from "./PullDueForm";
import { RunCycleForm } from "./RunCycleForm";

// "결제 크론 지금 실행"이 이 페이지의 서버 액션으로 돈다 — 결제 크론 라우트와 같은 최대 실행 시간을 준다
export const maxDuration = 300;

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "admin" });
  return { title: `${t("billing.tools.title")} — ${t("billing.title")} — ${t("title")}` };
}

/**
 * 결제 테스트 도구 — 현재 모드와 설정 여부(예·아니요만, 키 값은 출력하지 않는다), 결제 크론 지금 실행,
 * 테스트 구독(livemode=false·toss·진행 중)의 결제일 당기기. 0041 미적용이면 구독 표 대신 안내만 보여 준다.
 */
export default async function AdminBillingToolsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requireAdmin(locale); // 병렬 렌더 누출 방지 — page 자체 가드
  const t = await getTranslations("admin");
  const format = await getFormatter();

  const mode = billingMode();
  const hasTossKeys = tossKeys() !== null;
  const hasEncKey = loadEncKey() !== null;
  const yesNo = (v: boolean) => t(v ? "billing.tools.yes" : "billing.tools.no");

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("subscriptions")
    .select("id, user_id, provider, plan_code, status, current_period_start, current_period_end, grace_until, cancel_at_period_end")
    .eq("provider", "toss")
    .eq("livemode", false)
    .in("status", ["active", "past_due"])
    .order("current_period_end", { ascending: true })
    .limit(100);
  const missing = isMissingTable(error);
  // 0041 미적용(테이블 없음)만 안내로 처리한다. 그 밖의 조회 오류를 "테스트 구독 없음"으로 보여 주면 장애가 가려진다.
  if (error && !missing) throw new Error(`admin billing tools query failed: ${error.message}`);
  const rows = data ?? [];

  // 닉네임 병기
  const userIds = [...new Set(rows.map((r) => r.user_id as string | null).filter(Boolean))] as string[];
  const { data: profiles } =
    userIds.length > 0 ? await admin.from("profiles").select("id, nickname").in("id", userIds) : { data: [] };
  const nickname = new Map((profiles ?? []).map((p) => [p.id as string, (p.nickname as string | null) ?? ""]));
  const nameOf = (userId: string | null) =>
    userId ? nickname.get(userId) || t("billing.noNickname") : t("billing.deletedUser");
  const dateTime = (iso: string) => format.dateTime(new Date(iso), { dateStyle: "short", timeStyle: "short" });

  return (
    <section aria-labelledby="admin-billing-tools-heading" className="mt-8">
      <h2 id="admin-billing-tools-heading" className="font-display text-2xl font-bold">{t("billing.title")}</h2>
      <BillingSubnav current="tools" />

      <section aria-labelledby="admin-billing-tools-state-heading" className="mt-6">
        <h3 id="admin-billing-tools-state-heading" className="font-display text-xl font-bold">{t("billing.tools.stateTitle")}</h3>
        <dl className="mt-3 grid grid-cols-[max-content_1fr] gap-x-6 gap-y-2 text-sm">
          <dt className="font-semibold">{t("billing.tools.mode")}</dt>
          <dd>{t(`billing.tools.modes.${mode}`)}</dd>
          <dt className="font-semibold">{t("billing.tools.tossKeys")}</dt>
          <dd>{yesNo(hasTossKeys)}</dd>
          <dt className="font-semibold">{t("billing.tools.encKey")}</dt>
          <dd>{yesNo(hasEncKey)}</dd>
        </dl>
        <p className="mt-2 text-xs text-[var(--color-ink-faint)]">{t("billing.tools.stateHint")}</p>
      </section>

      <section aria-labelledby="admin-billing-tools-cycle-heading" className="mt-8 border-[1.5px] border-dashed border-[var(--color-line)] p-4">
        <h3 id="admin-billing-tools-cycle-heading" className="font-display text-lg font-bold">{t("billing.tools.cycleTitle")}</h3>
        <p
          id="admin-billing-tools-cycle-hint"
          className={
            mode === "off"
              ? "mt-2 border-l-[3px] border-[var(--color-mark)] bg-[var(--color-warn-tint)] px-4 py-3 text-sm font-medium"
              : "mt-1 text-xs text-[var(--color-ink-faint)]"
          }
        >
          {t(`billing.tools.cycleHint.${mode}`)}
        </p>
        <RunCycleForm requireConfirm={mode === "live"} disabled={mode === "off"} describedBy="admin-billing-tools-cycle-hint" />
      </section>

      <section aria-labelledby="admin-billing-tools-subs-heading" className="mt-8">
        <h3 id="admin-billing-tools-subs-heading" className="font-display text-xl font-bold">{t("billing.tools.subsTitle")}</h3>
        <p className="mt-2 text-sm text-[var(--color-ink-soft)]">{t("billing.tools.subsIntro")}</p>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-[var(--color-ink-soft)]">
          <li>{t("billing.tools.subsItems.charge")}</li>
          <li>{t("billing.tools.subsItems.remind")}</li>
          <li>{t("billing.tools.subsItems.retry")}</li>
        </ul>

        {missing ? (
          <p role="note" className="mt-4 border-l-[3px] border-[var(--color-mark)] bg-[var(--color-warn-tint)] px-4 py-3 text-sm font-medium">
            {t("billing.migrationMissing")}
          </p>
        ) : rows.length === 0 ? (
          <p className="mt-4 border-[1.5px] border-dashed border-[var(--color-line)] p-4 text-[var(--color-ink-faint)]">{t("billing.tools.subsEmpty")}</p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className={TABLE}>
              <caption className="sr-only">{t("billing.tools.subsTitle")}</caption>
              <thead>
                <tr className={TR_HEAD}>
                  <th scope="col" className={TH}>{t("billing.cols.user")}</th>
                  <th scope="col" className={TH}>{t("billing.cols.plan")}</th>
                  <th scope="col" className={TH}>{t("billing.cols.status")}</th>
                  <th scope="col" className={TH}>{t("billing.tools.cols.periodEnd")}</th>
                  <th scope="col" className={TH}><span className="sr-only">{t("billing.tools.cols.actions")}</span></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id as string} className={TR}>
                    <th scope="row" className="py-2 pr-3 text-left font-semibold">
                      <AdminLink href={`${adminBase()}/billing/${r.id}`} className="underline underline-offset-4">
                        {nameOf(r.user_id as string | null)}
                      </AdminLink>
                    </th>
                    <td className="py-2 pr-3">{t(`users.plans.${r.plan_code}`)}</td>
                    <td className="py-2 pr-3">{t(`billing.status.${displayStatus(r)}`)}</td>
                    <td className="whitespace-nowrap py-2 pr-3 tabular-nums">{dateTime(r.current_period_end as string)}</td>
                    <td className="py-2">
                      <PullDueForm subscriptionId={r.id as string} label={nameOf(r.user_id as string | null)} pastDue={r.status === "past_due"} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </section>
  );
}
