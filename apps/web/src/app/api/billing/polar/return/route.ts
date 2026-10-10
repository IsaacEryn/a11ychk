import { NextResponse } from "next/server";
import { UUID_RE, checkoutErrorPath, checkoutLocale, requestOrigin, type CheckoutLocale } from "@/lib/billing/checkout";
import { billingMode, rowLivemode } from "@/lib/billing/config";
import { morReturnPath } from "@/lib/billing/flows/morReturn";
import { errorText } from "@/lib/billing/flows/subscribe";
import { createMorDeps } from "@/lib/billing/server";
import { logAppError } from "@/lib/logs";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

// 결제창 조회·구독 조회(각 Polar 제한 15초)와 동기화를 한 요청에서 한다 — 플랫폼 기본 제한이 더 짧아 도중에 끊기지 않게 명시한다
export const maxDuration = 30;
// 결제 모드(환경변수)로 404를 가른다 — 빌드 때의 값으로 굳지 않게
export const dynamic = "force-dynamic";

/** next-intl 로케일 쿠키 — 결제창을 읽기 전(비로그인·잘못된 id·예외)의 안내 로케일. ko·en만, 없으면 ko */
function cookieLocale(request: Request): CheckoutLocale {
  const m = /(?:^|;\s*)NEXT_LOCALE=([^;]*)/.exec(request.headers.get("cookie") ?? "");
  return checkoutLocale(m?.[1]);
}

async function logFailure(message: string): Promise<void> {
  try {
    await logAppError(createAdminClient(), message, { path: "billing" });
  } catch {
    // 관리자 클라이언트를 만들 수 없으면(환경변수 없음) 기록을 건너뛴다
  }
}

/**
 * Polar 결제창 성공 주소 — 결제를 마치면 Polar가 `?checkout_id=<결제창 id>`로 보낸다(결제 시작이 `{CHECKOUT_ID}`로 넣은 주소).
 * 토스 복귀(tossReturn.ts)와 같은 게이트: 결제 모드 off면 404, 로그인 세션이 없으면 로그인으로(next 없이), id가 UUID가 아니면
 * notFound, Polar 설정이 없으면 notConfigured. 통과하면 결제창을 다시 읽어 동기화한 결과(flows/morReturn.ts)의 내부 경로로 303.
 * 예외는 기록(id만) 뒤 error=failed. origin은 결제 액션과 같은 규칙(검증한 Host 헤더) — 브라우저가 쓴 호스트로 돌아가야
 * 로그인 쿠키가 따라온다. 헤더가 규칙에 맞지 않으면 request.url의 origin.
 */
export async function GET(request: Request) {
  const livemode = rowLivemode(billingMode());
  if (livemode === null) return new NextResponse("Not Found", { status: 404 });

  const url = new URL(request.url);
  const origin = requestOrigin(request.headers) ?? url.origin;
  const go = (path: string) => NextResponse.redirect(new URL(path, origin), 303);
  const fallbackLocale = cookieLocale(request);
  const rawId = url.searchParams.get("checkout_id") ?? "";
  const checkoutId = UUID_RE.test(rawId) ? rawId.toLowerCase() : null;

  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return go(`/${fallbackLocale}/login`);
    if (!checkoutId) return go(checkoutErrorPath(fallbackLocale, null, "notFound"));
    const deps = createMorDeps();
    if (!deps) return go(checkoutErrorPath(fallbackLocale, null, "notConfigured"));
    return go(await morReturnPath(deps, { checkoutId, userId: user.id, livemode, fallbackLocale }));
  } catch (e) {
    await logFailure(`billing polar return failed for checkout ${checkoutId ?? "invalid"}: ${errorText(e)}`);
    return go(checkoutErrorPath(fallbackLocale, null, "failed"));
  }
}
