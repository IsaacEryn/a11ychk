"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { adminRetryScan, type SaveState } from "@/lib/actions";
import { FormFeedback } from "@/components/FormFeedback";

/**
 * 실패 검사 관리자 재검사 버튼 — 한도 미차감, 성공 시에만 사용자에게 노출.
 * (0028 미적용 환경에서는 createFailed 오류로 안내됨)
 */
export function AdminRetryForm({ scanId }: { scanId: string }) {
  const t = useTranslations("admin.scans.retry");
  const [state, formAction, pending] = useActionState<SaveState, FormData>(adminRetryScan, {});

  return (
    <form action={formAction} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="id" value={scanId} />
      <button
        type="submit"
        disabled={pending || state.ok}
        className="rounded border-[1.5px] border-[var(--color-line)] px-2.5 py-1 text-xs font-bold text-[var(--color-ink-soft)] hover:border-[var(--color-seal)] hover:text-[var(--color-seal)] disabled:opacity-60"
      >
        {pending ? t("pending") : t("run")}
      </button>
      <FormFeedback
        state={state}
        okLabel={t("started")}
        errors={Object.fromEntries(
          ["userBusy", "notFailed", "notFound", "invalidUrl"].map((c) => [c, t(`errors.${c}`)]),
        )}
        fallback={t("errors.createFailed")}
      />
    </form>
  );
}
