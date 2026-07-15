"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { saveReportMeta, type SaveState } from "@/lib/actions";
import type { ReportMeta } from "@a11ychk/core/catalog";

/**
 * 보고서 정보 입력 패널 (no-print) — 사이트 이름·기관·평가자·제목·총평.
 * 저장하면 표지·Executive Summary·Report Tool export에 반영된다.
 */
export function ReportMetaForm({ scanId, meta }: { scanId: string; meta: ReportMeta | null }) {
  const t = useTranslations("report.metaForm");
  const [state, formAction, pending] = useActionState<SaveState, FormData>(saveReportMeta, {});

  const fields: { name: keyof ReportMeta; label: string; placeholder: string }[] = [
    { name: "title", label: t("title"), placeholder: t("titlePlaceholder") },
    { name: "siteName", label: t("siteName"), placeholder: t("siteNamePlaceholder") },
    { name: "organization", label: t("organization"), placeholder: t("organizationPlaceholder") },
    { name: "evaluatorName", label: t("evaluatorName"), placeholder: t("evaluatorNamePlaceholder") },
  ];

  return (
    <details className="no-print doc-card mb-8 p-5" open={!meta}>
      <summary className="cursor-pointer font-display text-lg font-bold">{t("legend")}</summary>
      <p className="mt-1 text-sm text-[var(--color-ink-faint)]">{t("hint")}</p>
      <form action={formAction} className="mt-4">
        <input type="hidden" name="scanId" value={scanId} />
        <div className="grid gap-3 sm:grid-cols-2">
          {fields.map((f) => (
            <div key={f.name}>
              <label htmlFor={`meta-${f.name}`} className="mb-1 block text-sm font-semibold">
                {f.label}
              </label>
              <input
                id={`meta-${f.name}`}
                name={f.name}
                type="text"
                maxLength={300}
                defaultValue={(meta?.[f.name] as string) ?? ""}
                placeholder={f.placeholder}
                className="w-full rounded border-[1.5px] border-[var(--color-ink)] bg-[var(--color-paper)] px-3 py-2 text-sm"
              />
            </div>
          ))}
        </div>
        <div className="mt-3">
          <label htmlFor="meta-executiveSummary" className="mb-1 block text-sm font-semibold">
            {t("executiveSummary")}
          </label>
          <textarea
            id="meta-executiveSummary"
            name="executiveSummary"
            rows={4}
            maxLength={10000}
            defaultValue={meta?.executiveSummary ?? ""}
            placeholder={t("executiveSummaryPlaceholder")}
            className="w-full rounded border-[1.5px] border-[var(--color-line)] bg-[var(--color-paper)] px-3 py-2 text-sm"
          />
        </div>
        <div className="mt-3 flex items-center gap-3">
          <button
            type="submit"
            disabled={pending}
            className="rounded border-[1.5px] border-[var(--color-seal)] bg-[var(--color-seal)] px-4 py-2 text-sm font-bold text-[var(--color-paper)] hover:bg-[var(--color-seal-deep)] disabled:opacity-60"
          >
            {pending ? t("saving") : t("save")}
          </button>
          {state.ok && (
            <span role="status" className="text-sm font-semibold text-[var(--color-seal)]">
              {t("saved")}
            </span>
          )}
          {state.error && (
            <span role="alert" className="text-sm font-semibold text-[var(--color-crit)]">
              {t("failed")}
            </span>
          )}
        </div>
      </form>
    </details>
  );
}
