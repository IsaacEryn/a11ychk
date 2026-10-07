"use client";

import { useTranslations } from "next-intl";
import { updateContract, type SaveState } from "@/lib/actions";
import { FormFeedback } from "@/components/FormFeedback";
import { useAdminAction } from "../useAdminAction";
import { BTN_PRIMARY, FIELD, LABEL, useContractErrors } from "./contractForm";

/** 기관 계약 상세(기관명·계약번호·메모·입금 확인일·세금계산서 발행일) 수정 폼. 날짜는 KST YYYY-MM-DD. */
export function ContractEditForm({
  subscriptionId,
  orgName,
  contractRef,
  memo,
  paidDate,
  taxInvoiceDate,
}: {
  subscriptionId: string;
  orgName: string;
  contractRef: string | null;
  memo: string | null;
  paidDate: string | null;
  taxInvoiceDate: string | null;
}) {
  const t = useTranslations("admin.billing.contract");
  const [state, formAction, pending] = useAdminAction<SaveState, FormData>(updateContract, {});
  const { errors, fallback } = useContractErrors();
  const id = (field: string) => `contract-edit-${field}-${subscriptionId}`;
  const headingId = id("heading");

  return (
    <section aria-labelledby={headingId} className="mt-6 border-[1.5px] border-dashed border-[var(--color-line)] p-4">
      <h3 id={headingId} className="font-display text-lg font-bold">
        {t("editTitle")}
      </h3>
      <form action={formAction} className="mt-3 grid gap-3 sm:grid-cols-2">
        <input type="hidden" name="subscriptionId" value={subscriptionId} />
        <div>
          <label htmlFor={id("org")} className={LABEL}>
            {t("orgName")}
          </label>
          <input
            id={id("org")}
            name="orgName"
            type="text"
            required
            maxLength={200}
            defaultValue={orgName}
            className={FIELD}
          />
        </div>
        <div>
          <label htmlFor={id("ref")} className={LABEL}>
            {t("contractRef")}
          </label>
          <input
            id={id("ref")}
            name="contractRef"
            type="text"
            maxLength={100}
            defaultValue={contractRef ?? ""}
            className={FIELD}
          />
        </div>
        <div>
          <label htmlFor={id("paid")} className={LABEL}>
            {t("paidDate")}
          </label>
          <input id={id("paid")} name="paidDate" type="date" defaultValue={paidDate ?? ""} className={FIELD} />
        </div>
        <div>
          <label htmlFor={id("tax")} className={LABEL}>
            {t("taxInvoiceDate")}
          </label>
          <input
            id={id("tax")}
            name="taxInvoiceDate"
            type="date"
            defaultValue={taxInvoiceDate ?? ""}
            className={FIELD}
          />
        </div>
        <div className="sm:col-span-2">
          <label htmlFor={id("memo")} className={LABEL}>
            {t("memo")}
          </label>
          <textarea id={id("memo")} name="memo" maxLength={2000} rows={3} defaultValue={memo ?? ""} className={FIELD} />
        </div>
        <div className="flex flex-wrap items-center gap-2 sm:col-span-2">
          <button type="submit" disabled={pending} className={BTN_PRIMARY}>
            {pending ? t("saving") : t("save")}
          </button>
          <FormFeedback state={state} okLabel={t("saved")} errors={errors} fallback={fallback} />
        </div>
      </form>
    </section>
  );
}
