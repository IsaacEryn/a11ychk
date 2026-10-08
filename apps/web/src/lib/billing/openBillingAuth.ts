import { useActionState, useEffect, useRef } from "react";
import { abandonCheckout, type StartCheckoutError, type StartCheckoutState, type TossCheckoutSdk } from "@/lib/actions/billing";
import type { CheckoutBlock } from "@/lib/billing/checkout";
import { loadTossPayments } from "@/lib/billing/tossSdk";

/**
 * 토스 결제창(카드 등록) 열기와 그만둔 시도 닫기 — 결제 확인 화면(CheckoutForm)과 결제 관리의 카드 변경(CardChangeButton)이
 * 함께 쓴다(useBillingAuthAction). 브라우저에서만 부른다("use client" 모듈이 아니라 클라이언트 컴포넌트가 가져다 쓴다 —
 * tossSdk.ts와 같은 규칙).
 */

/** 사용자가 결제창을 닫았을 때 SDK가 돌려주는 코드 */
const SDK_CANCEL_CODES = new Set(["USER_CANCEL", "PAY_PROCESS_CANCELED"]);

/** sdkLoad: SDK를 불러오지 못함 / sdkFailed: 결제창을 열지 못함 / sdkCanceled: 사용자가 닫음 */
export type BillingAuthError = "sdkLoad" | "sdkFailed" | "sdkCanceled";

/**
 * 결제창 열기 — SDK를 불러 카드 등록(빌링 인증)을 요청한다. 성공하면 토스가 성공·실패 주소로 이동시킨다.
 * 열지 못했거나 사용자가 닫았으면 방금 만든 시도를 닫는다(열린 채 두면 30분 동안 새 시도가 막힌다).
 */
export async function openBillingAuth(sdk: TossCheckoutSdk): Promise<{ error?: BillingAuthError }> {
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

export interface ReleaseResult {
  error?: "notConfigured" | "failed" | "inProgress";
  /** error가 inProgress일 때 — 닫은 뒤에도 처리 중인 결제가 남았다(기다려야 한다) */
  blockedBy?: CheckoutBlock;
  /** released: 닫았다, nothingToRelease: 닫을 것이 없었다(성공으로 안내하지 않는다) */
  notice?: "released" | "nothingToRelease";
}

/** 이전 시도 닫기 — 닫은 것이 없으면 성공으로 안내하지 않고, 처리 중인 결제가 남았으면 기다리라고 안내한다 */
export async function releasePreviousCheckout(): Promise<ReleaseResult> {
  const res = await abandonCheckout();
  if (res.error) return { error: res.error };
  if (res.blockedBy) return { error: "inProgress", blockedBy: res.blockedBy };
  return { notice: (res.closed ?? 0) > 0 ? "released" : "nothingToRelease" };
}

export interface BillingAuthFormState {
  error?: StartCheckoutError | BillingAuthError;
  /** error가 inProgress일 때 막는 까닭 */
  blockedBy?: CheckoutBlock;
  /** 이전 시도 닫기 결과 — released: 닫았다, nothingToRelease: 닫을 것이 없었다(성공으로 안내하지 않는다) */
  notice?: "released" | "nothingToRelease";
}

/**
 * 결제창을 여는 폼의 공통 상태 — 제출하면 start(서버 액션)가 시도를 만들고 돌려준 값으로 결제창을 연다.
 * intent=release로 제출하면 이전 시도를 닫는다. 결과가 올 때마다(같은 오류가 다시 나도) 오류 문구(errorRef)로 포커스를 옮긴다 —
 * 제출 중 버튼이 비활성이 되며 포커스를 잃기 쉽다. 오류 문구에는 live 역할을 겹치지 않는다(포커스로 읽힌다).
 * canRelease: 선점 전 시도(open)가 막고 있다 — 그 시도를 닫는 버튼을 보인다.
 * waiting: 처리 중인 결제가 막고 있다 — 닫을 수 없고 기다려야 한다.
 */
export function useBillingAuthAction(start: (formData: FormData) => Promise<StartCheckoutState>) {
  const [state, formAction, pending] = useActionState<BillingAuthFormState, FormData>(async (_prev, fd) => {
    if (fd.get("intent") === "release") return releasePreviousCheckout();
    const res = await start(fd);
    if (!res.ok || !res.sdk) return { error: res.error ?? "failed", ...(res.blockedBy ? { blockedBy: res.blockedBy } : {}) };
    return openBillingAuth(res.sdk);
  }, {});

  const errorRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (state.error) errorRef.current?.focus();
  }, [state]);

  return {
    state,
    formAction,
    pending,
    errorRef,
    canRelease: state.error === "inProgress" && state.blockedBy === "open",
    waiting: state.error === "inProgress" && state.blockedBy === "processing",
  };
}
