"use client";

import { useActionState, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { RULE_CATALOG } from "@a11ychk/core/catalog";
import { setDisabledRules } from "@/lib/actions";
import type { SaveState } from "@/lib/actions";

/**
 * 검사 제외 규칙(오탐 관리) — 소유자가 오탐이라 판단한 규칙을 도메인 단위로 제외한다.
 * 목록을 편집한 뒤 명시적 "적용"으로 저장(WCAG 3.2.2 — select 변경만으로 제출하지 않음).
 * 적용은 이후 검사부터이며, 보고서에는 제외 사실이 함께 표기된다.
 */
export function DisabledRulesControl({ domainId, disabled }: { domainId: string; disabled: string[] }) {
  const t = useTranslations("dashboard.domains");
  const locale = useLocale();
  const [rules, setRules] = useState<string[]>(disabled);
  const [selected, setSelected] = useState("");
  const [state, formAction, pending] = useActionState<SaveState, FormData>(setDisabledRules, {});

  const ruleTitle = (ruleId: string): string => {
    const entry = RULE_CATALOG.find((r) => r.ruleId === ruleId);
    if (!entry) return ruleId;
    return locale === "en" && entry.title.en ? entry.title.en : entry.title.ko;
  };
  const available = RULE_CATALOG.filter((r) => !rules.includes(r.ruleId)).sort((a, b) =>
    a.ruleId.localeCompare(b.ruleId),
  );

  return (
    <details className="mt-3 rounded border-[1.5px] border-[var(--color-line)] bg-[var(--color-paper-warm)] p-3">
      <summary className="cursor-pointer text-sm font-semibold">
        {t("rulesTitle")} {rules.length > 0 ? `(${rules.length})` : ""}
      </summary>
      <p className="mt-2 text-xs text-[var(--color-ink-soft)]">{t("rulesHint")}</p>

      {rules.length > 0 && (
        <ul className="mt-2 space-y-1">
          {rules.map((ruleId) => (
            <li key={ruleId} className="flex items-center gap-2 text-sm">
              <code className="text-xs text-[var(--color-ink-faint)]">{ruleId}</code>
              <span className="min-w-0 flex-1 truncate">{ruleTitle(ruleId)}</span>
              <button
                type="button"
                onClick={() => setRules(rules.filter((r) => r !== ruleId))}
                className="rounded border-[1.5px] border-[var(--color-line)] px-2 py-0.5 text-xs font-semibold hover:bg-[var(--color-paper)]"
                aria-label={t("rulesRemoveAria", { rule: ruleTitle(ruleId) })}
              >
                {t("rulesRemove")}
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <label htmlFor={`rule-add-${domainId}`} className="sr-only">
          {t("rulesSelectLabel")}
        </label>
        <select
          id={`rule-add-${domainId}`}
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
          className="min-w-0 max-w-full rounded border-[1.5px] border-[var(--color-ink)] bg-[var(--color-paper)] px-2 py-1.5 text-sm"
        >
          <option value="">{t("rulesSelectLabel")}</option>
          {available.map((r) => (
            <option key={r.ruleId} value={r.ruleId}>
              {r.ruleId} — {locale === "en" && r.title.en ? r.title.en : r.title.ko}
            </option>
          ))}
        </select>
        <button
          type="button"
          disabled={!selected || rules.length >= 20}
          onClick={() => {
            if (selected && !rules.includes(selected)) setRules([...rules, selected]);
            setSelected("");
          }}
          className="rounded border-[1.5px] border-[var(--color-ink)] px-3 py-1.5 text-sm font-semibold hover:bg-[var(--color-paper)] disabled:opacity-60"
        >
          {t("rulesAdd")}
        </button>
      </div>

      <form action={formAction} className="mt-2 flex items-center gap-2">
        <input type="hidden" name="id" value={domainId} />
        <input type="hidden" name="rules" value={rules.join(",")} />
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
      </form>
      <p className="mt-2 text-xs text-[var(--color-ink-faint)]">{t("rulesNote")}</p>
    </details>
  );
}
