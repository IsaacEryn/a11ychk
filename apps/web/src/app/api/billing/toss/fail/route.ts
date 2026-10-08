import { failRedirectPath } from "@/lib/billing/checkout";
import { failCheckout } from "@/lib/billing/flows/subscribe";
import { handleTossReturn } from "@/lib/billing/tossReturn";

/**
 * 토스 결제창 실패 주소 — 사용자가 그만뒀거나 카드 등록이 실패하면 토스가 `?checkout=&locale=`에 `code`·`message`를 붙여 보낸다.
 * 시도를 failed로 닫고(진행 중인 처리와 엇갈리면 덮지 않는다) 새 구독이면 그 가격의 결제 화면으로, 카드 변경이면
 * 결제 관리로 돌려보낸다. 토스 message는 화면에 그대로 보이지 않고 기록하지도 않는다(코드로만 안내).
 */
export async function GET(request: Request) {
  return handleTossReturn(request, "fail", async ({ deps, user, livemode, locale, checkoutId, params }) => {
    const code = params.get("code") ?? "";
    if (!checkoutId) return failRedirectPath({ priceId: null, reason: "failed", purpose: null }, locale);
    const closed = await failCheckout(deps, { checkoutId, userId: user.id, livemode, code });
    return failRedirectPath(closed, locale);
  });
}
