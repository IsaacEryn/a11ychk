"use client";

import { useTranslations } from "next-intl";
import { endContract, type SaveState } from "@/lib/actions";
import { FormFeedback } from "@/components/FormFeedback";
import { useAdminAction } from "../useAdminAction";
import { BTN_DANGER, useContractErrors } from "./contractForm";

/** 기관 계약 즉시 종료 폼 — 한도가 바로 사라지므로 확인 체크박스를 필수로 둔다. */
export function ContractEndForm({ subscriptionId }: { subscriptionId: string }) {
  const t = useTranslations("admin.billing.contract");
  const [state, formAction, pending] = useAdminAction<SaveState, FormData>(endContract, {});
  const { errors, fallback } = useContractErrors();
  const headingId = `contract-end-heading-${subscriptionId}`;
  const hintId = `contract-end-hint-${subscriptionId}`;
  const checkId = `contract-end-confirm-${subscriptionId}`;

  return (
    <section aria-labelledby={headingId} className="mt-6 border-[1.5px] border-dashed border-[var(--color-line)] p-4">
      <h3 id={headingId} className="font-display text-lg font-bold">
        {t("endTitle")}
      </h3>
      <p id={hintId} className="mt-1 text-xs text-[var(--color-ink-faint)]">
        {t("endHint")}
      </p>
      <form action={formAction} className="mt-3 space-y-3">
        <input type="hidden" name="subscriptionId" value={subscriptionId} />
        <label htmlFor={checkId} className="flex items-start gap-2 text-sm font-semibold">
          <input
            id={checkId}
            name="confirm"
            type="checkbox"
            required
            aria-describedby={hintId}
            className="mt-1 size-4 shrink-0 accent-[var(--color-crit)]"
          />
          <span>{t("endConfirm")}</span>
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <button type="submit" disabled={pending} className={BTN_DANGER}>
            {t("endSubmit")}
          </button>
          <FormFeedback state={state} okLabel={t("ended")} errors={errors} fallback={fallback} />
        </div>
      </form>
    </section>
  );
}
