import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { requireAdmin } from "@/lib/adminGuard";
import { adminBase } from "@/lib/adminSlug";
import { createAdminClient } from "@/lib/supabase/admin";
import { AdminLink } from "../AdminLink";
import { FILTER_BTN, INPUT, TABLE, TH, TR, TR_HEAD } from "../tableStyles";
import { displayStatus } from "./subscriptionStatus";

const STATUSES = ["active", "past_due", "ended"] as const;
const PROVIDERS = ["toss", "mor", "manual"] as const;

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "admin" });
  return { title: `${t("billing.title")} — ${t("title")}` };
}

/**
 * 결제·계약 목록 — 구독(카드·해외)과 기관 계약을 한 표로. 기본은 진행 중(active·past_due).
 * subscriptions는 service role로 읽는다. 0041 미적용이면 안내만 보여 준다.
 */
export default async function AdminBillingPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ status?: string; provider?: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requireAdmin(locale); // 병렬 렌더 누출 방지 — page 자체 가드
  const t = await getTranslations("admin");
  const format = await getFormatter();
  const sp = await searchParams;
  const status = (STATUSES as readonly string[]).includes(sp.status ?? "") ? sp.status : sp.status === "all" ? "all" : undefined;
  const provider = (PROVIDERS as readonly string[]).includes(sp.provider ?? "") ? sp.provider : undefined;

  const admin = createAdminClient();
  let query = admin
    .from("subscriptions")
    .select("id, user_id, provider, plan_code, status, livemode, current_period_start, current_period_end, cancel_at_period_end, billing_contracts(org_name)")
    .order("created_at", { ascending: false })
    .limit(200);
  if (status === undefined) query = query.in("status", ["active", "past_due"]);
  else if (status !== "all") query = query.eq("status", status);
  if (provider) query = query.eq("provider", provider);
  const { data, error } = await query;
  const missing = error && (error.code === "42P01" || error.code === "PGRST205");
  // 0041 미적용(테이블 없음)만 안내로 처리한다. 그 밖의 조회 오류를 "구독 없음"으로 보여 주면 장애가 가려진다.
  if (error && !missing) throw new Error(`admin billing list query failed: ${error.message}`);
  const rows = data ?? [];

  // 닉네임 병기
  const userIds = [...new Set(rows.map((r) => r.user_id as string | null).filter(Boolean))] as string[];
  const { data: profiles } =
    userIds.length > 0 ? await admin.from("profiles").select("id, nickname").in("id", userIds) : { data: [] };
  const nickname = new Map((profiles ?? []).map((p) => [p.id as string, (p.nickname as string | null) ?? ""]));
  const day = (iso: string) => format.dateTime(new Date(iso), { dateStyle: "short" });
  const orgOf = (r: (typeof rows)[number]) => {
    const c = r.billing_contracts as unknown;
    const one = Array.isArray(c) ? c[0] : c;
    return (one as { org_name?: string } | null)?.org_name ?? "";
  };
  const statusKey = (r: (typeof rows)[number]) => displayStatus(r.status as string, r.current_period_end as string);

  return (
    <section aria-labelledby="admin-billing-heading" className="mt-8">
      <h2 id="admin-billing-heading" className="font-display text-2xl font-bold">{t("billing.title")}</h2>
      <p className="mt-2 text-sm text-[var(--color-ink-soft)]">{t("billing.intro")}</p>

      {missing ? (
        <p role="note" className="mt-4 border-l-[3px] border-[var(--color-mark)] bg-[var(--color-warn-tint)] px-4 py-3 text-sm font-medium">
          {t("billing.migrationMissing")}
        </p>
      ) : (
        <>
          <form method="get" className="mt-4 flex flex-wrap items-end gap-2">
            <div>
              <label htmlFor="billing-status" className="mb-1 block text-sm font-semibold">{t("billing.filters.status")}</label>
              <select id="billing-status" name="status" defaultValue={status ?? ""} className={INPUT}>
                <option value="">{t("billing.status.active")} · {t("billing.status.past_due")}</option>
                {STATUSES.map((s) => <option key={s} value={s}>{t(`billing.status.${s}`)}</option>)}
                <option value="all">{t("billing.filters.all")}</option>
              </select>
            </div>
            <div>
              <label htmlFor="billing-provider" className="mb-1 block text-sm font-semibold">{t("billing.filters.provider")}</label>
              <select id="billing-provider" name="provider" defaultValue={provider ?? ""} className={INPUT}>
                <option value="">{t("billing.filters.all")}</option>
                {PROVIDERS.map((p) => <option key={p} value={p}>{t(`billing.provider.${p}`)}</option>)}
              </select>
            </div>
            <button type="submit" className={FILTER_BTN}>{t("billing.filters.apply")}</button>
          </form>

          {rows.length === 0 ? (
            <p className="mt-4 border-[1.5px] border-dashed border-[var(--color-line)] p-4 text-[var(--color-ink-faint)]">{t("billing.empty")}</p>
          ) : (
            <div className="mt-4 overflow-x-auto">
              <table className={TABLE}>
                <caption className="sr-only">{t("billing.title")}</caption>
                <thead>
                  <tr className={TR_HEAD}>
                    <th scope="col" className={TH}>{t("billing.cols.user")}</th>
                    <th scope="col" className={TH}>{t("billing.cols.plan")}</th>
                    <th scope="col" className={TH}>{t("billing.cols.provider")}</th>
                    <th scope="col" className={TH}>{t("billing.cols.status")}</th>
                    <th scope="col" className={TH}>{t("billing.cols.period")}</th>
                    <th scope="col" className={TH}>{t("billing.cols.org")}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id as string} className={TR}>
                      <th scope="row" className="py-2 pr-3 text-left font-semibold">
                        <AdminLink href={`${adminBase()}/billing/${r.id}`} className="underline underline-offset-4">
                          {r.user_id ? nickname.get(r.user_id as string) || t("billing.noNickname") : "—"}
                        </AdminLink>
                        {!r.livemode && (
                          <span className="ml-1.5 rounded-full bg-[var(--color-paper-warm)] px-2 py-0.5 text-xs font-bold text-[var(--color-ink-soft)]">
                            {t("billing.testBadge")}
                          </span>
                        )}
                      </th>
                      <td className="py-2 pr-3">{t(`users.plans.${r.plan_code}`)}</td>
                      <td className="py-2 pr-3">{t(`billing.provider.${r.provider}`)}</td>
                      <td className="py-2 pr-3">{t(`billing.status.${statusKey(r)}`)}</td>
                      <td className="whitespace-nowrap py-2 pr-3 tabular-nums">
                        {day(r.current_period_start as string)} ~ {day(r.current_period_end as string)}
                      </td>
                      <td className="py-2 pr-3">{orgOf(r)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </section>
  );
}
