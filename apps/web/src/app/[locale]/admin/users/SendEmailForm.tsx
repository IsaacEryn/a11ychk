"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { sendUserEmail, type SaveState } from "@/lib/actions";

/** 관리자 → 사용자 메일 발송 폼 (접기형) — 발송 상태를 즉시 보여준다 */
export function SendEmailForm({ userId }: { userId: string }) {
  const t = useTranslations("admin.users.email");
  const [state, formAction, pending] = useActionState<SaveState, FormData>(sendUserEmail, {});

  return (
    <details className="mt-2 border-[1.5px] border-dashed border-[var(--color-line)] p-3">
      <summary className="cursor-pointer text-xs font-bold text-[var(--color-ink-soft)]">
        {t("toggle")}
      </summary>
      <form action={formAction} className="mt-3 space-y-2">
        <input type="hidden" name="userId" value={userId} />
        <div>
          <label htmlFor={`email-subject-${userId}`} className="mb-1 block text-xs font-semibold">
            {t("subject")}
          </label>
          <input
            id={`email-subject-${userId}`}
            name="subject"
            type="text"
            required
            maxLength={200}
            className="w-full rounded border-[1.5px] border-[var(--color-line)] bg-[var(--color-paper)] px-2 py-1.5 text-xs"
          />
        </div>
        <div>
          <label htmlFor={`email-body-${userId}`} className="mb-1 block text-xs font-semibold">
            {t("body")}
          </label>
          <textarea
            id={`email-body-${userId}`}
            name="body"
            required
            maxLength={5000}
            rows={5}
            className="w-full rounded border-[1.5px] border-[var(--color-line)] bg-[var(--color-paper)] px-2 py-1.5 text-xs"
          />
        </div>
        <div className="flex items-center gap-2">
          <button
            type="submit"
            disabled={pending}
            className="rounded border-[1.5px] border-[var(--color-seal)] bg-[var(--color-seal)] px-3 py-1.5 text-xs font-bold text-[var(--color-paper)] hover:bg-[var(--color-seal-deep)] disabled:opacity-60"
          >
            {pending ? t("sending") : t("send")}
          </button>
          {state.ok && (
            <span role="status" className="text-xs font-bold text-[var(--color-seal)]">
              ✓ {t("sent")}
            </span>
          )}
          {state.error && (
            <span role="alert" className="text-xs font-bold text-[var(--color-crit)]">
              {t(`errors.${["invalid", "noEmail", "sendFailed"].includes(state.error) ? state.error : "sendFailed"}`)}
            </span>
          )}
        </div>
      </form>
    </details>
  );
}
