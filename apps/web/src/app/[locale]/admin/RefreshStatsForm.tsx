"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { refreshRepoStats, type SaveState } from "@/lib/actions";

/** 저장소 통계 수동 새로고침 — 성공/실패 피드백 제공 (이전엔 실패가 무증상이었음) */
export function RefreshStatsForm() {
  const t = useTranslations("admin.growth");
  const [state, formAction, pending] = useActionState<SaveState, FormData>(refreshRepoStats, {});

  return (
    <form action={formAction} className="flex items-center gap-2">
      <button
        type="submit"
        disabled={pending}
        className="rounded border-[1.5px] border-[var(--color-ink)] px-3 py-1.5 text-sm font-semibold hover:bg-[var(--color-paper-warm)] disabled:opacity-60"
      >
        {pending ? t("refreshing") : t("refresh")}
      </button>
      {state.ok && (
        <span role="status" className="text-xs font-bold text-[var(--color-seal)]">
          ✓ {t("refreshDone")}
        </span>
      )}
      {state.error && (
        <span role="alert" className="text-xs font-bold text-[var(--color-crit)]">
          {t("refreshFailed")}
        </span>
      )}
    </form>
  );
}
