"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { updateContract, type SaveState } from "@/lib/actions";
import { FormFeedback } from "@/components/FormFeedback";
import { useAdminAction } from "../useAdminAction";
import { BTN_PRIMARY, FIELD, HINT, LABEL, Optional, useContractErrors } from "./contractForm";

/**
 * 기관 계약 상세(기관명·계약번호·메모·입금 확인일·세금계산서 발행일) 수정 폼. 날짜는 KST YYYY-MM-DD.
 * 입력은 제어 컴포넌트 — 제출 뒤 비제어 입력이 초기값으로 되돌아가 오류 때 수정 내용이 사라지는 것을 막는다.
 * 성공하면 refresh가 저장된 값을 props로 내려 주므로 따로 비우지 않는다.
 */
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

  const [org, setOrg] = useState(orgName);
  const [ref, setRef] = useState(contractRef ?? "");
  const [memoText, setMemoText] = useState(memo ?? "");
  const [paid, setPaid] = useState(paidDate ?? "");
  const [tax, setTax] = useState(taxInvoiceDate ?? "");

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
            value={org}
            onChange={(e) => setOrg(e.target.value)}
            className={FIELD}
          />
        </div>
        <div>
          <label htmlFor={id("ref")} className={LABEL}>
            {t("contractRef")}
            <Optional />
          </label>
          <input
            id={id("ref")}
            name="contractRef"
            type="text"
            maxLength={100}
            value={ref}
            onChange={(e) => setRef(e.target.value)}
            className={FIELD}
          />
        </div>
        <div>
          <label htmlFor={id("paid")} className={LABEL}>
            {t("paidDate")}
            <Optional />
          </label>
          <input
            id={id("paid")}
            name="paidDate"
            type="date"
            value={paid}
            onChange={(e) => setPaid(e.target.value)}
            className={FIELD}
          />
        </div>
        <div>
          <label htmlFor={id("tax")} className={LABEL}>
            {t("taxInvoiceDate")}
            <Optional />
          </label>
          <input
            id={id("tax")}
            name="taxInvoiceDate"
            type="date"
            value={tax}
            onChange={(e) => setTax(e.target.value)}
            className={FIELD}
          />
        </div>
        <div className="sm:col-span-2">
          <label htmlFor={id("memo")} className={LABEL}>
            {t("memo")}
            <Optional />
          </label>
          <textarea
            id={id("memo")}
            name="memo"
            maxLength={2000}
            rows={3}
            value={memoText}
            onChange={(e) => setMemoText(e.target.value)}
            aria-describedby={id("memo-hint")}
            className={FIELD}
          />
          <p id={id("memo-hint")} className={HINT}>
            {t("memoHint")}
          </p>
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
