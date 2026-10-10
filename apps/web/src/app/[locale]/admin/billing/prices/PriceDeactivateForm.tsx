"use client";

import { useEffect, useRef } from "react";
import { useTranslations } from "next-intl";
import { deactivatePrice, type SaveState } from "@/lib/actions";
import { FormFeedback } from "@/components/FormFeedback";
import { useAdminAction } from "../../useAdminAction";
import { BTN_DANGER } from "../contractForm";

/** deactivatePrice가 돌려주는 오류 코드 전부 */
const ERROR_CODES = ["invalid", "notFound", "migrationMissing", "failed"] as const;

/**
 * 가격 비활성화 — 표의 행마다 하나. 같은 문구의 버튼이 여러 개라 화면 낭독기용으로 어떤 가격인지 덧붙인다.
 *
 * 성공하면 refresh로 행이 비활성(active=false)이 되고 버튼이 사라진다. 포커스가 있던 버튼이 사라지면
 * 포커스가 문서 맨 앞으로 떨어지므로, 같은 자리에 포커스를 받을 수 있는 성공 안내를 두고 거기로 옮긴다
 * (폼 컴포넌트는 행이 바뀌어도 그대로 마운트되어 있어 성공 상태가 유지된다).
 * 처음부터 비활성이었던 행은 아무것도 그리지 않는다.
 */
export function PriceDeactivateForm({ priceId, summary, active }: { priceId: string; summary: string; active: boolean }) {
  const t = useTranslations("admin.billing.prices");
  const [state, formAction, pending] = useAdminAction<SaveState, FormData>(deactivatePrice, {});
  const doneRef = useRef<HTMLSpanElement>(null);
  const errors = Object.fromEntries(ERROR_CODES.map((c) => [c, t(`errors.${c}`)])) as Record<string, string>;
  const done = !active && state.ok === true;

  useEffect(() => {
    if (done) doneRef.current?.focus();
  }, [done]);

  if (!active) {
    return done ? (
      <span ref={doneRef} role="status" tabIndex={-1} className="text-xs font-bold text-[var(--color-seal)]">
        <span aria-hidden="true">✓</span> {t("deactivated")}
        <span className="sr-only"> ({summary})</span>
      </span>
    ) : null;
  }

  return (
    <form action={formAction} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="priceId" value={priceId} />
      <button type="submit" disabled={pending} className={BTN_DANGER}>
        {pending ? t("deactivating") : t("deactivate")}
        <span className="sr-only"> ({summary})</span>
      </button>
      <FormFeedback state={state} okLabel={t("deactivated")} errors={errors} fallback={errors.failed} />
    </form>
  );
}
