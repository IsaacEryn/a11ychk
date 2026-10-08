"use client";

import { useTranslations } from "next-intl";
import { runBillingCycleNow, type CycleState } from "@/lib/actions";
import { FormFeedback } from "@/components/FormFeedback";
import { CYCLE_SUMMARY_KEYS, cycleIssues } from "@/lib/billing/cycleSummary";
import { useAdminAction } from "../../useAdminAction";
import { BTN_PRIMARY } from "../contractForm";

/** runBillingCycleNow가 돌려주는 오류 코드 전부 */
const ERROR_CODES = ["off", "notConfigured", "confirm", "failed"] as const;

/**
 * 결제 크론 지금 실행 — 결과 개수를 작은 정의 목록으로 보여 준다.
 * live 모드에서는 기한이 된 실결제 구독에 실제 결제가 나가므로 확인 체크를 필수로 둔다(서버도 다시 확인한다).
 */
export function RunCycleForm({
  requireConfirm,
  disabled,
  describedBy,
}: {
  requireConfirm: boolean;
  /** 결제 모드가 off일 때 — 이유는 describedBy가 가리키는 안내 문단에 있다 */
  disabled: boolean;
  describedBy: string;
}) {
  const t = useTranslations("admin.billing.tools");
  const [state, formAction, pending] = useAdminAction<CycleState, FormData>(runBillingCycleNow, {});
  const errors = Object.fromEntries(ERROR_CODES.map((c) => [c, t(`errors.${c}`)])) as Record<string, string>;
  const summary = state.ok ? Object.entries(state.summary ?? {}) : [];
  // 크론이 끝까지 돌았어도 오류·설정 사고로 인한 중단·운영자 확인이 필요한 결제가 있으면 성공 표시(✓)로 덮지 않는다
  const issues = cycleIssues(state.summary);
  const hasIssues = state.ok === true && issues.any;
  const candidates = state.summary?.candidates ?? 0;

  return (
    <form action={formAction} className="mt-3 space-y-3">
      {requireConfirm && (
        <label htmlFor="run-cycle-confirm" className="flex items-start gap-2 text-sm font-semibold">
          <input
            id="run-cycle-confirm"
            name="confirm"
            type="checkbox"
            required
            className="mt-1 size-4 shrink-0 accent-[var(--color-crit)]"
          />
          <span>{t("runConfirm")}</span>
        </label>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <button type="submit" disabled={pending || disabled} aria-describedby={describedBy} className={BTN_PRIMARY}>
          {pending ? t("running") : t("run")}
        </button>
        {hasIssues ? (
          <span role="alert" className="text-xs font-bold text-[var(--color-crit)]">
            {t("ranIssues", { candidates, errors: issues.errors, review: issues.review, halted: issues.halted })}
          </span>
        ) : (
          <FormFeedback state={state} okLabel={t("ran", { candidates })} errors={errors} fallback={errors.failed} />
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
