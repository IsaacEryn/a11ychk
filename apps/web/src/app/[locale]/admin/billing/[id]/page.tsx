import { notFound } from "next/navigation";
import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { requireAdmin } from "@/lib/adminGuard";
import { adminBase } from "@/lib/adminSlug";
import { UUID_RE } from "@/lib/billing/checkout";
import { isMissingTable } from "@/lib/billing/dbErrors";
import { httpUrl } from "@/lib/billing/httpUrl";
import { amountInMajorUnits } from "@/lib/billing/price";
import { createAdminClient } from "@/lib/supabase/admin";
import { AdminLink } from "../../AdminLink";
import { TABLE, TH, TR, TR_HEAD } from "../../tableStyles";
import { ContractEditForm } from "../ContractEditForm";
import { ContractEndDateForm } from "../ContractEndDateForm";
import { ContractEndForm } from "../ContractEndForm";
import { displayStatus } from "../subscriptionStatus";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "admin" });
  return { title: `${t("billing.title")} — ${t("title")}` };
}

/** 저장 시각(ISO)을 KST 달력 날짜 YYYY-MM-DD로 — 날짜 입력창의 기본값용 */
function toKstDate(iso: string): string {
  return new Date(Date.parse(iso) + 9 * 3600_000).toISOString().slice(0, 10);
}

interface PaymentRow {
  id: string;
  kind: string;
  external_payment_id: string | null;
  status: string;
  amount: number;
  currency: string;
  refunded_amount: number;
  failure_code: string | null;
  receipt_url: string | null;
  requested_at: string;
  approved_at: string | null;
}

interface ContractRow {
  org_name: string | null;
  contract_ref: string | null;
  memo: string | null;
  paid_confirmed_at: string | null;
  tax_invoice_issued_at: string | null;
}

/**
 * 구독 상세 — 요약 정보와, 기관 계약(manual)이면 상세 수정·종료일 변경·즉시 종료 폼.
 * 카드·해외 결제 구독은 결제 내역 표를 읽기 전용으로 보여 준다(환불은 토스 상점관리자에서, 해외 결제는 Polar 대시보드에서).
 * 해외 결제(MoR) 구독은 Polar 구독·고객 id와 마지막으로 반영한 Polar 변경 시각을 보인다. 즉시 종료 같은 관리자 동작은 두지 않는다 —
 * 우리 행만 끝내면 Polar는 계속 청구하고, 끝낸 사유(admin)가 일시정지 표지를 겸해 다음 동기화가 되살린다. 해지·환불은 Polar
 * 대시보드에서 하고, 그 결과는 웹훅·크론 대사가 반영한다. 금액은 행의 통화 단위(USD는 cent)를 바꿔 보인다.
 */
export default async function AdminBillingDetailPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  await requireAdmin(locale); // 병렬 렌더 누출 방지 — page 자체 가드
  if (!UUID_RE.test(id)) notFound();
  const t = await getTranslations("admin");
  const format = await getFormatter();

  const admin = createAdminClient();
  const { data: sub, error } = await admin
    .from("subscriptions")
    .select(
      "id, user_id, provider, mor_provider, external_id, external_customer_id, external_updated_at, plan_code, status, ended_reason, livemode, amount, currency, current_period_start, current_period_end, grace_until, cancel_at_period_end, created_at, billing_contracts(org_name, contract_ref, memo, paid_confirmed_at, tax_invoice_issued_at)",
    )
    .eq("id", id)
    .maybeSingle();
  // 0041 미적용(테이블 없음)도 없는 주소로 취급한다. 그 밖의 조회 오류는 404로 숨기지 않고 오류 화면으로 보낸다.
  if (isMissingTable(error)) notFound();
  if (error) throw new Error(`admin billing detail query failed: ${error.message}`);
  if (!sub) notFound();

  const userId = sub.user_id as string | null;
  const [profileRes, authRes] = userId
    ? await Promise.all([
        admin.from("profiles").select("nickname").eq("id", userId).maybeSingle(),
        admin.auth.admin.getUserById(userId).catch(() => ({ data: null })),
      ])
    : [null, null];
  const nickname = (profileRes?.data?.nickname as string | null | undefined) || t("billing.noNickname");
  const email = authRes?.data?.user?.email ?? null;

  const contract = (() => {
    const c = sub.billing_contracts as unknown;
    return ((Array.isArray(c) ? c[0] : c) ?? null) as ContractRow | null;
  })();

  const periodEnd = sub.current_period_end as string;
  const statusKey = displayStatus(sub);
  const day = (iso: string) => format.dateTime(new Date(iso), { dateStyle: "medium" });
  const isManual = sub.provider === "manual";
  const isMor = sub.provider === "mor";
  const endedReason = sub.ended_reason as string | null;
  /** 행의 통화 단위(KRW는 원, USD는 cent)를 화면 단위로 바꿔 서식을 입힌다 */
  const moneyOf = (n: number, currency: string | null) => {
    const unit = currency === "USD" ? "USD" : "KRW";
    return format.number(amountInMajorUnits(n, unit), { style: "currency", currency: unit });
  };

  // 결제 내역 — 카드·해외 구독만(기관 계약은 결제가 화면 밖에서 일어난다). 0041 미적용은 위에서 이미 404로 갔다
  let payments: PaymentRow[] = [];
  if (!isManual) {
    const { data, error: paymentsError } = await admin
      .from("billing_payments")
      .select("id, kind, external_payment_id, status, amount, currency, refunded_amount, failure_code, receipt_url, requested_at, approved_at")
      .eq("subscription_id", id)
      .order("requested_at", { ascending: false })
      .limit(100);
    if (paymentsError && !isMissingTable(paymentsError)) {
      throw new Error(`admin billing payments query failed: ${paymentsError.message}`);
    }
    payments = (data ?? []) as PaymentRow[];
  }
  const dateTime = (iso: string) => format.dateTime(new Date(iso), { dateStyle: "short", timeStyle: "short" });

  return (
    <section aria-labelledby="admin-billing-detail-heading" className="mt-8">
      <p className="text-sm">
        <AdminLink href={`${adminBase()}/billing`} className="font-semibold underline underline-offset-4">
          <span aria-hidden="true">← </span>
          {t("billing.detail.back")}
        </AdminLink>
      </p>
      <h2 id="admin-billing-detail-heading" className="mt-3 font-display text-2xl font-bold">
        {t("billing.title")}
      </h2>

      <dl className="mt-4 grid grid-cols-[max-content_1fr] gap-x-6 gap-y-2 text-sm">
        <dt className="font-semibold">{t("billing.detail.user")}</dt>
        <dd>
          {userId ? (
            <AdminLink href={`${adminBase()}/users?user=${userId}`} className="font-semibold underline underline-offset-4">
              {nickname}
            </AdminLink>
          ) : (
            "—"
          )}
          {email && <span className="ml-2 text-[var(--color-ink-soft)]">{email}</span>}
          {!sub.livemode && (
            <span className="ml-1.5 rounded-full bg-[var(--color-paper-warm)] px-2 py-0.5 text-xs font-bold text-[var(--color-ink-soft)]">
              {t("billing.testBadge")}
            </span>
          )}
        </dd>
        <dt className="font-semibold">{t("billing.detail.plan")}</dt>
        <dd>{t(`users.plans.${sub.plan_code}`)}</dd>
        <dt className="font-semibold">{t("billing.detail.provider")}</dt>
        <dd>
          {t(`billing.provider.${sub.provider}`)}
          {sub.mor_provider === "polar" && " · Polar"}
        </dd>
        {isMor && (
          <>
            <dt className="font-semibold">{t("billing.detail.externalId")}</dt>
            <dd className="break-all font-mono text-xs">{(sub.external_id as string | null) ?? "—"}</dd>
            <dt className="font-semibold">{t("billing.detail.externalCustomerId")}</dt>
            <dd className="break-all font-mono text-xs">{(sub.external_customer_id as string | null) ?? "—"}</dd>
            <dt className="font-semibold">{t("billing.detail.externalUpdatedAt")}</dt>
            <dd className="tabular-nums">
              {sub.external_updated_at ? dateTime(sub.external_updated_at as string) : "—"}
            </dd>
          </>
        )}
        <dt className="font-semibold">{t("billing.detail.status")}</dt>
        <dd>{t(`billing.status.${statusKey}`)}</dd>
        <dt className="font-semibold">{t("billing.detail.period")}</dt>
        <dd className="tabular-nums">
          {day(sub.current_period_start as string)} ~ {day(periodEnd)}
        </dd>
        {sub.amount != null && (
          <>
            <dt className="font-semibold">{isMor ? t("billing.detail.amountMor") : t("billing.detail.amount")}</dt>
            <dd className="tabular-nums">{moneyOf(sub.amount as number, sub.currency as string | null)}</dd>
          </>
        )}
        {endedReason && (
          <>
            <dt className="font-semibold">{t("billing.detail.endedReason")}</dt>
            <dd>{t(`billing.endedReason.${endedReason}`)}</dd>
          </>
        )}
        <dt className="font-semibold">{t("billing.detail.createdAt")}</dt>
        <dd className="tabular-nums">{day(sub.created_at as string)}</dd>
      </dl>

      {/* 항상 마운트된 상태 안내 — 종료가 성공하면 refresh로 종료 폼이 사라져 폼 안의 성공 메시지가 읽히기 전에 없어진다.
          관리자 종료(ended_reason=admin)만 알린다: 결제 실패·환불 등으로 끝난 구독에 "계약을 종료했습니다"를 읽히지 않으려는 것 */}
      <p role="status" className="sr-only">
        {sub.status === "ended" && sub.ended_reason === "admin" ? t("billing.contract.ended") : ""}
      </p>

      {isManual ? (
        <>
          {/* 상세 행이 없는 고아 계약도 종료할 수 있게, 종료일 변경·즉시 종료는 상세 행과 무관하게 연다 */}
          {contract && (
            <ContractEditForm
              subscriptionId={sub.id as string}
              orgName={contract.org_name ?? ""}
              contractRef={contract.contract_ref}
              memo={contract.memo}
              paidDate={contract.paid_confirmed_at ? toKstDate(contract.paid_confirmed_at) : null}
              taxInvoiceDate={contract.tax_invoice_issued_at ? toKstDate(contract.tax_invoice_issued_at) : null}
            />
          )}
          {sub.status !== "ended" && (
            <>
              <ContractEndDateForm subscriptionId={sub.id as string} endDate={toKstDate(periodEnd)} />
              <ContractEndForm subscriptionId={sub.id as string} />
            </>
          )}
        </>
      ) : (
        <>
          <p className="mt-6 border-[1.5px] border-dashed border-[var(--color-line)] p-4 text-sm text-[var(--color-ink-soft)]">
            {isMor ? t("billing.detail.morNote") : t("billing.detail.nonManual")}
          </p>

          <section aria-labelledby="admin-billing-payments-heading" className="mt-6">
            <h3 id="admin-billing-payments-heading" className="font-display text-lg font-bold">
              {t("billing.payments.title")}
            </h3>
            {payments.length === 0 ? (
              <p className="mt-3 border-[1.5px] border-dashed border-[var(--color-line)] p-4 text-[var(--color-ink-faint)]">
                {t("billing.payments.empty")}
              </p>
            ) : (
              <div className="mt-3 overflow-x-auto">
                <table className={TABLE}>
                  <caption className="sr-only">{t("billing.payments.title")}</caption>
                  <thead>
                    <tr className={TR_HEAD}>
                      <th scope="col" className={TH}>{t("billing.payments.cols.at")}</th>
                      <th scope="col" className={TH}>{t("billing.payments.cols.kind")}</th>
                      <th scope="col" className={TH}>{t("billing.payments.cols.amount")}</th>
                      <th scope="col" className={TH}>{t("billing.payments.cols.status")}</th>
                      <th scope="col" className={TH}>{t("billing.payments.cols.receipt")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {payments.map((p) => {
                      // 영수증 주소는 http(s)일 때만 링크로 — 결제사 응답이라도 javascript: 같은 스킴은 링크로 만들지 않는다
                      const href = httpUrl(p.receipt_url);
                      const money = (n: number) => moneyOf(n, p.currency);
                      return (
                        <tr key={p.id} className={TR}>
                          <th scope="row" className="whitespace-nowrap py-2 pr-3 text-left font-normal tabular-nums">
                            {dateTime(p.approved_at ?? p.requested_at)}
                          </th>
                          <td className="py-2 pr-3">
                            {t(`billing.payments.kind.${p.kind}`)}
                            {isMor && p.external_payment_id && (
                              <span className="block break-all font-mono text-xs text-[var(--color-ink-soft)]">
                                <span className="sr-only">{t("billing.payments.orderId")} </span>
                                {p.external_payment_id}
                              </span>
                            )}
                          </td>
                          <td className="whitespace-nowrap py-2 pr-3 tabular-nums">{money(p.amount)}</td>
                          <td className="py-2 pr-3">
                            {t(`billing.payments.status.${p.status}`)}
                            {p.refunded_amount > 0 && (
                              <span className="ml-1.5 text-xs text-[var(--color-ink-soft)]">
                                {t("billing.payments.refunded", { amount: money(p.refunded_amount) })}
                              </span>
                            )}
                            {p.status === "failed" && p.failure_code && (
                              <span className="ml-1.5 text-xs text-[var(--color-ink-soft)]">({p.failure_code})</span>
                            )}
                          </td>
                          <td className="py-2">
                            {href ? (
                              <a href={href} target="_blank" rel="noopener noreferrer" className="underline underline-offset-4">
                                {t("billing.payments.receipt")}
                                <span className="sr-only"> {t("billing.payments.newWindow")}</span>
                              </a>
                            ) : (
                              <>
                                <span aria-hidden="true">—</span>
                                <span className="sr-only">{t("billing.payments.noReceipt")}</span>
                              </>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            <p className="mt-3 text-xs text-[var(--color-ink-faint)]">{isMor ? t("billing.payments.refundNoteMor") : t("billing.payments.refundNote")}</p>
          </section>
        </>
      )}
    </section>
  );
}
