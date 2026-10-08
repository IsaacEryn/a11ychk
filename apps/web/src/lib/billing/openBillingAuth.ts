import { abandonCheckout, type TossCheckoutSdk } from "@/lib/actions/billing";
import type { CheckoutBlock } from "@/lib/billing/checkout";
import { loadTossPayments } from "@/lib/billing/tossSdk";

/**
 * 토스 결제창(카드 등록) 열기와 그만둔 시도 닫기 — 결제 확인 화면(CheckoutForm)과 결제 관리의 카드 변경(CardChangeButton)이
 * 함께 쓴다. 브라우저에서만 부른다("use client" 모듈이 아니라 클라이언트 컴포넌트가 가져다 쓴다 — tossSdk.ts와 같은 규칙).
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
