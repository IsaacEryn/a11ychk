"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { setContractEnd, type SaveState } from "@/lib/actions";
import { FormFeedback } from "@/components/FormFeedback";
import { useAdminAction } from "../useAdminAction";
import { BTN_PRIMARY, FIELD, HINT, LABEL, useContractErrors } from "./contractForm";

/**
 * 기관 계약 종료일 변경(연장·단축) 폼. endDate는 현재 종료일(KST YYYY-MM-DD).
 * 입력은 제어 컴포넌트 — 오류(period 등) 뒤에 비제어 입력이 옛 날짜로 되돌아가 오류 문구와 어긋나는 것을 막는다.
 */
export function ContractEndDateForm({ subscriptionId, endDate }: { subscriptionId: string; endDate: string }) {
  const t = useTranslations("admin.billing.contract");
  const [state, formAction, pending] = useAdminAction<SaveState, FormData>(setContractEnd, {});
  const { errors, fallback } = useContractErrors();
  const [value, setValue] = useState(endDate);
  const headingId = `contract-enddate-heading-${subscriptionId}`;
  const inputId = `contract-enddate-${subscriptionId}`;
  const hintId = `contract-enddate-hint-${subscriptionId}`;

  return (
    <section aria-labelledby={headingId} className="mt-6 border-[1.5px] border-dashed border-[var(--color-line)] p-4">
      <h3 id={headingId} className="font-display text-lg font-bold">
        {t("endDateTitle")}
      </h3>
      <form action={formAction} className="mt-3 space-y-3">
        <input type="hidden" name="subscriptionId" value={subscriptionId} />
        <div className="max-w-xs">
          <label htmlFor={inputId} className={LABEL}>
            {t("endDate")}
          </label>
          <input
            id={inputId}
            name="endDate"
            type="date"
            required
            value={value}
            onChange={(e) => setValue(e.target.value)}
            aria-describedby={hintId}
            className={FIELD}
          />
          <p id={hintId} className={HINT}>
            {t("periodHint")}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="submit" disabled={pending} className={BTN_PRIMARY}>
            {t("endDateSubmit")}
          </button>
          <FormFeedback state={state} okLabel={t("endDateSaved")} errors={errors} fallback={fallback} />
        </div>
      </form>
    </section>
  );
}
