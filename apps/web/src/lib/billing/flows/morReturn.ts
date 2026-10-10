import "server-only";
import { callbackRedirectPath, checkoutErrorPath, checkoutLocale, type CheckoutLocale } from "@/lib/billing/checkout";
import { errorText } from "@/lib/billing/errorText";
import { MOR_CHECKOUT_FAILED, markMorCheckout, morAttemptId, morCheckoutOwner, syncMorSubscription } from "@/lib/billing/flows/mor";
import { PolarError, type PolarCheckout } from "@/lib/billing/polar";
import type { MorDeps } from "@/lib/billing/types";

/**
 * Polar 결제창에서 돌아온 뒤 갈 내부 경로 — 라우트(app/api/billing/polar/return)가 모드·로그인·checkout_id 모양을 확인한 뒤 부른다.
 *
 * 결제창을 Polar API로 다시 읽어(주소의 값은 id만 믿는다) 그 사용자(external_customer_id, 없으면 metadata.user_id)의 것이고
 * metadata.livemode가 이 배포의 모드와 같을 때만 진행한다. 아니면 notFound(시도·구독을 건드리지 않는다).
 * - succeeded: 만들어진 구독을 다시 읽어 바로 동기화한다(웹훅을 기다리지 않고 권한을 준다). 진행 중(active)이면 subscribed,
 *   돈 안전 불변식으로 해지·환불했으면 결제 확인 화면에 duplicateRefunded, 그 밖(미납·미완료·읽기 실패)은 pending — 웹훅·크론이
 *   마친다(syncSucceeded). 실패는 기록 한 줄(id만).
 * - confirmed·open·처음 보는 상태: pending.
 * - expired·failed: 우리 결제 시도를 닫고(markMorCheckout — 그 사용자·MoR·같은 모드·끝나지 않은 시도만) 그 가격의 결제 확인 화면에 오류.
 * - Polar가 결제창을 모르면(404) notFound, 읽기가 그 밖으로 실패하면 pending(결제가 됐을 수 있다).
 * 로케일은 metadata.locale → 결제창 locale → fallbackLocale 순이고 ko·en만 받는다. 주인이 아닌 결제창의 값은 쓰지 않는다.
 * 돌려주는 경로는 모두 내부 경로다(로케일·우리 DB의 가격 id만 싣는다). 저장소 오류(시도 닫기)는 던진다 — 라우트가 기록하고 failed.
 */

export interface MorReturnInput {
  /** Polar 결제창 id(소문자 UUID) */
  checkoutId: string;
  userId: string;
  /** 이 배포의 결제 모드가 만드는 행의 livemode */
  livemode: boolean;
  /** 결제창을 믿을 수 없을 때의 로케일(라우트가 로케일 쿠키로 정한다) */
  fallbackLocale: CheckoutLocale;
}

const knownLocale = (v: unknown): CheckoutLocale | null => (v === "ko" || v === "en" ? checkoutLocale(v) : null);

function localeOf(checkout: PolarCheckout, fallback: CheckoutLocale): CheckoutLocale {
  return knownLocale(checkout.metadata.locale) ?? knownLocale(checkout.locale) ?? fallback;
}

/** 오류 안내 — 그 사용자의 MoR 새 구독 시도면 그 가격의 결제 확인 화면, 아니면 결제 관리 */
async function errorPath(
  deps: MorDeps,
  attemptId: string | null,
  input: MorReturnInput,
  locale: CheckoutLocale,
  code: "expired" | "failed" | "duplicateRefunded",
): Promise<string> {
  const attempt = attemptId ? await deps.store.getCheckout(attemptId) : null;
  const mine = attempt && attempt.user_id === input.userId && attempt.provider === "mor" && attempt.livemode === input.livemode && attempt.purpose === "subscribe";
  return checkoutErrorPath(locale, mine ? attempt.price_id : null, code);
}

/**
 * 결제가 끝난 결제창 — 구독을 다시 읽어 동기화하고 결과로 안내한다.
 * - applied·active: subscribed. 그 밖의 applied(미납 등): pending.
 * - stale(웹훅이 더 새로운 상태를 먼저 적었다): 우리 행이 이 사용자의 active면 subscribed, 아니면 pending.
 * - ungranted(돈 안전 불변식으로 해지·환불 — 이미 다른 진행 중 구독이 있다): 토스 콜백과 같이 그 가격의 결제 확인 화면에 duplicateRefunded.
 * - 그 밖(skipped·review): pending. 읽기·동기화·판정 중 오류도 기록 한 줄 뒤 pending — 웹훅·크론이 마친다.
 */
async function syncSucceeded(
  deps: MorDeps,
  checkout: PolarCheckout,
  attemptId: string | null,
  input: MorReturnInput,
  locale: CheckoutLocale,
): Promise<string> {
  const pending = callbackRedirectPath({ kind: "pending" }, locale);
  const subscribed = (subscriptionId: string) => callbackRedirectPath({ kind: "subscribed", subscriptionId }, locale);
  if (!checkout.subscription_id) return pending;
  try {
    const sub = await deps.polar.getSubscription(checkout.subscription_id);
    const result = await syncMorSubscription(deps, sub, input.livemode);
    switch (result.kind) {
      case "applied":
        return result.status === "active" ? subscribed(result.subscriptionId) : pending;
      case "stale": {
        const row = await deps.store.getSubscription(result.subscriptionId);
        return row && row.status === "active" && row.user_id === input.userId && row.livemode === input.livemode ? subscribed(row.id) : pending;
      }
      case "ungranted":
        return await errorPath(deps, attemptId, input, locale, "duplicateRefunded");
      default:
        return pending;
    }
  } catch (e) {
    await deps.log(`billing polar return: subscription ${checkout.subscription_id} of checkout ${checkout.id} was not synced: ${errorText(e)}; shown as pending`);
    return pending;
  }
}

export async function morReturnPath(deps: MorDeps, input: MorReturnInput): Promise<string> {
  let checkout: PolarCheckout;
  try {
    checkout = await deps.polar.getCheckout(input.checkoutId);
  } catch (e) {
    if (e instanceof PolarError && (e.status === 404 || e.code === "INVALID_ID")) return checkoutErrorPath(input.fallbackLocale, null, "notFound");
    await deps.log(`billing polar return: checkout ${input.checkoutId} could not be read: ${errorText(e)}; shown as pending`);
    return callbackRedirectPath({ kind: "pending" }, input.fallbackLocale);
  }
  // 주인·모드가 맞지 않는 결제창은 없는 것으로 본다 — 그 값(로케일 포함)도 쓰지 않는다
  if (morCheckoutOwner(checkout) !== input.userId || checkout.metadata.livemode !== input.livemode) {
    return checkoutErrorPath(input.fallbackLocale, null, "notFound");
  }

  const locale = localeOf(checkout, input.fallbackLocale);
  const attemptId = morAttemptId(checkout.metadata);
  switch (checkout.status) {
    case "succeeded":
      return syncSucceeded(deps, checkout, attemptId, input, locale);
    case "expired":
      if (attemptId) await markMorCheckout(deps, attemptId, "expired", { livemode: input.livemode, userId: input.userId });
      return errorPath(deps, attemptId, input, locale, "expired");
    case "failed":
      if (attemptId) {
        await markMorCheckout(deps, attemptId, "failed", { livemode: input.livemode, userId: input.userId, failureCode: MOR_CHECKOUT_FAILED });
      }
      return errorPath(deps, attemptId, input, locale, "failed");
    default:
      // confirmed(결제 처리 중)·open·처음 보는 상태 — 결과는 웹훅이 알린다
      return callbackRedirectPath({ kind: "pending" }, locale);
  }
}
