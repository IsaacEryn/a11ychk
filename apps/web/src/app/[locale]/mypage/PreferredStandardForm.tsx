"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { updatePreferredStandard, type SaveState } from "@/lib/actions";

/** 보고서 우선 표준 선택 — 빈 값 = 미설정(언어 기반 기본값) */
export function PreferredStandardForm({ defaultValue }: { defaultValue: "wcag" | "kwcag" | null }) {
  const t = useTranslations("mypage.profile");
  const [state, formAction, pending] = useActionState<SaveState, FormData>(updatePreferredStandard, {});

  return (
    <form action={formAction} className="mt-4">
      <label htmlFor="preferred-standard" className="mb-1 block text-sm font-semibold">
        {t("standard.label")}
      </label>
      <div className="flex gap-2">
        <select
          id="preferred-standard"
          name="preferredStandard"
          defaultValue={defaultValue ?? ""}
          aria-describedby="preferred-standard-help"
          className="min-w-0 flex-1 rounded border-[1.5px] border-[var(--color-ink)] bg-[var(--color-paper)] px-3 py-2"
        >
          <option value="">{t("standard.default")}</option>
          <option value="kwcag">{t("standard.kwcag")}</option>
          <option value="wcag">{t("standard.wcag")}</option>
        </select>
        <button
          type="submit"
          disabled={pending}
          className="rounded border-[1.5px] border-[var(--color-seal)] bg-[var(--color-seal)] px-4 py-2 font-semibold text-[var(--color-paper)] hover:bg-[var(--color-seal-deep)] disabled:opacity-60"
        >
          {t("save")}
        </button>
      </div>
      <p id="preferred-standard-help" className="mt-1.5 text-xs text-[var(--color-ink-faint)]">
        {t("standard.help")}
      </p>
      {state.error && (
        <p role="alert" className="mt-2 text-sm font-medium text-[var(--color-crit)]">
          {t("error.failed")}
        </p>
      )}
      {state.ok && (
        <p role="status" className="mt-2 text-sm font-medium text-[var(--color-seal)]">
          {t("saved")}
        </p>
      )}
    </form>
  );
}
