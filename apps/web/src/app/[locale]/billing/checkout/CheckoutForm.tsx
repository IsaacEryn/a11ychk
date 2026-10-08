"use client";

import { useActionState, useEffect, useRef } from "react";
import { useTranslations } from "next-intl";
import { BTN_OUTLINE, BTN_SOLID } from "@/components/buttonStyles";
import { PendingStatus } from "@/components/PendingStatus";
import { abandonCheckout, startCheckout, type StartCheckoutError, type TossCheckoutSdk } from "@/lib/actions/billing";
import type { CheckoutBlock } from "@/lib/billing/checkout";
import { loadTossPayments } from "@/lib/billing/tossSdk";

type FormError = StartCheckoutError | "sdkLoad" | "sdkFailed" | "sdkCanceled";
interface FormState {
  error?: FormError;
  /** error가 inProgress일 때 막는 까닭 */
  blockedBy?: CheckoutBlock;
  /** 이전 시도 닫기 결과 — released: 닫았다, nothingToRelease: 닫을 것이 없었다(성공으로 안내하지 않는다) */
  notice?: "released" | "nothingToRelease";
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

/** 이전 시도 닫기 — 닫은 것이 없으면 성공으로 안내하지 않고, 처리 중인 결제가 남았으면 기다리라고 안내한다 */
async function releasePrevious(): Promise<FormState> {
  const res = await abandonCheckout();
  if (res.error) return { error: res.error };
  if (res.blockedBy) return { error: "inProgress", blockedBy: res.blockedBy };
  return { notice: (res.closed ?? 0) > 0 ? "released" : "nothingToRelease" };
}

/**
 * 결제 확인 화면의 동의·제출 — 미리 체크하지 않은 필수 동의, 제출하면 서버가 결제 시도를 만들고 돌려준 값으로 결제창을 연다.
 * 처리하는 동안(결제창으로 이동할 때까지) 버튼은 비활성이고 진행 상태를 알린다.
 * 진행 중인 다른 시도가 있으면: 선점 전 시도(open)면 그 시도를 닫는 버튼을, 처리 중인 결제면 기다리라는 안내를 보인다.
 *
 * 오류가 나면 포커스를 오류 문구로 옮긴다(제출 중 버튼이 비활성이 되며 포커스를 잃기 쉽다). 오류 문구는 role="alert"도
 * 함께 둔다 — 포커스를 받지 못하는 환경에서도 알리기 위해서다(GOV.UK 오류 요약과 같은 방식). 상태 안내 영역은
 * 늘 DOM에 두고 문구만 바꾼다.
 */
export function CheckoutForm({ priceId }: { priceId: string }) {
  const t = useTranslations("billing.checkout");
  const [state, formAction, pending] = useActionState<FormState, FormData>(async (_prev, fd) => {
    if (fd.get("intent") === "release") return releasePrevious();
    const res = await startCheckout({}, fd);
    if (!res.ok || !res.sdk) return { error: res.error ?? "failed", ...(res.blockedBy ? { blockedBy: res.blockedBy } : {}) };
    return openBillingAuth(res.sdk);
  }, {});

  const errorRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    // 결과가 올 때마다(같은 오류가 다시 나도) 오류 문구로 포커스를 옮긴다
    if (state.error) errorRef.current?.focus();
  }, [state]);

  const consentError = state.error === "consent";
  const canRelease = state.error === "inProgress" && state.blockedBy === "open";
  const errorKey = state.error === "inProgress" && state.blockedBy === "processing" ? "inProgressChecking" : state.error;
  const statusText = state.notice ? t(state.notice) : "";

  return (
    <form action={formAction} className="mt-6">
      <input type="hidden" name="priceId" value={priceId} />
      <label className="flex items-start gap-3 text-sm font-semibold">
        <input
          name="consent"
          type="checkbox"
          required
          aria-invalid={consentError || undefined}
          aria-describedby={consentError ? "checkout-form-msg" : undefined}
          className="mt-0.5 size-5 shrink-0 accent-[var(--color-seal)]"
        />
        <span>{t("consent")}</span>
      </label>

      <button type="submit" disabled={pending} className={`${BTN_SOLID} mt-5`}>
        {t("submit")}
      </button>
      <PendingStatus message={pending ? t("pending") : null} />

      {errorKey && (
        <p ref={errorRef} id="checkout-form-msg" role="alert" tabIndex={-1} className="mt-1 text-sm font-medium text-[var(--color-crit)]">
          {t(`formErrors.${errorKey}`)}
        </p>
      )}
      {canRelease && (
        // 동의 체크 없이도 보낼 수 있게 formNoValidate — 서버는 이 사용자의 선점 전 시도만 닫는다
        <button type="submit" name="intent" value="release" formNoValidate disabled={pending} className={`${BTN_OUTLINE} mt-2`}>
          {t("release")}
        </button>
      )}
      <p
        role="status"
        aria-live="polite"
        className={`mt-1 min-h-5 text-sm font-medium ${state.notice === "released" ? "text-[var(--color-seal)]" : "text-[var(--color-ink-soft)]"}`}
      >
        {statusText}
      </p>
    </form>
  );
}
