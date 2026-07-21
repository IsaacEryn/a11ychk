"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { addDomain, deleteDomain } from "@/lib/actions";
import type { SaveState } from "@/lib/actions";

/**
 * 도메인 추가 폼 — 검증 실패(형식·중복)를 사용자에게 안내한다.
 * (기존엔 서버 액션이 조용히 return해 "왜 안 되는지" 알 수 없었음)
 */
export function AddDomainForm() {
  const t = useTranslations("dashboard.domains");
  const [state, formAction, pending] = useActionState<SaveState, FormData>(addDomain, {});

  return (
    <div className="mt-4 max-w-lg">
      <form action={formAction} className="flex flex-wrap items-end gap-2">
        <div className="min-w-52 flex-1">
          <label htmlFor="hostname" className="mb-1 block text-sm font-semibold">
            {t("hostnameLabel")}
          </label>
          <input
            id="hostname"
            name="hostname"
            type="text"
            required
            autoComplete="off"
            inputMode="url"
            aria-describedby={state.error ? "add-domain-error" : undefined}
            className="w-full rounded border-[1.5px] border-[var(--color-ink)] bg-[var(--color-paper)] px-3 py-2"
          />
        </div>
        <button
          type="submit"
          disabled={pending}
          className="rounded border-[1.5px] border-[var(--color-seal)] bg-[var(--color-seal)] px-4 py-2 font-semibold text-[var(--color-paper)] hover:bg-[var(--color-seal-deep)] disabled:opacity-60"
        >
          {t("add")}
        </button>
      </form>
      {state.error && (
        <p id="add-domain-error" role="alert" className="mt-2 text-sm font-medium text-[var(--color-crit)]">
          {state.error === "invalid" ? t("addInvalid") : state.error === "duplicate" ? t("addDuplicate") : t("settingFailed")}
        </p>
      )}
    </div>
  );
}

/**
 * 도메인 삭제 — 파괴적 동작이라 확인 단계를 거친다.
 * 소유확인·공개등재·배지가 걸린 도메인이 원클릭으로 사라지는 것을 방지.
 */
export function DeleteDomainButton({ domainId, hostname }: { domainId: string; hostname: string }) {
  const t = useTranslations("dashboard.domains");
  return (
    <form
      action={deleteDomain}
      onSubmit={(e) => {
        if (!window.confirm(t("deleteConfirm", { host: hostname }))) e.preventDefault();
      }}
      className="ml-auto"
    >
      <input type="hidden" name="id" value={domainId} />
      <button
        type="submit"
        className="rounded border-[1.5px] border-[var(--color-line)] px-3 py-1.5 text-sm font-semibold text-[var(--color-ink-faint)] hover:border-[var(--color-crit)] hover:text-[var(--color-crit)]"
      >
        {t("delete")}
      </button>
    </form>
  );
}
