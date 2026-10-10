"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { BTN_SOLID } from "@/components/buttonStyles";
import { PendingStatus } from "@/components/PendingStatus";
import { startMorCheckoutAction, type StartMorCheckoutError } from "@/lib/actions/billing";
import type { CheckoutBlock } from "@/lib/billing/checkout";
import { navigateToPolar } from "@/lib/billing/polarRedirect";

interface MorFormState {
  error?: StartMorCheckoutError;
  /** error가 inProgress일 때 막는 까닭 */
  blockedBy?: CheckoutBlock;
}

const ERROR_ID = "mor-checkout-form-msg";

/**
 * 해외(판매 대행 Polar) 결제 확인 화면의 동의·제출 — 미리 체크하지 않은 필수 동의, 제출하면 서버가 결제 시도와 Polar 결제창을 만들고
 * 그 주소를 돌려준다. 주소는 polar.sh 허용 목록(navigateToPolar)을 통과할 때만 window.location.assign으로 이동한다 — 서버 액션
 * redirect로 외부에 보내지 않는다(CSP form-action을 넓히지 않는다). 통과하지 못하면 이동하지 않고 실패로 안내한다.
 * 처리하는 동안과 이동을 시작한 뒤에는 버튼이 비활성이고 진행 상태를 알린다. 뒤로 가기로 이 화면이 되살아나면(bfcache) 다시 누를 수 있다.
 * 이전 시도는 서버가 닫고 새로 연다(토스 화면의 "이전 결제 시도 취소" 버튼이 없다). 처리 중인 결제가 있으면 기다리라고 안내한다.
 *
 * 오류가 나면 포커스를 오류 문구로 옮긴다(제출 중 버튼이 비활성이 되며 포커스를 잃기 쉽다 — CheckoutForm과 같은 방식). 오류 문구에는
 * role="alert"를 두지 않는다(포커스로 읽히므로 겹치면 두 번 읽힌다). 진행 상태 영역(PendingStatus)은 늘 DOM에 두고 문구만 바꾼다.
 */
export function MorCheckoutForm({ priceId }: { priceId: string }) {
  const t = useTranslations("billing.checkout");
  const [leaving, setLeaving] = useState(false);
  const [state, formAction, pending] = useActionState<MorFormState, FormData>(async (_prev, fd) => {
    const res = await startMorCheckoutAction({}, fd);
    if (!res.ok || !res.url) return { error: res.error ?? "failed", ...(res.blockedBy ? { blockedBy: res.blockedBy } : {}) };
    if (!navigateToPolar(res.url)) return { error: "failed" };
    setLeaving(true);
    return {};
  }, {});

  const errorRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (state.error) errorRef.current?.focus();
  }, [state]);

  useEffect(() => {
    const onShow = (e: PageTransitionEvent) => {
      if (e.persisted) setLeaving(false);
    };
    window.addEventListener("pageshow", onShow);
    return () => window.removeEventListener("pageshow", onShow);
  }, []);

  const consentError = state.error === "consent";
  const errorText =
    state.error === "inProgress"
      ? state.blockedBy === "processing"
        ? t("formErrors.inProgressChecking")
        : t("mor.inProgressOpen")
      : state.error
        ? t(`formErrors.${state.error}`)
        : null;
  const busy = pending || leaving;

  return (
    <form action={formAction} className="mt-6">
      <input type="hidden" name="priceId" value={priceId} />
      <label className="flex items-start gap-3 text-sm font-semibold">
        <input
          name="consent"
          type="checkbox"
          required
          aria-invalid={consentError || undefined}
          aria-describedby={consentError ? ERROR_ID : undefined}
          className="mt-0.5 size-5 shrink-0 accent-[var(--color-seal)]"
        />
        <span>{t("mor.consent")}</span>
      </label>

      <button type="submit" disabled={busy} className={`${BTN_SOLID} mt-5`}>
        {t("mor.submit")}
      </button>
      <PendingStatus message={pending ? t("mor.pending") : leaving ? t("mor.leaving") : null} />

      {errorText && (
        <p ref={errorRef} id={ERROR_ID} tabIndex={-1} className="mt-1 text-sm font-medium text-[var(--color-crit)]">
          {errorText}
        </p>
      )}
    </form>
  );
}
