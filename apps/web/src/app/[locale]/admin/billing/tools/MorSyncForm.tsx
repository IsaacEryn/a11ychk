"use client";

import { useTranslations } from "next-intl";
import { syncMorSubscriptionNow, type MorSyncState } from "@/lib/actions";
import { FormFeedback } from "@/components/FormFeedback";
import { useAdminAction } from "../../useAdminAction";
import { BTN_PRIMARY, FIELD, HINT, LABEL } from "../contractForm";

/** syncMorSubscriptionNow가 돌려주는 오류 코드 전부 */
const ERROR_CODES = ["off", "invalid", "confirm", "notConfigured", "notFound", "failed"] as const;

/**
 * Polar 구독 id로 지금 동기화 — 결제는 됐는데 review로 끝나 행이 없는 새 구독을, 원인(가격 행·상품 설정 등)을 고친 뒤 되살린다.
 * 웹훅·크론과 같은 동기화를 그 구독 하나에 돌리고 결과를 보인다. 확인 필요(review)나 환불을 확정하지 못한 결과는 성공 표시(✓)로
 * 덮지 않는다(role="alert"). live 모드에서는 동기화가 해지·환불을 일으킬 수 있어 확인 체크를 필수로 둔다(서버도 다시 확인한다).
 * 입력은 비제어 — 제출 뒤 폼이 비어도 결과 문구에 행 id가 남는다.
 */
export function MorSyncForm({ requireConfirm, disabled, describedBy }: { requireConfirm: boolean; disabled: boolean; describedBy: string }) {
  const t = useTranslations("admin.billing.tools.morSync");
  const tTools = useTranslations("admin.billing.tools");
  const [state, formAction, pending] = useAdminAction<MorSyncState, FormData>(syncMorSubscriptionNow, {});
  const errors = Object.fromEntries(ERROR_CODES.map((c) => [c, t(`errors.${c}`)])) as Record<string, string>;
  const needsReview = state.ok === true && (state.result === "review" || (state.result === "ungranted" && state.refund === "review"));
  const okLabel = (() => {
    switch (state.result) {
      case "applied":
      case "stale":
        return t(`results.${state.result}`, { id: state.subscriptionId ?? "" });
      case "ungranted":
        return t("results.ungranted", { refund: state.refund ?? "review" });
      case "skipped":
      case "review":
        return t(`results.${state.result}`);
      default:
        return "";
    }
  })();

  return (
    <form action={formAction} className="mt-3 max-w-lg space-y-3">
      <div>
        <label htmlFor="mor-sync-subscription" className={LABEL}>
          {t("label")}
        </label>
        <input
          id="mor-sync-subscription"
          name="subscriptionId"
          type="text"
          required
          autoComplete="off"
          spellCheck={false}
          inputMode="text"
          aria-describedby={`mor-sync-subscription-hint ${describedBy}`}
          className={`${FIELD} font-mono`}
        />
        <p id="mor-sync-subscription-hint" className={HINT}>
          {t("hint")}
        </p>
      </div>
      {requireConfirm && (
        <label htmlFor="mor-sync-confirm" className="flex items-start gap-2 text-sm font-semibold">
          <input id="mor-sync-confirm" name="confirm" type="checkbox" required className="mt-1 size-4 shrink-0 accent-[var(--color-crit)]" />
          <span>{t("confirm")}</span>
        </label>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <button type="submit" disabled={pending || disabled} className={BTN_PRIMARY}>
          {pending ? tTools("running") : t("submit")}
        </button>
        {needsReview ? (
          <span role="alert" className="text-xs font-bold text-[var(--color-crit)]">
            {okLabel}
          </span>
        ) : (
          <FormFeedback state={state} okLabel={okLabel} errors={errors} fallback={errors.failed} />
        )}
      </div>
    </form>
  );
}
