"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { resetQuota, type ResetQuotaState } from "@/lib/actions";

/** 사용자 한도 초기화 폼 — 실행 중/성공/실패 상태를 즉시 보여준다 */
export function QuotaResetForm({ userId }: { userId: string }) {
  const t = useTranslations("admin.users");
  const [state, formAction, pending] = useActionState<ResetQuotaState, FormData>(resetQuota, {});

  return (
    <form action={formAction} className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="id" value={userId} />
      <div>
        <label htmlFor={`scope-${userId}`} className="mb-1 block text-xs font-semibold">
          {t("resetScopeLabel")}
        </label>
        <select
          id={`scope-${userId}`}
          name="scope"
          defaultValue="all"
          className="rounded border-[1.5px] border-[var(--color-line)] bg-[var(--color-paper)] px-2 py-1.5 text-xs"
        >
          <option value="all">{t("resetScope.all")}</option>
          <option value="daily">{t("resetScope.daily")}</option>
          <option value="weekly">{t("resetScope.weekly")}</option>
          <option value="monthly">{t("resetScope.monthly")}</option>
          <option value="extension">{t("resetScope.extension")}</option>
        </select>
      </div>
      <button
        type="submit"
        disabled={pending}
        className="rounded border-[1.5px] border-[var(--color-line)] px-3 py-1.5 text-xs font-bold text-[var(--color-ink-soft)] hover:border-[var(--color-seal)] hover:text-[var(--color-seal)] disabled:opacity-60"
      >
        {pending ? t("resetPending") : t("resetApply")}
      </button>
      {state.ok && state.resetScope && (
        <span role="status" className="text-xs font-bold text-[var(--color-seal)]">
          ✓ {t("resetDone", { scope: t(`resetScope.${state.resetScope}`) })}
        </span>
      )}
      {state.error && (
        <span role="alert" className="text-xs font-bold text-[var(--color-crit)]">
          {t("resetFailed")}
        </span>
      )}
    </form>
  );
}
