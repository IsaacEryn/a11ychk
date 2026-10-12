"use client";

import { useTranslations } from "next-intl";
import { runMorReconcileNow, type CycleState } from "@/lib/actions";
import { FormFeedback } from "@/components/FormFeedback";
import { CYCLE_SUMMARY_KEYS, cycleIssues } from "@/lib/billing/cycleSummary";
import { useAdminAction } from "../../useAdminAction";
import { BTN_PRIMARY } from "../contractForm";

/** runMorReconcileNow가 돌려주는 오류 코드 전부 */
const ERROR_CODES = ["off", "notConfigured", "failed"] as const;

/**
 * MoR 지금 대사 — 결제 크론의 판매 대행(Polar) 단계만 돌리고 결과 개수를 보여 준다(RunCycleForm과 같은 모양).
 * 결제를 일으키지 않아 live에서도 확인 체크가 없다. 실패·확인 필요·중단이 있으면 성공 표시(✓)로 덮지 않는다.
 */
export function RunMorCycleForm({ disabled, describedBy }: { disabled: boolean; describedBy: string }) {
  const t = useTranslations("admin.billing.tools");
  const [state, formAction, pending] = useAdminAction<CycleState, FormData>(runMorReconcileNow, {});
  const errors = Object.fromEntries(ERROR_CODES.map((c) => [c, t(`morErrors.${c}`)])) as Record<string, string>;
  const summary = state.ok ? Object.entries(state.summary ?? {}) : [];
  const issues = cycleIssues(state.summary);
  const hasIssues = state.ok === true && issues.any;
  const candidates = state.summary?.mor_candidates ?? 0;

  return (
    <form action={formAction} className="mt-3 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <button type="submit" disabled={pending || disabled} aria-describedby={describedBy} className={BTN_PRIMARY}>
          {pending ? t("running") : t("morRun")}
        </button>
        {hasIssues ? (
          <span role="alert" className="text-xs font-bold text-[var(--color-crit)]">
            {t("morRanIssues", { candidates, errors: issues.errors, review: issues.review, morHalted: issues.morHalted })}
          </span>
        ) : (
          <FormFeedback state={state} okLabel={t("morRan", { candidates })} errors={errors} fallback={errors.failed} />
        )}
      </div>
      {summary.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-[var(--color-ink-soft)]">{t("summaryLabel")}</p>
          <dl className="mt-1 grid grid-cols-[max-content_max-content] gap-x-6 gap-y-1 text-sm">
            {summary.map(([key, count]) => (
              <div key={key} className="contents">
                <dt>{(CYCLE_SUMMARY_KEYS as readonly string[]).includes(key) ? t(`summary.${key}`) : key}</dt>
                <dd className="text-right font-semibold tabular-nums">{count}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}
    </form>
  );
}
