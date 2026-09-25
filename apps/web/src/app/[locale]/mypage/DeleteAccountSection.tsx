"use client";

import { useActionState, useId, useState } from "react";
import { useTranslations } from "next-intl";
import { deleteAccount, type SaveState } from "@/lib/actions";

/**
 * 회원 탈퇴 — 되돌릴 수 없는 동작이라 접힌 영역 안에 두고, 계정 이메일(없으면 고정 문구)을
 * 직접 입력해야 진행된다. 판정은 서버가 다시 한다(accountDeleteConfirmPhrase).
 *
 * 확인 입력은 제어 컴포넌트다 — 실패 응답만 돌려주는 액션이라 React 19의 폼 자동 리셋이
 * 입력값을 지우면 사용자가 왜 실패했는지 보면서 고칠 수 없다.
 */
export function DeleteAccountSection({ phrase }: { phrase: string }) {
  const t = useTranslations("mypage.account");
  const [state, formAction, pending] = useActionState<SaveState, FormData>(deleteAccount, {});
  const [typed, setTyped] = useState("");
  const inputId = useId();
  const hintId = useId();
  const msgId = useId();

  return (
    <section aria-labelledby="account-heading" className="doc-card mt-10 p-6">
      {/* 제목은 summary 밖에 — summary(버튼 역할) 안의 제목은 보조기기에서 제목으로 인식되지 않는다 */}
      <h2 id="account-heading" className="font-display text-xl font-bold">
        {t("title")}
      </h2>
      <p className="mt-2 text-sm text-[var(--color-ink-soft)]">{t("desc")}</p>
      <details className="mt-3">
        <summary className="cursor-pointer text-sm font-bold text-[var(--color-ink-soft)] hover:text-[var(--color-ink)]">
          {t("open")}
        </summary>
        <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-[var(--color-ink-soft)]">
          <li>{t("deleted")}</li>
          <li>{t("kept")}</li>
          <li>{t("irreversible")}</li>
        </ul>
        <form action={formAction} className="mt-5 max-w-lg">
          <label htmlFor={inputId} className="mb-1 block text-sm font-semibold">
            {t("confirmLabel")}
          </label>
          <p id={hintId} className="mb-2 break-all text-sm text-[var(--color-ink-soft)]">
            {t("confirmHint", { phrase })}
          </p>
          <input
            id={inputId}
            name="confirm"
            type="text"
            required
            autoComplete="off"
            spellCheck={false}
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            aria-describedby={state.error ? `${hintId} ${msgId}` : hintId}
            className="w-full rounded border-[1.5px] border-[var(--color-ink)] bg-[var(--color-paper)] px-3 py-2"
          />
          <button
            type="submit"
            disabled={pending}
            className="mt-3 rounded border-[1.5px] border-[var(--color-crit)] px-4 py-2 font-semibold text-[var(--color-crit)] hover:bg-[var(--color-crit-tint)] disabled:opacity-60"
          >
            {pending ? t("submitting") : t("submit")}
          </button>
          {state.error && (
            <p id={msgId} role="alert" className="mt-2 text-sm font-medium text-[var(--color-crit)]">
              {t(`error.${state.error}` as "error.mismatch" | "error.admin" | "error.active" | "error.failed")}
            </p>
          )}
        </form>
      </details>
    </section>
  );
}
