"use client";

import { useTranslations } from "next-intl";
import { createContract, type SaveState } from "@/lib/actions";
import { FormFeedback } from "@/components/FormFeedback";
import { useAdminAction } from "../useAdminAction";
import { BTN_PRIMARY, FIELD, HINT, LABEL, useContractErrors } from "./contractForm";

/**
 * 기관 계약 등록 폼 (접기형) — 사용자 상세 드로어에 놓인다.
 * 견적·입금·세금계산서는 화면 밖에서 처리하고, 여기서는 기간제 등급과 계약 정보만 기록한다.
 * 입력 id는 사용자별로 유일하게(드로어는 한 번에 한 사용자지만 id 충돌을 구조적으로 막는다).
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
  const id = (field: string) => `contract-${field}-${userId}`;

  return (
    <details className="mt-3 border-[1.5px] border-dashed border-[var(--color-line)] p-3">
      <summary className="cursor-pointer text-xs font-bold text-[var(--color-ink-soft)]">{t("createToggle")}</summary>
      <form action={formAction} className="mt-3 grid gap-3 sm:grid-cols-2">
        <input type="hidden" name="userId" value={userId} />
        <div>
          <label htmlFor={id("plan")} className={LABEL}>
            {t("plan")}
          </label>
          <select id={id("plan")} name="planCode" defaultValue={planOptions[0]?.id} className={FIELD}>
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
          <input id={id("start")} name="startDate" type="date" required className={FIELD} />
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
          <input id={id("org")} name="orgName" type="text" required maxLength={200} className={FIELD} />
        </div>
        <div>
          <label htmlFor={id("ref")} className={LABEL}>
            {t("contractRef")}
          </label>
          <input id={id("ref")} name="contractRef" type="text" maxLength={100} className={FIELD} />
        </div>
        <div>
          <label htmlFor={id("paid")} className={LABEL}>
            {t("paidDate")}
          </label>
          <input id={id("paid")} name="paidDate" type="date" className={FIELD} />
        </div>
        <div>
          <label htmlFor={id("tax")} className={LABEL}>
            {t("taxInvoiceDate")}
          </label>
          <input id={id("tax")} name="taxInvoiceDate" type="date" className={FIELD} />
        </div>
        <div className="sm:col-span-2">
          <label htmlFor={id("memo")} className={LABEL}>
            {t("memo")}
          </label>
          <textarea id={id("memo")} name="memo" maxLength={2000} rows={3} className={FIELD} />
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
