"use client";

import { useActionState, useState } from "react";
import { useTranslations } from "next-intl";
import { setExcludedPaths } from "@/lib/actions";
import type { SaveState } from "@/lib/actions";

/**
 * 정기 검사 제외 페이지 — 소유자가 지정한 URL/경로 패턴을 스케줄 검사 표본에서 뺀다.
 * 패턴을 편집한 뒤 명시적 "적용"으로 저장(WCAG 3.2.2 — 입력만으로 제출하지 않음).
 * 적용은 이후 정기 검사부터. 일회성 검사는 검사 폼에서 따로 지정한다.
 */
export function ExcludedPagesControl({ domainId, paths }: { domainId: string; paths: string[] }) {
  const t = useTranslations("dashboard.domains");
  const [text, setText] = useState(paths.join("\n"));
  const [state, formAction, pending] = useActionState<SaveState, FormData>(setExcludedPaths, {});
  const count = text
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean).length;

  return (
    <details className="mt-3 rounded border-[1.5px] border-[var(--color-line)] bg-[var(--color-paper-warm)] p-3">
      <summary className="cursor-pointer text-sm font-semibold">
        {t("excludeTitle")} {count > 0 ? `(${count})` : ""}
      </summary>
      <p className="mt-2 text-xs text-[var(--color-ink-soft)]">{t("excludeHint")}</p>
      <form action={formAction} className="mt-2">
        <input type="hidden" name="id" value={domainId} />
        <label htmlFor={`exclude-paths-${domainId}`} className="sr-only">
          {t("excludeTitle")}
        </label>
        <textarea
          id={`exclude-paths-${domainId}`}
          name="paths"
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={4}
          placeholder={"/admin/*\n/tag/"}
          className="w-full rounded border-[1.5px] border-[var(--color-ink)] bg-[var(--color-paper)] px-2 py-1.5 font-mono text-sm"
        />
        <div className="mt-2 flex items-center gap-2">
          <button
            type="submit"
            disabled={pending}
            className="rounded border-[1.5px] border-[var(--color-seal)] px-3 py-1.5 text-sm font-semibold text-[var(--color-seal)] hover:bg-[var(--color-seal-tint)] disabled:opacity-60"
          >
            {t("rulesApply")}
          </button>
          <span role="status" className="text-xs text-[var(--color-ink-faint)]">
            {state.ok ? t("settingSaved") : state.error ? t("settingFailed") : ""}
          </span>
        </div>
      </form>
    </details>
  );
}
