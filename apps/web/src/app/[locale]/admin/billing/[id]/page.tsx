import { notFound } from "next/navigation";
import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { requireAdmin } from "@/lib/adminGuard";
import { adminBase } from "@/lib/adminSlug";
import { createAdminClient } from "@/lib/supabase/admin";
import { AdminLink } from "../../AdminLink";
import { ContractEditForm } from "../ContractEditForm";
import { ContractEndDateForm } from "../ContractEndDateForm";
import { ContractEndForm } from "../ContractEndForm";
import { displayStatus } from "../subscriptionStatus";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "admin" });
  return { title: `${t("billing.title")} — ${t("title")}` };
}

/** 저장 시각(ISO)을 KST 달력 날짜 YYYY-MM-DD로 — 날짜 입력창의 기본값용 */
function toKstDate(iso: string): string {
  return new Date(Date.parse(iso) + 9 * 3600_000).toISOString().slice(0, 10);
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
 * 카드·해외 결제 구독은 결제 연동 뒤에 이 화면에서 다룬다(지금은 읽기 전용 안내).
 */
export default async function AdminBillingDetailPage({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  await requireAdmin(locale); // 병렬 렌더 누출 방지 — page 자체 가드
  if (!UUID.test(id)) notFound();
  const t = await getTranslations("admin");
  const format = await getFormatter();

  const admin = createAdminClient();
  const { data: sub, error } = await admin
    .from("subscriptions")
    .select(
      "id, user_id, provider, plan_code, status, ended_reason, livemode, amount, currency, current_period_start, current_period_end, cancel_at_period_end, created_at, billing_contracts(org_name, contract_ref, memo, paid_confirmed_at, tax_invoice_issued_at)",
    )
    .eq("id", id)
    .maybeSingle();
  // 0041 미적용(테이블 없음)도 없는 주소로 취급한다. 그 밖의 조회 오류는 404로 숨기지 않고 오류 화면으로 보낸다.
  if (error && (error.code === "42P01" || error.code === "PGRST205")) notFound();
  if (error) throw new Error(`admin billing detail query failed: ${error.message}`);
  if (!sub) notFound();

  const userId = sub.user_id as string | null;
  const [profileRes, authRes] = userId
    ? await Promise.all([
        admin.from("profiles").select("nickname").eq("id", userId).maybeSingle(),
        admin.auth.admin.getUserById(userId).catch(() => ({ data: null })),
      ])
    : [null, null];
  const nickname = (profileRes?.data?.nickname as string | null | undefined) ?? "?";
  const email = authRes?.data?.user?.email ?? null;

  const contract = (() => {
    const c = sub.billing_contracts as unknown;
    return ((Array.isArray(c) ? c[0] : c) ?? null) as ContractRow | null;
  })();

  const periodEnd = sub.current_period_end as string;
  const statusKey = displayStatus(sub.status as string, periodEnd);
  const day = (iso: string) => format.dateTime(new Date(iso), { dateStyle: "medium" });
  const isManual = sub.provider === "manual";
  const endedReason = sub.ended_reason as string | null;

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
        <dd>{t(`billing.provider.${sub.provider}`)}</dd>
        <dt className="font-semibold">{t("billing.detail.status")}</dt>
        <dd>{t(`billing.status.${statusKey}`)}</dd>
        <dt className="font-semibold">{t("billing.detail.period")}</dt>
        <dd className="tabular-nums">
          {day(sub.current_period_start as string)} ~ {day(periodEnd)}
        </dd>
        {sub.amount != null && (
          <>
            <dt className="font-semibold">{t("billing.detail.amount")}</dt>
            <dd className="tabular-nums">
              {format.number(sub.amount as number, { style: "currency", currency: (sub.currency as string) || "KRW" })}
            </dd>
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

      {isManual ? (
        contract && (
          <>
            <ContractEditForm
              subscriptionId={sub.id as string}
              orgName={contract.org_name ?? ""}
              contractRef={contract.contract_ref}
              memo={contract.memo}
              paidDate={contract.paid_confirmed_at ? toKstDate(contract.paid_confirmed_at) : null}
              taxInvoiceDate={contract.tax_invoice_issued_at ? toKstDate(contract.tax_invoice_issued_at) : null}
            />
            {sub.status !== "ended" && (
              <>
                <ContractEndDateForm subscriptionId={sub.id as string} endDate={toKstDate(periodEnd)} />
                <ContractEndForm subscriptionId={sub.id as string} />
              </>
            )}
          </>
        )
      ) : (
        <p className="mt-6 border-[1.5px] border-dashed border-[var(--color-line)] p-4 text-sm text-[var(--color-ink-soft)]">
          {t("billing.detail.nonManual")}
        </p>
      )}
    </section>
  );
}
