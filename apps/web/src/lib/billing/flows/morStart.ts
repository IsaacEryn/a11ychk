import "server-only";
import {
  CHECKOUT_TTL_MS,
  MOR_DISCLOSURE_VERSION,
  UUID_RE,
  morCheckoutUrls,
  morConsentSnapshot,
  planCheckoutGuard,
  type CheckoutBlock,
  type CheckoutLocale,
} from "@/lib/billing/checkout";
import { MOR_CHECKOUT_FAILED, markMorCheckout } from "@/lib/billing/flows/mor";
import { yieldIfRaced } from "@/lib/billing/flows/start";
import { iso } from "@/lib/billing/period";
import { PolarError, isPolarOutcomeUnknown, type PolarCheckout } from "@/lib/billing/polar";
import { isPolarHostedUrl } from "@/lib/billing/polarRedirect";
import type { MorDeps, PriceRow } from "@/lib/billing/types";

/**
 * 해외(판매 대행 Polar) 구독의 결제 시작 — 결제 시도(billing_checkouts, provider mor)를 만들고 Polar 결제창 주소를 돌려준다.
 * 서버 액션(lib/actions/billing.ts startMorCheckoutAction)이 로그인·모드·Polar 키·공개 범위·요청 origin을 확인한 뒤 부른다.
 * 브라우저는 돌려받은 주소를 호스트 허용 목록(polarRedirect.ts)으로 다시 검사한 뒤 이동한다.
 *
 * 순서: 가격(mor·USD·활성·같은 모드·Polar 상품 id) → 진행 중 구독(결제사 무관 — 사용자·모드당 1건) → 결과를 모르는 첫 결제
 * (결제사 무관) → 끝나지 않은 시도 정리 → 시도 → 동의 기록 → Polar 결제창.
 * 끝나지 않은 시도: 만료 전 open은 닫고(superseded) 새로 연다 — 그만둔 결제창이다. 토스 open도 닫는다(그 콜백은 만료로 끝나 카드를
 * 등록하지 않는다). 처리 중(processing)이면 기다려야 한다(inProgress). 만든 뒤 다른 시도가 보이면 물러난다(토스와 같은 yieldIfRaced).
 *
 * Polar 결제창 생성이 확정 실패면 시도를 failed(polarCheckoutFailed)로 닫고, 결과 불명이면 열어 둔다 — 아직 아무것도 청구되지 않았고
 * 다음 시작이 닫는다. 결제창 금액·통화·결제 주기가 가격 행과 다르면(관리자가 넣은 값과 Polar 상품이 어긋남) 확인 화면에 보인 조건과
 * 다르므로 열지 않는다. 기록은 id·코드만 남긴다(이메일·금액 없음). 저장소 오류는 던진다(액션이 기록하고 failed).
 */

export type MorStartError = "invalid" | "priceInactive" | "hasActive" | "inProgress" | "failed";
export type MorStartOutcome =
  | { ok: true; url: string; checkoutId: string }
  | { ok: false; error: MorStartError; blockedBy?: CheckoutBlock };

export interface MorStartInput {
  userId: string;
  /** Polar 결제창에 미리 채운다 — 없으면 보내지 않는다 */
  email: string | null;
  livemode: boolean;
  priceId: string;
  locale: CheckoutLocale;
  /** 검증한 요청 origin(requestOrigin) */
  origin: string;
}

/** 결제창 금액·통화가 가격 행과 다른 시도의 실패 코드 */
const PRICE_MISMATCH = "priceMismatch";

const polarCode = (e: unknown) => (e instanceof PolarError ? `${e.code} ${e.status}` : "unexpected error");

/** 가격 행의 Polar 상품 id — mor·USD·활성·같은 모드이고 상품 id가 UUID일 때만. 그 밖은 null(판매하지 않는 가격) */
async function sellablePrice(deps: MorDeps, input: MorStartInput): Promise<{ price: PriceRow; productId: string } | null> {
  const price = await deps.store.getPrice(input.priceId.toLowerCase());
  if (!price || price.provider !== "mor" || price.currency !== "USD" || !price.active || price.livemode !== input.livemode) return null;
  const productId = price.external_price_id;
  if (!productId || !UUID_RE.test(productId)) {
    await deps.log(`billing mor price ${price.id} has no usable Polar product id`);
    return null;
  }
  return { price, productId };
}

/** 같은 사용자·모드의 끝나지 않은 시도 정리 — 처리 중인 시도가 남으면 processing, 아니면 open을 모두 닫고 null */
async function settleUnfinished(deps: MorDeps, userId: string, livemode: boolean): Promise<CheckoutBlock | null> {
  const { store } = deps;
  const unfinished = await store.listUnfinishedCheckouts(userId, livemode);
  // 결과를 모르는 첫 결제는 앞에서 막았다
  const plan = planCheckoutGuard(unfinished, { now: deps.now(), pendingInitialPayment: false });
  await store.expireCheckouts(plan.expireOpen, "open", null);
  await store.expireCheckouts(plan.expireProcessing, "processing", "stale");
  if (plan.blockedBy === "processing") return "processing";
  const abandoned = unfinished.filter((c) => c.status === "open" && !plan.expireOpen.includes(c.id)).map((c) => c.id);
  await store.expireCheckouts(abandoned, "open", "superseded");
  return null;
}

/** 결제창이 확인 화면에 보인 가격과 같은지(금액·통화·결제 주기) — Polar가 값을 주지 않으면 그 항목은 비교하지 않는다 */
function matchesPrice(checkout: PolarCheckout, price: PriceRow): boolean {
  const amountOk = checkout.amount === null || checkout.amount === price.amount;
  const currencyOk = checkout.currency === null || checkout.currency.toLowerCase() === price.currency.toLowerCase();
  const intervalOk = checkout.recurring_interval === null || checkout.recurring_interval === price.interval;
  return amountOk && currencyOk && intervalOk;
}

export async function startMorCheckout(deps: MorDeps, input: MorStartInput): Promise<MorStartOutcome> {
  const { store } = deps;
  if (!UUID_RE.test(input.priceId)) return { ok: false, error: "invalid" };
  const sellable = await sellablePrice(deps, input);
  if (!sellable) return { ok: false, error: "priceInactive" };
  const { price, productId } = sellable;

  if (await store.getLiveSubscription(input.userId, input.livemode)) return { ok: false, error: "hasActive" };
  // 결제사를 보지 않는다 — 결과를 모르는 토스 첫 결제도 MoR 결제를 막는다(사용자·모드당 진행 중 구독 1건)
  if (await store.hasPendingInitialPayment(input.userId, input.livemode)) return { ok: false, error: "inProgress", blockedBy: "processing" };
  const blocked = await settleUnfinished(deps, input.userId, input.livemode);
  if (blocked) return { ok: false, error: "inProgress", blockedBy: blocked };

  const now = deps.now();
  const attempt = await store.insertCheckout({
    user_id: input.userId,
    provider: "mor",
    livemode: input.livemode,
    price_id: price.id,
    purpose: "subscribe",
    subscription_id: null,
    expires_at: iso(now + CHECKOUT_TTL_MS),
  });
  try {
    const raced = await yieldIfRaced(deps, attempt);
    if (raced) return { ok: false, error: "inProgress", blockedBy: raced };
    await store.insertConsent({
      user_id: input.userId,
      checkout_id: attempt.id,
      kind: "recurring_payment",
      disclosure_version: MOR_DISCLOSURE_VERSION,
      snapshot: morConsentSnapshot(price, now, input.locale),
    });
  } catch (e) {
    // 열린 채로 두면 새 시도가 닫기 전까지 남는다 — 닫고 던진다
    await store.expireCheckouts([attempt.id], "open", "startFailed").catch(() => undefined);
    throw e;
  }

  const urls = morCheckoutUrls(input.origin, price.id, input.locale);
  const ref = `billing mor checkout ${attempt.id} for user ${input.userId}`;
  const close = (failureCode: string) => markMorCheckout(deps, attempt.id, "failed", { livemode: input.livemode, userId: input.userId, failureCode });
  let checkout: PolarCheckout;
  try {
    checkout = await deps.polar.createCheckout({
      products: [productId],
      external_customer_id: input.userId,
      ...(input.email ? { customer_email: input.email } : {}),
      success_url: urls.successUrl,
      return_url: urls.returnUrl,
      // 웹훅·복귀 라우트가 우리 시도·사용자·모드를 읽는다(주문·구독으로 복사된다)
      metadata: { checkout_id: attempt.id, user_id: input.userId, livemode: input.livemode, locale: input.locale },
      locale: input.locale,
    });
  } catch (e) {
    if (e instanceof PolarError && !isPolarOutcomeUnknown(e)) {
      await deps.log(`${ref}: Polar createCheckout failed (${polarCode(e)})`);
      await close(MOR_CHECKOUT_FAILED);
    } else {
      // Polar가 결제창을 만들었을 수 있지만 주소는 사용자에게 가지 않았다 — 시도는 열어 두고 다음 시작이 닫는다
      await deps.log(`${ref}: Polar createCheckout outcome unknown (${polarCode(e)}); attempt left open`);
    }
    return { ok: false, error: "failed" };
  }

  if (!matchesPrice(checkout, price)) {
    await deps.log(`billing needs review: mor price ${price.id} does not match Polar checkout ${checkout.id} (amount, currency or interval); checkout not opened`);
    await close(PRICE_MISMATCH);
    return { ok: false, error: "priceInactive" };
  }
  if (!isPolarHostedUrl(checkout.url)) {
    await deps.log(`${ref}: Polar returned a checkout url outside polar.sh; not opened`);
    await close(MOR_CHECKOUT_FAILED);
    return { ok: false, error: "failed" };
  }
  return { ok: true, url: checkout.url, checkoutId: attempt.id };
}
