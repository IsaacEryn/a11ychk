"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { createContract, type SaveState } from "@/lib/actions";
import { FormFeedback } from "@/components/FormFeedback";
import { useAdminAction } from "../useAdminAction";
import { BTN_PRIMARY, FIELD, HINT, LABEL, Optional, useContractErrors, useManualSubmit } from "./contractForm";

type Values = {
  planCode: string;
  amount: string;
  startDate: string;
  endDate: string;
  orgName: string;
  contractRef: string;
  paidDate: string;
  taxInvoiceDate: string;
  memo: string;
};

/**
 * 기관 계약 등록 폼 (접기형) — 사용자 상세 드로어에 놓인다.
 * 견적·입금·세금계산서는 화면 밖에서 처리하고, 여기서는 기간제 등급과 계약 정보만 기록한다.
 * 입력 id는 사용자별로 유일하게(드로어는 한 번에 한 사용자지만 id 충돌을 구조적으로 막는다).
 *
 * 입력은 제어 컴포넌트이고 제출은 수동(useManualSubmit)이다 — React 19의 <form action> 자동 reset은 제어 입력도
 * 완전히 지키지 못하므로(select는 첫 옵션으로, 포커스된 number는 빈 값으로), 오류(hasActive·period 등)가 났을 때
 * 9개 값이 그대로 남도록 자동 reset을 피하고, 등록에 성공했을 때만 처음 값으로 되돌린다.
 */
export function ContractCreateForm({
  userId,
  planOptions,
}: {
  userId: string;
  planOptions: { id: string; label: string }[];
}) {
  const t = useTranslations("admin.billing.contract");
  const [state, formAction, pending] = useAdminAction<SaveState, FormData>(createContract, {});
  const { errors, fallback } = useContractErrors();
  const onSubmit = useManualSubmit(formAction);
  const id = (field: string) => `contract-${field}-${userId}`;

  const initial: Values = {
    planCode: planOptions[0]?.id ?? "",
    amount: "",
    startDate: "",
    endDate: "",
    orgName: "",
    contractRef: "",
    paidDate: "",
    taxInvoiceDate: "",
    memo: "",
  };
  const [values, setValues] = useState<Values>(initial);
  const set = (key: keyof Values) => (e: { target: { value: string } }) =>
    setValues((v) => ({ ...v, [key]: e.target.value }));

  // 제출 결과가 새로 오면(useActionState는 제출마다 새 객체를 준다) 성공한 경우에만 입력을 비운다
  const [seen, setSeen] = useState(state);
  if (state !== seen) {
    setSeen(state);
    if (state.ok) setValues(initial);
  }

  return (
    <details className="mt-3 border-[1.5px] border-dashed border-[var(--color-line)] p-3">
      <summary className="cursor-pointer text-xs font-bold text-[var(--color-ink-soft)]">{t("createToggle")}</summary>
      <form method="post" onSubmit={onSubmit} className="mt-3 grid gap-3 sm:grid-cols-2">
        <input type="hidden" name="userId" value={userId} />
        <div>
          <label htmlFor={id("plan")} className={LABEL}>
            {t("plan")}
          </label>
          <select id={id("plan")} name="planCode" value={values.planCode} onChange={set("planCode")} className={FIELD}>
            {planOptions.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor={id("amount")} className={LABEL}>
            {t("amount")}
          </label>
          <input
            id={id("amount")}
            name="amount"
            type="number"
            required
            min={0}
            step={1}
            inputMode="numeric"
            value={values.amount}
            onChange={set("amount")}
            aria-describedby={id("amount-hint")}
            className={FIELD}
          />
          <p id={id("amount-hint")} className={HINT}>
            {t("amountHint")}
          </p>
        </div>
        <div>
          <label htmlFor={id("start")} className={LABEL}>
            {t("startDate")}
          </label>
          <input
            id={id("start")}
            name="startDate"
            type="date"
            required
            value={values.startDate}
            onChange={set("startDate")}
            className={FIELD}
          />
        </div>
        <div>
          <label htmlFor={id("end")} className={LABEL}>
            {t("endDate")}
          </label>
          <input
            id={id("end")}
            name="endDate"
            type="date"
            required
            value={values.endDate}
            onChange={set("endDate")}
            aria-describedby={id("period-hint")}
            className={FIELD}
          />
          <p id={id("period-hint")} className={HINT}>
            {t("periodHint")}
          </p>
        </div>
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
            value={values.orgName}
            onChange={set("orgName")}
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
            value={values.contractRef}
            onChange={set("contractRef")}
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
            value={values.paidDate}
            onChange={set("paidDate")}
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
            value={values.taxInvoiceDate}
            onChange={set("taxInvoiceDate")}
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
            value={values.memo}
            onChange={set("memo")}
            aria-describedby={id("memo-hint")}
            className={FIELD}
          />
          <p id={id("memo-hint")} className={HINT}>
            {t("memoHint")}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 sm:col-span-2">
          <button type="submit" disabled={pending} className={BTN_PRIMARY}>
            {pending ? t("creating") : t("create")}
          </button>
          <FormFeedback state={state} okLabel={t("created")} errors={errors} fallback={fallback} />
        </div>
      </form>
    </details>
  );
}
