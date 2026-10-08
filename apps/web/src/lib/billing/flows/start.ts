import "server-only";
import { randomUUID } from "node:crypto";
import {
  CHECKOUT_TTL_MS,
  DISCLOSURE_VERSION,
  consentSnapshot,
  isCardChangeTarget,
  planCheckoutGuard,
  type CheckoutLocale,
} from "@/lib/billing/checkout";
import { errorText } from "@/lib/billing/flows/subscribe";
import type { BillingDeps, CheckoutRow } from "@/lib/billing/types";

/**
 * 결제창을 열기 전의 흐름 — 결제 시도(billing_checkouts)를 만들고 토스 고객 키를 돌려준다.
 * 서버 액션(lib/actions/billing.ts)이 로그인·모드·공개 범위·요청 origin을 확인한 뒤 부른다.
 * 금액은 가격 행에서만 읽고, 시도에는 가격 id만 적는다(콜백이 가격 행을 다시 읽는다).
 *
 * 한 사용자·모드에는 끝나지 않은 시도가 하나만 있게 한다(planCheckoutGuard). 확인과 insert 사이에 다른 요청이
 * 끼어들 수 있어, 만든 뒤 다시 보고 다른 시도가 있으면 방금 만든 시도를 물린다 — 둘 다 물러날 수는 있어도
 * 둘 다 결제창을 여는 일은 없다.
 */

export type StartError = "notAllowed" | "hasActive" | "priceInactive" | "inProgress" | "failed";
export type StartOutcome = { ok: true; checkoutId: string; customerKey: string } | { ok: false; error: StartError };

type StartDeps = Pick<BillingDeps, "store" | "now" | "log">;

const iso = (t: number) => new Date(t).toISOString();

/** 같은 사용자·모드의 끝나지 않은 시도를 정리하고, 그래도 진행 중인 시도·결제가 있으면 true */
async function isBusy(deps: StartDeps, userId: string, livemode: boolean): Promise<boolean> {
  const { store } = deps;
  const [unfinished, pendingInitialPayment] = await Promise.all([
    store.listUnfinishedCheckouts(userId, livemode),
    store.hasPendingInitialPayment(userId, livemode),
  ]);
  const plan = planCheckoutGuard(unfinished, { now: deps.now(), pendingInitialPayment });
  // 정리는 지금 상태가 그대로일 때만 바꾼다 — 그 사이 선점·완료된 시도는 덮지 않는다
  await store.expireCheckouts(plan.expireOpen, "open", null);
  await store.expireCheckouts(plan.expireProcessing, "processing", "stale");
  return plan.blocked;
}

/** 만든 뒤 다시 확인 — 다른 끝나지 않은 시도가 보이면 방금 만든 시도를 물린다(true = 물렸다) */
async function yieldIfRaced(deps: StartDeps, created: CheckoutRow): Promise<boolean> {
  const unfinished = await deps.store.listUnfinishedCheckouts(created.user_id, created.livemode);
  if (!unfinished.some((c) => c.id !== created.id)) return false;
  await deps.store.expireCheckouts([created.id], "open", "superseded");
  return true;
}

async function openCheckout(
  deps: StartDeps,
  row: { userId: string; livemode: boolean; priceId: string; purpose: CheckoutRow["purpose"]; subscriptionId: string | null },
  afterInsert?: (checkout: CheckoutRow) => Promise<void>,
): Promise<StartOutcome> {
  const { store } = deps;
  if (await isBusy(deps, row.userId, row.livemode)) return { ok: false, error: "inProgress" };

  const customer = await store.ensureCustomer(row.userId, row.livemode, randomUUID());
  const checkout = await store.insertCheckout({
    user_id: row.userId,
    provider: "toss",
    livemode: row.livemode,
    price_id: row.priceId,
    purpose: row.purpose,
    subscription_id: row.subscriptionId,
    expires_at: iso(deps.now() + CHECKOUT_TTL_MS),
  });
  try {
    if (await yieldIfRaced(deps, checkout)) return { ok: false, error: "inProgress" };
    if (afterInsert) await afterInsert(checkout);
  } catch (e) {
    // 열린 채로 두면 30분 동안 새 시도를 막는다 — 닫고 실패로 돌려준다
    await store.expireCheckouts([checkout.id], "open", "startFailed").catch(() => undefined);
    throw e;
  }
  return { ok: true, checkoutId: checkout.id, customerKey: customer.toss_customer_key };
}

/**
 * 새 구독의 결제 시도 — 가격(활성·토스·원화·같은 모드) → 진행 중 구독 → 진행 중 시도 → 고객 키 → 시도 →
 * 정기결제 동의 기록(확인 화면과 같은 조건의 스냅샷). 저장소 오류는 던진다(액션이 기록하고 failed).
 */
export async function startSubscribeCheckout(
  deps: StartDeps,
  input: { userId: string; livemode: boolean; priceId: string; locale: CheckoutLocale },
): Promise<StartOutcome> {
  const { store } = deps;
  const price = await store.getPrice(input.priceId);
  if (!price || !price.active || price.provider !== "toss" || price.currency !== "KRW" || price.livemode !== input.livemode) {
    return { ok: false, error: "priceInactive" };
  }
  if (await store.getLiveSubscription(input.userId, input.livemode)) return { ok: false, error: "hasActive" };

  const now = deps.now();
  return openCheckout(
    deps,
    { userId: input.userId, livemode: input.livemode, priceId: price.id, purpose: "subscribe", subscriptionId: null },
    (checkout) =>
      store.insertConsent({
        user_id: input.userId,
        checkout_id: checkout.id,
        kind: "recurring_payment",
        disclosure_version: DISCLOSURE_VERSION,
        snapshot: consentSnapshot(price, now, input.locale),
      }),
  );
}

/**
 * 카드 변경의 결제 시도 — 그 사용자의 진행 중 토스 구독(같은 모드)일 때만. 가격은 구독의 가격 행을 적는다
 * (금액은 구독 스냅샷으로 결제하고, 시도의 가격 id는 참조용이다). 새 동의는 받지 않는다 — 조건이 바뀌지 않는다.
 */
export async function startCardChangeCheckout(
  deps: StartDeps,
  input: { userId: string; livemode: boolean; subscriptionId: string },
): Promise<StartOutcome> {
  const sub = await deps.store.getSubscription(input.subscriptionId);
  if (!sub || !isCardChangeTarget(sub, input.userId, input.livemode)) return { ok: false, error: "notAllowed" };
  if (!sub.price_id) {
    await deps.log(`billing card change: subscription ${sub.id} has no price`);
    return { ok: false, error: "failed" };
  }
  return openCheckout(deps, { userId: input.userId, livemode: input.livemode, priceId: sub.price_id, purpose: "card_change", subscriptionId: sub.id });
}

/**
 * 사용자가 그만둔 결제 시도를 닫는다 — 결제창을 닫았거나(SDK 오류) 뒤로 가기로 돌아온 경우. 선점 전(open)만 닫는다:
 * 이미 콜백이 처리 중인 시도는 건드리지 않는다. 닫힌 시도로 늦게 돌아오면 콜백은 "만료"로 안내하고 빌링키를 발급하지 않는다.
 */
export async function abandonOpenCheckouts(deps: StartDeps, input: { userId: string; livemode: boolean }): Promise<number> {
  try {
    const open = (await deps.store.listUnfinishedCheckouts(input.userId, input.livemode)).filter((c) => c.status === "open");
    await deps.store.expireCheckouts(
      open.map((c) => c.id),
      "open",
      "abandoned",
    );
    return open.length;
  } catch (e) {
    await deps.log(`billing abandonOpenCheckouts failed for user ${input.userId}: ${errorText(e)}`);
    return 0;
  }
}
