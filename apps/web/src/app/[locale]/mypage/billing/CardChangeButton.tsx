"use client";

import { useId } from "react";
import { useTranslations } from "next-intl";
import { BTN_OUTLINE, BTN_SOLID } from "@/components/buttonStyles";
import { PendingStatus } from "@/components/PendingStatus";
import { startCardChange } from "@/lib/actions/billing";
import { useBillingAuthAction } from "@/lib/billing/openBillingAuth";

/** 카드 변경이 돌려줄 수 있는 오류 — 그 밖의 값(결제 시작 전용 코드)은 failed로 안내한다 */
const ERROR_KEYS = new Set(["invalid", "notAllowed", "notConfigured", "inProgress", "failed", "sdkLoad", "sdkFailed", "sdkCanceled"]);

/**
 * 결제 카드 변경 — 서버가 카드 변경 시도를 만들고(startCardChange) 돌려준 값으로 토스 결제창(카드 등록)을 연다.
 * 새 카드를 등록하면 콜백이 고객 행의 카드를 바꾸고, 미납이면 바로 다시 결제한 뒤 결제 관리로 돌아온다.
 * 결제창을 열지 못했거나 닫았으면 시도를 닫는다. 진행 중인 다른 시도·오류 포커스는 결제 확인 화면과 같다(useBillingAuthAction).
 * 미납 구독이면 버튼을 강조한다(emphasize).
 */
export function CardChangeButton({ subscriptionId, emphasize }: { subscriptionId: string; emphasize: boolean }) {
  const t = useTranslations("billing.manage.cardChange");
  const errorId = useId();
  const { state, formAction, pending, errorRef, canRelease, waiting } = useBillingAuthAction((fd) => startCardChange({}, fd));

  const errorKey = !state.error ? null : waiting ? "inProgressChecking" : ERROR_KEYS.has(state.error) ? state.error : "failed";

  return (
    <form action={formAction} className="mt-4">
      <input type="hidden" name="subscriptionId" value={subscriptionId} />
      <button
        type="submit"
        disabled={pending}
        aria-describedby={errorKey ? errorId : undefined}
        className={emphasize ? BTN_SOLID : BTN_OUTLINE}
      >
        {t("button")}
      </button>
      <PendingStatus message={pending ? t("pending") : null} />
      {errorKey && (
        <p ref={errorRef} id={errorId} tabIndex={-1} className="mt-1 text-sm font-medium text-[var(--color-crit)]">
          {t(`errors.${errorKey}`)}
        </p>
      )}
      {canRelease && (
        <button type="submit" name="intent" value="release" disabled={pending} className={`${BTN_OUTLINE} mt-2`}>
          {t("release")}
        </button>
      )}
      <p
        role="status"
        aria-live="polite"
        className={`mt-1 min-h-5 text-sm font-medium ${state.notice === "released" ? "text-[var(--color-seal)]" : "text-[var(--color-ink-soft)]"}`}
      >
        {state.notice ? t(state.notice) : ""}
      </p>
    </form>
  );
}
