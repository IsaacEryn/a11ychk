import "server-only";
import { NextResponse } from "next/server";
import type { User } from "@supabase/supabase-js";
import { UUID_RE, checkoutErrorPath, checkoutLocale, requestOrigin, tossReturnParams, type CheckoutLocale } from "@/lib/billing/checkout";
import { billingMode, rowLivemode } from "@/lib/billing/config";
import { errorText } from "@/lib/billing/flows/subscribe";
import { createBillingDeps, createSupabaseBillingStore } from "@/lib/billing/server";
import type { BillingDeps } from "@/lib/billing/types";
import { logAppError } from "@/lib/logs";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

/**
 * 토스 결제창에서 돌아온 요청(성공 콜백·실패)의 공통 게이트.
 * - 결제 모드 off면 404(결제 API 없음).
 * - 로그인 세션이 없으면 로그인으로(next 없이 — 이 URL에는 authKey가 실려 와 다른 주소에 옮기지 않는다).
 * - 결제 설정(토스 키·암호화 키)이 없으면 notConfigured로 안내.
 * - 통과하면 handle이 돌려준 내부 경로로 303 — 예외는 기록 뒤 error=failed. origin은 결제 액션과 같은 규칙(검증한 Host
 *   헤더)으로 만든다: 브라우저가 쓴 호스트로 돌아가야 로그인 쿠키가 따라온다(request.url은 127.0.0.1을 localhost로 바꿔 줄 때가 있다).
 *   헤더가 규칙에 맞지 않으면 request.url의 origin.
 * 기록에는 요청 URL·쿼리를 넣지 않는다(authKey).
 */

export interface TossReturnContext {
  deps: BillingDeps;
  user: User;
  /** 이 서버의 결제 모드가 만드는 행의 livemode */
  livemode: boolean;
  locale: CheckoutLocale;
  /** UUID가 아니면 null */
  checkoutId: string | null;
  params: URLSearchParams;
}

/** 설정이 없을 때 — 그 사용자의 새 구독 시도면 그 가격의 결제 화면으로, 아니면 결제 관리로 */
async function notConfiguredPath(ctx: { checkoutId: string | null; userId: string; livemode: boolean; locale: CheckoutLocale }): Promise<string> {
  let priceId: string | null = null;
  if (ctx.checkoutId) {
    try {
      const checkout = await createSupabaseBillingStore(createAdminClient()).getCheckout(ctx.checkoutId);
      if (checkout && checkout.user_id === ctx.userId && checkout.livemode === ctx.livemode && checkout.purpose === "subscribe") {
        priceId = checkout.price_id;
      }
    } catch {
      // 시도를 읽지 못해도 안내는 같다 — 결제 관리로
    }
  }
  return checkoutErrorPath(ctx.locale, priceId, "notConfigured");
}

async function logFailure(message: string): Promise<void> {
  try {
    await logAppError(createAdminClient(), message, { path: "billing" });
  } catch {
    // 관리자 클라이언트를 만들 수 없으면(환경변수 없음) 기록을 건너뛴다
  }
}

export async function handleTossReturn(
  request: Request,
  kind: "callback" | "fail",
  handle: (ctx: TossReturnContext) => Promise<string>,
): Promise<NextResponse> {
  const livemode = rowLivemode(billingMode());
  if (livemode === null) return new NextResponse("Not Found", { status: 404 });

  const url = new URL(request.url);
  const params = tossReturnParams(url.search);
  const locale = checkoutLocale(params.get("locale"));
  const origin = requestOrigin(request.headers) ?? url.origin;
  const go = (path: string) => NextResponse.redirect(new URL(path, origin), 303);
  const rawId = params.get("checkout") ?? "";
  const checkoutId = UUID_RE.test(rawId) ? rawId.toLowerCase() : null;

  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return go(`/${locale}/login`);
    const deps = createBillingDeps({ deferMail: true });
    if (!deps) return go(await notConfiguredPath({ checkoutId, userId: user.id, livemode, locale }));
    return go(await handle({ deps, user, livemode, locale, checkoutId, params }));
  } catch (e) {
    await logFailure(`billing toss ${kind} failed for checkout ${checkoutId ?? "invalid"}: ${errorText(e)}`);
    return go(checkoutErrorPath(locale, null, "failed"));
  }
}
