"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { BTN_OUTLINE, BTN_SOLID } from "@/components/buttonStyles";
import { PendingStatus } from "@/components/PendingStatus";
import { abandonCheckout, startCheckout, type StartCheckoutError, type TossCheckoutSdk } from "@/lib/actions/billing";
import { loadTossPayments } from "@/lib/billing/tossSdk";

type FormError = StartCheckoutError | "sdkLoad" | "sdkFailed" | "sdkCanceled";
interface FormState {
  error?: FormError;
  /** 그만둔 시도를 닫았다 — 다시 결제할 수 있다 */
  released?: boolean;
}

/** 사용자가 결제창을 닫았을 때 SDK가 돌려주는 코드 */
const SDK_CANCEL_CODES = new Set(["USER_CANCEL", "PAY_PROCESS_CANCELED"]);

/**
 * 결제창 열기 — SDK를 불러 카드 등록(빌링 인증)을 요청한다. 성공하면 토스가 성공·실패 주소로 이동시킨다.
 * 열지 못했거나 사용자가 닫았으면 방금 만든 시도를 닫는다(열린 채 두면 30분 동안 새 시도가 막힌다).
 */
async function openBillingAuth(sdk: TossCheckoutSdk): Promise<FormState> {
  let factory;
  try {
    factory = await loadTossPayments();
  } catch {
    await abandonCheckout().catch(() => undefined);
    return { error: "sdkLoad" };
  }
  try {
    await factory(sdk.clientKey)
      .payment({ customerKey: sdk.customerKey })
      .requestBillingAuth({
        method: "CARD",
        successUrl: sdk.successUrl,
        failUrl: sdk.failUrl,
        ...(sdk.customerEmail ? { customerEmail: sdk.customerEmail } : {}),
      });
    // 보통은 여기 오기 전에 결과 주소로 이동한다
    return {};
  } catch (e) {
    await abandonCheckout().catch(() => undefined);
    const code = (e as { code?: unknown } | null)?.code;
    return { error: typeof code === "string" && SDK_CANCEL_CODES.has(code) ? "sdkCanceled" : "sdkFailed" };
  }
}

/**
 * 결제 확인 화면의 동의·제출 — 미리 체크하지 않은 필수 동의, 제출하면 서버가 결제 시도를 만들고 돌려준 값으로 결제창을 연다.
 * 처리하는 동안(결제창으로 이동할 때까지) 버튼은 비활성이고 진행 상태를 알린다. 진행 중인 다른 시도가 있으면 그 시도를
 * 닫는 버튼을 함께 보여 준다(뒤로 가기로 돌아온 경우 등).
 */
export function CheckoutForm({ priceId }: { priceId: string }) {
  const t = useTranslations("billing.checkout");
  const [state, formAction, pending] = useActionState<FormState, FormData>(async (_prev, fd) => {
    if (fd.get("intent") === "release") {
      const res = await abandonCheckout();
      return res.ok ? { released: true } : { error: res.error ?? "failed" };
    }
    const res = await startCheckout({}, fd);
    if (!res.ok || !res.sdk) return { error: res.error ?? "failed" };
    return openBillingAuth(res.sdk);
  }, {});

  const consentError = state.error === "consent";

  return (
    <form action={formAction} className="mt-6">
      <input type="hidden" name="priceId" value={priceId} />
      <label className="flex items-start gap-3 text-sm font-semibold">
        <input
          name="consent"
          type="checkbox"
          required
          aria-invalid={consentError || undefined}
          aria-describedby={state.error ? "checkout-form-msg" : undefined}
          className="mt-0.5 size-5 shrink-0 accent-[var(--color-seal)]"
        />
        <span>{t("consent")}</span>
      </label>

      <button type="submit" disabled={pending} className={`${BTN_SOLID} mt-5`}>
        {t("submit")}
      </button>
      <PendingStatus message={pending ? t("pending") : null} />

      {state.error && (
        <p id="checkout-form-msg" role="alert" className="mt-1 text-sm font-medium text-[var(--color-crit)]">
          {t(`formErrors.${state.error}`)}
        </p>
      )}
      {state.error === "inProgress" && (
        // 동의 체크 없이도 보낼 수 있게 formNoValidate — 서버는 이 사용자의 선점 전 시도만 닫는다
        <button type="submit" name="intent" value="release" formNoValidate disabled={pending} className={`${BTN_OUTLINE} mt-2`}>
          {t("release")}
        </button>
      )}
      {state.released && (
        <p role="status" className="mt-1 text-sm font-medium text-[var(--color-seal)]">
          {t("released")}
        </p>
      )}
    </form>
  );
}
