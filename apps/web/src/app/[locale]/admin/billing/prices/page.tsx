import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { requireAdmin } from "@/lib/adminGuard";
import { isMissingTable } from "@/lib/billing/dbErrors";
import { createAdminClient } from "@/lib/supabase/admin";
import { TABLE, TH, TR, TR_HEAD } from "../../tableStyles";
import { BillingSubnav } from "../BillingSubnav";
import { PriceCreateForm } from "./PriceCreateForm";
import { PriceDeactivateForm } from "./PriceDeactivateForm";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "admin" });
  return { title: `${t("billing.prices.title")} — ${t("billing.title")} — ${t("title")}` };
}

const BADGE = "rounded-full px-2 py-0.5 text-xs font-bold";

/**
 * 가격표 — billing_prices를 보여 주고 추가·비활성화한다. 행은 지우거나 고치지 않는다(불변).
 * 금액을 바꾸려면 이전 가격을 비활성화하고 새 가격을 추가한다.
 * 0041 미적용이면 안내만 보여 준다.
 */
export default async function AdminBillingPricesPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requireAdmin(locale); // 병렬 렌더 누출 방지 — page 자체 가드
  const t = await getTranslations("admin");
  const format = await getFormatter();

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("billing_prices")
    .select("id, plan_code, interval, amount, currency, livemode, active, created_at")
    .order("active", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(200);
  const missing = isMissingTable(error);
  // 0041 미적용(테이블 없음)만 안내로 처리한다. 그 밖의 조회 오류를 "가격 없음"으로 보여 주면 장애가 가려진다.
  if (error && !missing) throw new Error(`admin billing prices query failed: ${error.message}`);
  const rows = data ?? [];

  const day = (iso: string) => format.dateTime(new Date(iso), { dateStyle: "medium" });
  const money = (amount: number, currency: string) => format.number(amount, { style: "currency", currency });
  /** 같은 문구의 버튼을 구분하는 화면 낭독기용 설명 */
  const summaryOf = (r: (typeof rows)[number]) =>
    [
      t(`users.plans.${r.plan_code}`),
      t(`billing.prices.intervals.${r.interval}`),
      t(r.livemode ? "billing.prices.modes.live" : "billing.prices.modes.test"),
      money(r.amount as number, r.currency as string),
    ].join(", ");

  return (
    <section aria-labelledby="admin-billing-prices-heading" className="mt-8">
      <h2 id="admin-billing-prices-heading" className="font-display text-2xl font-bold">{t("billing.title")}</h2>
      <BillingSubnav current="prices" />

      {missing ? (
        <p role="note" className="mt-4 border-l-[3px] border-[var(--color-mark)] bg-[var(--color-warn-tint)] px-4 py-3 text-sm font-medium">
          {t("billing.migrationMissing")}
        </p>
      ) : (
        <>
          <h3 className="mt-6 font-display text-xl font-bold">{t("billing.prices.title")}</h3>
          <p className="mt-2 text-sm text-[var(--color-ink-soft)]">{t("billing.prices.intro")}</p>
          <p className="mt-1 text-sm text-[var(--color-ink-soft)]">{t("billing.prices.deactivateNote")}</p>

          {rows.length === 0 ? (
            <p className="mt-4 border-[1.5px] border-dashed border-[var(--color-line)] p-4 text-[var(--color-ink-faint)]">{t("billing.prices.empty")}</p>
          ) : (
            <div className="mt-4 overflow-x-auto">
              <table className={TABLE}>
                <caption className="sr-only">{t("billing.prices.title")}</caption>
                <thead>
                  <tr className={TR_HEAD}>
                    <th scope="col" className={TH}>{t("billing.prices.cols.plan")}</th>
                    <th scope="col" className={TH}>{t("billing.prices.cols.interval")}</th>
                    <th scope="col" className={TH}>{t("billing.prices.cols.amount")}</th>
                    <th scope="col" className={TH}>{t("billing.prices.cols.mode")}</th>
                    <th scope="col" className={TH}>{t("billing.prices.cols.status")}</th>
                    <th scope="col" className={TH}>{t("billing.prices.cols.createdAt")}</th>
                    <th scope="col" className={TH}><span className="sr-only">{t("billing.prices.cols.actions")}</span></th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id as string} className={TR}>
                      <th scope="row" className="py-2 pr-3 text-left font-semibold">{t(`users.plans.${r.plan_code}`)}</th>
                      <td className="py-2 pr-3">{t(`billing.prices.intervals.${r.interval}`)}</td>
                      <td className="whitespace-nowrap py-2 pr-3 tabular-nums">{money(r.amount as number, r.currency as string)}</td>
                      <td className="py-2 pr-3">
                        {r.livemode ? (
                          <span className={`${BADGE} border border-[var(--color-seal)] text-[var(--color-seal)]`}>{t("billing.prices.modes.live")}</span>
                        ) : (
                          <span className={`${BADGE} bg-[var(--color-paper-warm)] text-[var(--color-ink-soft)]`}>{t("billing.prices.modes.test")}</span>
                        )}
                      </td>
                      <td className="py-2 pr-3">{t(r.active ? "billing.prices.status.active" : "billing.prices.status.inactive")}</td>
                      <td className="whitespace-nowrap py-2 pr-3 tabular-nums">{day(r.created_at as string)}</td>
                      <td className="py-2">
                        <PriceDeactivateForm priceId={r.id as string} summary={summaryOf(r)} active={r.active as boolean} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <section aria-labelledby="admin-billing-price-add-heading" className="mt-8 border-[1.5px] border-dashed border-[var(--color-line)] p-4">
            <h3 id="admin-billing-price-add-heading" className="font-display text-lg font-bold">{t("billing.prices.addTitle")}</h3>
            <p className="mt-1 text-xs text-[var(--color-ink-faint)]">{t("billing.prices.addIntro")}</p>
            <PriceCreateForm />
          </section>
        </>
      )}
    </section>
  );
}
