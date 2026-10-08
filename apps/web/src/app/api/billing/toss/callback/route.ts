import { callbackRedirectPath, failRedirectPath } from "@/lib/billing/checkout";
import { completeCheckout, failCheckout } from "@/lib/billing/flows/subscribe";
import { handleTossReturn } from "@/lib/billing/tossReturn";

// 한 요청에서 빌링키 발급(토스 제한 15초)과 결제(15초)를 한다 — 플랫폼 기본 제한이 더 짧아 결제 도중 끊기지 않게 명시한다
export const maxDuration = 60;

/**
 * 토스 결제창 성공 주소 — 카드 등록 뒤 토스가 `?checkout=&locale=`에 `customerKey`·`authKey`를 붙여 보낸다.
 * 게이트(모드·로그인·설정)는 handleTossReturn, 빌링키 발급·첫 결제·카드 변경은 completeCheckout이 맡는다.
 * 결과: 구독·카드 변경·확인 중은 결제 관리로, 오류는 새 구독이면 그 가격의 결제 화면으로(없으면 결제 관리로).
 * 영수증 메일은 응답 뒤에 보낸다(deferMail). authKey는 어디에도 기록하지 않는다.
 */
export async function GET(request: Request) {
  return handleTossReturn(request, "callback", async ({ deps, user, livemode, locale, checkoutId, params }) => {
    if (!checkoutId) return callbackRedirectPath({ kind: "error", code: "notFound" }, locale);
    const authKey = params.get("authKey");
    const customerKey = params.get("customerKey");
    if (!authKey || !customerKey) {
      // 인증 결과 없이 돌아왔다 — 열린 시도를 닫아 다음 시도가 막히지 않게 하고 실패로 안내한다
      const closed = await failCheckout(deps, { checkoutId, userId: user.id, livemode, code: "MISSING_AUTH_RESULT" });
      return failRedirectPath({ ...closed, reason: "failed" }, locale);
    }
    const outcome = await completeCheckout(deps, {
      checkoutId,
      userId: user.id,
      livemode,
      authKey,
      customerKey,
      customerEmail: user.email ?? null,
    });
    return callbackRedirectPath(outcome, locale);
  });
}
