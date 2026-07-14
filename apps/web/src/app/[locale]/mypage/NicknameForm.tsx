"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { updateNickname, type NicknameState } from "@/lib/actions";

export function NicknameForm({ defaultNickname }: { defaultNickname: string }) {
  const t = useTranslations("mypage.profile");
  const [state, formAction, pending] = useActionState<NicknameState, FormData>(updateNickname, {});

  return (
    <form action={formAction} className="mt-4">
      <label htmlFor="nickname" className="mb-1 block text-sm font-semibold">
        {t("nickname")}
      </label>
      <div className="flex gap-2">
        <input
          id="nickname"
          name="nickname"
          type="text"
          required
          maxLength={30}
          defaultValue={defaultNickname}
          aria-describedby={state.error ? "nickname-msg" : undefined}
          className="min-w-0 flex-1 rounded border-[1.5px] border-[var(--color-ink)] bg-[var(--color-paper)] px-3 py-2"
        />
        <button
          type="submit"
          disabled={pending}
          className="rounded border-[1.5px] border-[var(--color-seal)] bg-[var(--color-seal)] px-4 py-2 font-semibold text-[var(--color-paper)] hover:bg-[var(--color-seal-deep)] disabled:opacity-60"
        >
          {t("save")}
        </button>
      </div>
      {state.error && (
        <p id="nickname-msg" role="alert" className="mt-2 text-sm font-medium text-[var(--color-crit)]">
          {t(`error.${state.error}` as "error.invalid" | "error.impersonation" | "error.failed")}
        </p>
      )}
      {state.ok && (
        <p id="nickname-msg" role="status" className="mt-2 text-sm font-medium text-[var(--color-seal)]">
          {t("saved")}
        </p>
      )}
    </form>
  );
}
