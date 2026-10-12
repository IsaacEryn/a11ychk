"use client";

import { useTranslations } from "next-intl";
import { BTN_OUTLINE, BTN_SOLID } from "@/components/buttonStyles";
import { PendingStatus } from "@/components/PendingStatus";
import { abandonMorCheckout, startMorCheckoutAction, type StartMorCheckoutError } from "@/lib/actions/billing";
import type { CheckoutBlock } from "@/lib/billing/checkout";
import { releasePrevious } from "@/lib/billing/releaseCheckout";
import { usePolarNavigation } from "@/lib/billing/usePolarNavigation";

interface MorFormState {
  error?: StartMorCheckoutError;
  /** error가 inProgress일 때 막는 까닭 */
  blockedBy?: CheckoutBlock;
  /** 이전 시도 취소 결과 — released: 닫았다, nothingToRelease: 닫을 것이 없었다(성공으로 안내하지 않는다) */
  notice?: "released" | "nothingToRelease";
}

const ERROR_ID = "mor-checkout-form-msg";

/**
 * 해외(판매 대행 Polar) 결제 확인 화면의 동의·제출 — 미리 체크하지 않은 필수 동의, 제출하면 서버가 결제 시도와 Polar 결제창을 만들고
 * 그 주소를 돌려준다. 주소는 polar.sh 허용 목록을 통과할 때만 이동한다(usePolarNavigation — 서버 액션 redirect로 외부에 보내지 않는다).
 * 통과하지 못하면 이동하지 않고 실패로 안내한다. 처리하는 동안과 이동을 시작한 뒤에는 버튼이 비활성이고 진행 상태를 알린다. 뒤로 가기로
 * 이 화면이 되살아나면(bfcache) 다시 누를 수 있다.
 * 이전에 연 Polar 결제창이 아직 살아 있으면(만료 전 시도) 서버가 새 결제창을 열지 않는다 — 그 창에서 결제하지 않았다면 "이전 시도 취소"
 * (intent=release, abandonMorCheckout)로 닫고 다시 시작한다(토스 결제 화면과 같은 흐름). 처리 중인 결제가 있으면 기다리라고 안내한다.
 *
 * 오류가 나면 포커스를 오류 문구로 옮긴다. 오류 문구에는 role="alert"를 두지 않는다(포커스로 읽히므로 겹치면 두 번 읽힌다).
 * 진행 상태 영역(PendingStatus)과 이전 시도 취소 결과 영역은 늘 DOM에 두고 문구만 바꾼다.
 */
export function MorCheckoutForm({ priceId }: { priceId: string }) {
  const t = useTranslations("billing.checkout");
  const { state, formAction, pending, leaving, busy, errorRef } = usePolarNavigation<MorFormState>(async (_prev, fd, go) => {
    if (fd.get("intent") === "release") return releasePrevious(abandonMorCheckout);
    const res = await startMorCheckoutAction({}, fd);
    if (!res.ok || !res.url) return { error: res.error ?? "failed", ...(res.blockedBy ? { blockedBy: res.blockedBy } : {}) };
    if (!go(res.url)) return { error: "failed" };
    return {};
  }, {});

  const consentError = state.error === "consent";
  const canRelease = state.error === "inProgress" && state.blockedBy === "open";
  const errorText =
    state.error === "inProgress"
      ? state.blockedBy === "processing"
        ? t("formErrors.inProgressChecking")
        : t("mor.inProgressOpen")
      : state.error
        ? t(`formErrors.${state.error}`)
        : null;

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
      {canRelease && (
        // 동의 체크 없이도 보낼 수 있게 formNoValidate — 서버는 이 사용자의 선점 전 시도만 닫는다
        <button type="submit" name="intent" value="release" formNoValidate disabled={busy} className={`${BTN_OUTLINE} mt-2`}>
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
