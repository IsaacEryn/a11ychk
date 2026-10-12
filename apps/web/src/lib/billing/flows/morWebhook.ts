import "server-only";
import { UUID_RE } from "@/lib/billing/checkout";
import { PolarError, isPlainObject, isPolarOutcomeUnknown, type PolarRefund } from "@/lib/billing/polar";
import {
  MOR_CHECKOUT_FAILED,
  lowerUuid,
  markMorCheckout,
  morAttemptId,
  morAutoRefundId,
  morCheckoutOwner,
  recordMorOrder,
  syncMorSubscription,
} from "@/lib/billing/flows/mor";
import type { MorDeps, RefundRow, WebhookEventRecord } from "@/lib/billing/types";

/**
 * Polar 웹훅 처리 — 라우트(app/api/billing/webhooks/polar)가 서명을 확인한 뒤 부른다.
 *
 * 1) billing_webhook_events에 적는다(provider polar, event_id = webhook-id, payload는 {type, data_id}만 — 본문에는 이메일·주소가 있다).
 *    이미 처리한 이벤트면 아무것도 하지 않는다(재전송 멱등). 처리 전 행이면 attempts를 올리고 다시 처리한다.
 * 2) 본문의 상태는 믿지 않는다 — data.id만 꺼내 Polar API로 정본을 다시 읽고 flows/mor.ts의 동기화에 넘긴다.
 *    - subscription.* → 구독을 읽어 동기화
 *    - order.* → 주문을 읽고, 구독이 있으면 구독을 먼저 동기화(주문 단서와 함께)한 뒤 주문을 적는다 — 결제 행이 지금 기간과 구독 행에 이어진다
 *    - refund.created|updated → 환불을 읽어 우리 환불 기록(billing_refunds)을 맞추고, 그 주문을 주문 이벤트처럼 처리한다
 *    - checkout.updated|expired → 결제창을 읽어 succeeded면 구독을 동기화, expired·failed면 우리 결제 시도를 닫는다
 *    - 그 밖(customer.*·benefit*·product.*·organization.*·처음 보는 종류) → 처리한 것으로 적고 끝
 *    livemode는 배포의 결제 모드가 정한 값이다(본문에서 읽지 않는다).
 * 3) 끝까지 가면 processed_at. 동기화의 review·ungranted·stale·skipped도 처리된 것이다(필요한 기록은 흐름이 남겼다).
 *    Polar가 그 객체를 모르면(404) 다시 받아도 같으므로 기록 한 줄 뒤 처리된 것으로 끝낸다 — 구독·주문이면 needs review다(이 배포의
 *    토큰과 웹훅 끝점의 조직이 어긋나면 모든 이벤트가 404로 조용히 버려진다). 그 밖의 실패(결과 불명·저장소 오류·권한·한도)는
 *    last_error를 먼저 적고 던진다 — 라우트가 500으로 답해 Polar가 다시 보낸다. 처리를 마쳤는데 processed_at을 적지 못해도 기록 한 줄
 *    뒤 던진다. 흐름이 멱등이라 다시 처리해도 안전하다.
 * 4) 다시 받아도 같은 결과가 나올 실패(결정적 실패 — Polar 읽기 응답 모양 BAD_RESPONSE, 저장소 CHECK·FK 위반, INVALID_ID)가
 *    GIVE_UP_ATTEMPTS번째 전달에서도 나면 last_error를 남기고 처리된 것으로 끝낸다(200 + needs review 한 줄, 이벤트·대상 id).
 *    Polar는 연속 10번 실패한 끝점을 끄므로 고칠 수 없는 이벤트 하나가 모든 웹훅을 멈추게 두지 않는다. 그 이벤트의 반영은 빠진다 —
 *    크론의 MoR 대사는 기존 구독 행과 결과를 모르는 MoR 결제 행만 다시 읽으므로 새 구독은 메우지 못한다. 그리고 processed_at이
 *    적혀 있어 Polar에서 다시 보내도 duplicate로 무시된다. 복구는 운영자가 한다: 원인을 고친 뒤 관리자 테스트 도구의 "Polar 구독 id로
 *    지금 동기화"를 쓰거나, 그 이벤트의 processed_at을 비우고 Polar 대시보드에서 다시 보낸다(docs/SETUP.md "해외 결제 테스트(Polar)").
 *    결과 불명(NETWORK·5xx·408·쓰기 BAD_RESPONSE)은 몇 번째든 끝내지 않는다.
 * 기록은 id만 남긴다(본문·헤더·비밀 없음).
 */

export interface MorWebhookEvent {
  /** webhook-id 헤더 — 재전송에도 같다 */
  id: string;
  type: string;
  /** 본문 data.id(UUID, 소문자) — 없거나 모양이 다르면 null */
  dataId: string | null;
  /** 이 배포의 결제 모드가 만드는 행의 livemode(rowLivemode) */
  livemode: boolean;
}

/**
 * processed: 처리를 마쳤다(할 일이 없었던 것 포함) / duplicate: 이미 처리한 이벤트의 재전송 /
 * abandoned: 결정적 실패가 반복돼 반영하지 못한 채 처리된 것으로 끝냈다(needs review 기록 — 운영자가 processed_at을 비우고 다시 보내 복구한다)
 */
export type MorWebhookResult = "processed" | "duplicate" | "abandoned";

const TYPE_MAX = 100;
const ERROR_MAX = 300;
/** 결정적 실패를 처리된 것으로 끝내는 전달 횟수 — Polar가 끝점을 끄는 연속 실패(10번)보다 넉넉히 앞에서 */
const GIVE_UP_ATTEMPTS = 5;
/** Postgres CHECK 위반·FK 위반 — 같은 입력이면 다시 써도 같다 */
const DETERMINISTIC_DB_CODES = new Set(["23514", "23503"]);

/**
 * 서명을 확인한 본문에서 이벤트 종류와 대상 id만 꺼낸다 — 그 밖의 값(상태·고객 정보)은 돌려주지 않는다.
 * JSON 객체가 아니거나 type이 없으면 null(라우트가 400).
 */
export function parsePolarWebhookBody(body: string): { type: string; dataId: string | null } | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return null;
  }
  if (!isPlainObject(parsed)) return null;
  const { type, data } = parsed;
  if (typeof type !== "string" || type.length === 0 || type.length > TYPE_MAX) return null;
  return { type, dataId: isPlainObject(data) ? lowerUuid(data.id) : null };
}

/**
 * 다시 받아도 같은 결과가 나올 실패인지 — Polar 읽기 응답 모양(BAD_RESPONSE, 읽기만), 경로에 넣을 수 없는 id(INVALID_ID),
 * 저장소의 CHECK·FK 위반(store.ts가 PostgREST 코드를 code로 단다). 결과 불명(NETWORK·5xx·408·쓰기 BAD_RESPONSE)은 아니다 —
 * Polar가 처리했을 수 있고 다시 읽으면 달라질 수 있다.
 */
export function isDeterministicWebhookFailure(e: unknown): boolean {
  if (e instanceof PolarError) {
    if (isPolarOutcomeUnknown(e)) return false;
    return (e.code === "BAD_RESPONSE" && !e.mutating) || e.code === "INVALID_ID";
  }
  const code = e && typeof e === "object" ? (e as { code?: unknown }).code : undefined;
  return typeof code === "string" && DETERMINISTIC_DB_CODES.has(code);
}

/** last_error·기록에 남기는 실패 문구 — PolarError·저장소 오류의 메시지는 코드·상태·메서드만 담는다(본문·비밀 없음) */
function failureText(e: unknown): string {
  return (e instanceof Error ? e.message : "unknown error").slice(0, ERROR_MAX);
}

export async function handleMorWebhook(deps: MorDeps, event: MorWebhookEvent): Promise<MorWebhookResult> {
  const label = `billing polar webhook ${event.id} (${event.type})`;
  let recorded: WebhookEventRecord;
  try {
    recorded = await deps.store.recordWebhookEvent("polar", event.id, event.type, { type: event.type, data_id: event.dataId });
  } catch (e) {
    await deps.log(`${label} could not be recorded: ${failureText(e)}`);
    throw e;
  }
  if (recorded.state === "done") return "duplicate";

  try {
    await dispatch(deps, event);
  } catch (e) {
    const text = failureText(e);
    try {
      await deps.store.finishWebhookEvent("polar", event.id, { error: text });
    } catch {
      // 실패 기록이 안 돼도 원래 오류로 재시도를 받는다 — 아래 기록 한 줄이 남는다
    }
    if (recorded.attempts >= GIVE_UP_ATTEMPTS && isDeterministicWebhookFailure(e) && (await markGivenUp(deps, event.id))) {
      await deps.log(
        `billing needs review: polar webhook ${event.id} (${event.type}, data ${event.dataId ?? "none"}) failed ${recorded.attempts} times with a deterministic error (${text}); marked processed without applying it — fix the cause, clear processed_at of this event in billing_webhook_events and redeliver it from the Polar dashboard`,
      );
      return "abandoned";
    }
    await deps.log(`${label} failed: ${text}`);
    throw e;
  }
  try {
    await deps.store.finishWebhookEvent("polar", event.id, {});
  } catch (e) {
    // 반영은 끝났다 — 다시 받으면 같은 결과로 다시 처리한다(멱등)
    await deps.log(`${label} could not be marked processed: ${failureText(e)}`);
    throw e;
  }
  return "processed";
}

/** 결정적 실패를 처리된 것으로 적는다 — 적지 못하면 false(원래 오류로 재시도를 받아 다음 전달에서 다시 끝낸다) */
async function markGivenUp(deps: MorDeps, eventId: string): Promise<boolean> {
  try {
    await deps.store.finishWebhookEvent("polar", eventId, {});
    return true;
  } catch {
    return false;
  }
}

type Family = "subscription" | "order" | "refund" | "checkout";

function familyOf(type: string): Family | null {
  if (type.startsWith("subscription.")) return "subscription";
  if (type.startsWith("order.")) return "order";
  if (type === "refund.created" || type === "refund.updated") return "refund";
  if (type === "checkout.updated" || type === "checkout.expired") return "checkout";
  return null;
}

async function dispatch(deps: MorDeps, event: MorWebhookEvent): Promise<void> {
  const family = familyOf(event.type);
  if (!family) return;
  if (!event.dataId) {
    await deps.log(`billing polar webhook ${event.id} (${event.type}) has no usable data id; skipped`);
    return;
  }
  const ctx: Ctx = { deps, livemode: event.livemode, eventId: event.id };
  if (family === "subscription") return applySubscription(ctx, event.dataId);
  if (family === "order") return applyOrder(ctx, event.dataId);
  if (family === "refund") return applyRefund(ctx, event.dataId);
  return applyCheckout(ctx, event.dataId);
}

interface Ctx {
  deps: MorDeps;
  livemode: boolean;
  eventId: string;
}

/** 404가 needs review인 것 — 구독·주문은 Polar가 지우지 않는다. 없으면 토큰과 웹훅 끝점의 조직이 어긋났을 가능성이 크다 */
const REVIEW_IF_MISSING = new Set(["subscription", "order"]);

/**
 * Polar에서 정본을 다시 읽는다. 지워졌거나(404) id가 UUID가 아니면(INVALID_ID) 다시 받아도 같으니 기록 한 줄 뒤 null —
 * 구독·주문의 404는 needs review로 남긴다(조직 불일치 사고를 드러낸다). 그 밖(결과 불명·권한·한도·응답 모양)은 던진다 — 재시도가 처리한다.
 */
async function reread<T>(ctx: Ctx, what: "subscription" | "order" | "refund" | "checkout", id: string, read: (id: string) => Promise<T>): Promise<T | null> {
  try {
    return await read(id);
  } catch (e) {
    if (e instanceof PolarError && (e.status === 404 || e.code === "INVALID_ID")) {
      const shown = UUID_RE.test(id) ? id : "(malformed id)";
      const line = `polar ${what} ${shown} was not found at Polar; webhook event ${ctx.eventId} skipped`;
      await ctx.deps.log(
        e.status === 404 && REVIEW_IF_MISSING.has(what)
          ? `billing needs review: ${line} — check that the Polar access token belongs to the organization of the webhook endpoint`
          : `billing ${line}`,
      );
      return null;
    }
    throw e;
  }
}

async function applySubscription(ctx: Ctx, subscriptionId: string): Promise<void> {
  const sub = await reread(ctx, "subscription", subscriptionId, (id) => ctx.deps.polar.getSubscription(id));
  if (sub) await syncMorSubscription(ctx.deps, sub, ctx.livemode);
}

/**
 * 주문 — 구독을 먼저 동기화(주문 단서 orderId와 함께: 기간을 줄 수 없으면 이 주문을 환불한다)한 뒤 주문을 적는다.
 * 그래야 결제 행이 구독 행과 지금 기간에 이어진다. 구독이 Polar에 없으면 기록 한 줄 뒤 주문만 적는다.
 */
async function applyOrder(ctx: Ctx, orderId: string): Promise<void> {
  const order = await reread(ctx, "order", orderId, (id) => ctx.deps.polar.getOrder(id));
  if (!order) return;
  if (order.subscription_id) {
    const sub = await reread(ctx, "subscription", order.subscription_id, (id) => ctx.deps.polar.getSubscription(id));
    if (sub) await syncMorSubscription(ctx.deps, sub, ctx.livemode, { orderId: order.id });
  }
  await recordMorOrder(ctx.deps, order, ctx.livemode);
}

async function applyRefund(ctx: Ctx, refundId: string): Promise<void> {
  const refund = await reread(ctx, "refund", refundId, (id) => ctx.deps.polar.getRefund(id));
  if (!refund) return;
  await settleRefundRecord(ctx, refund);
  await applyOrder(ctx, refund.order_id);
}

/** Polar 환불 상태 → billing_refunds 상태(canceled는 돈이 돌아가지 않았으니 failed) */
const REFUND_STATUS = new Map<string, RefundRow["status"]>([
  ["pending", "pending"],
  ["succeeded", "succeeded"],
  ["failed", "failed"],
  ["canceled", "failed"],
]);

/**
 * 우리 환불 기록을 Polar 환불(정본)에 맞춘다 — 끝난 상태(succeeded·failed)를 따르고 pending으로는 되돌리지 않는다.
 * 기록은 Polar 환불 id로 찾고, 그 주문의 결제(provider mor·이 모드)의 기록일 때만 바꾼다. 자동 환불이 결과를 모른 채 Polar id 없이
 * 남았으면 Polar가 돌려준 metadata의 결제 id로 그 기록에 Polar id를 잇는다.
 * 자동 환불(결정적 id)이 failed가 되면 needs review 한 줄 — 고객에게 돈이 돌아가지 않았다. 이미 failed였으면 다시 남기지 않는다.
 * 끝 상태끼리 뒤집기(succeeded ↔ failed)는 쓰기 직전에 Polar 환불을 한 번 더 읽어 같은 상태일 때만 한다 — 늦게 읽은 값으로 확정된
 * 결과를 뒤집지 않게. 다르면 그대로 두고 다음 이벤트에 맡긴다.
 * 읽은 뒤 다른 요청이 기록을 바꿨으면 한 번 다시 읽어 맞추고, 그래도 엇갈리면 던진다(재시도).
 */
async function settleRefundRecord(ctx: Ctx, refund: PolarRefund): Promise<void> {
  const { deps } = ctx;
  const target = REFUND_STATUS.get(refund.status);
  if (!target) {
    await deps.log(`billing polar refund ${refund.id} has an unknown status; refund record left unchanged`);
    return;
  }
  // 환불 기록은 결제 행을 가리킨다(FK) — 우리 결제 기록이 없는 주문이면 환불 기록도 없다. 주문은 뒤에서 적는다
  const payment = await deps.store.getPaymentByExternal("mor", refund.order_id, ctx.livemode);
  if (!payment) return;

  for (let pass = 0; pass < 2; pass++) {
    const row = await refundRecordFor(ctx, refund, payment.id);
    if (!row) return;
    const patch: Partial<Pick<RefundRow, "status" | "external_refund_id">> = {};
    if (row.external_refund_id === null) patch.external_refund_id = refund.id;
    let next = target !== "pending" && target !== row.status ? target : undefined;
    if (next && row.status !== "pending") {
      const fresh = await deps.polar.getRefund(refund.id);
      if (REFUND_STATUS.get(fresh.status) !== next) next = undefined;
    }
    if (next) patch.status = next;
    if (Object.keys(patch).length === 0) return;
    if (!(await deps.store.updateRefundIf(row.id, { status: row.status, externalRefundId: row.external_refund_id }, patch))) continue;

    if (next && row.id === morAutoRefundId(row.payment_id)) {
      if (next === "failed") {
        await deps.log(
          `billing needs review: automatic refund ${refund.id} of order ${refund.order_id} (payment ${row.payment_id}) was ${refund.status} at Polar; the customer has not been refunded`,
        );
      } else if (row.status === "failed") {
        await deps.log(`billing automatic refund ${refund.id} of order ${refund.order_id} (payment ${row.payment_id}) succeeded at Polar after it was recorded as failed`);
      }
    }
    return;
  }
  throw new Error(`billing refund record for polar refund ${refund.id} changed during sync; retry later`);
}

async function refundRecordFor(ctx: Ctx, refund: PolarRefund, paymentId: string): Promise<RefundRow | null> {
  const { deps } = ctx;
  const linked = await deps.store.findRefundByExternal(refund.id);
  if (linked) {
    if (linked.payment_id === paymentId) return linked;
    await deps.log(`billing needs review: refund record ${linked.id} for Polar refund ${refund.id} points at another payment than order ${refund.order_id}; left unchanged`);
    return null;
  }
  // 자동 환불은 전용 키(refund_record_id)로 그 기록을 가리킨다(flows/mor.ts). 그 키가 있으면 그것만 본다
  const unlinked = (r: RefundRow | null) => (r && r.payment_id === paymentId && r.external_refund_id === null ? r : null);
  const recordId = lowerUuid(refund.metadata?.refund_record_id);
  if (recordId) return unlinked(await deps.store.getRefund(recordId));
  // 전용 키가 없던 자동 환불 — 우리 결제 id가 맞으면 그 결제의 자동 환불 id 기록만. 대시보드에서 한 환불은 metadata가 없어 잇지 않는다
  if (lowerUuid(refund.metadata?.payment_id) !== paymentId) return null;
  return unlinked(await deps.store.getRefund(morAutoRefundId(paymentId)));
}

/**
 * 결제창 — succeeded면 만들어진 구독을 다시 읽어 동기화한다(우리 시도는 동기화가 completed로 닫는다). 구독이 아직 없으면
 * subscription.* 이벤트가 맡는다. expired·failed면 우리 결제 시도(metadata.checkout_id)를 닫는다 — 결제창의 사용자가 그 시도의
 * 주인일 때만. 그 밖(open·confirmed·처음 보는 상태)은 할 일이 없다.
 */
async function applyCheckout(ctx: Ctx, checkoutId: string): Promise<void> {
  const { deps } = ctx;
  const checkout = await reread(ctx, "checkout", checkoutId, (id) => deps.polar.getCheckout(id));
  if (!checkout) return;
  if (checkout.status === "succeeded") {
    if (!checkout.subscription_id) return;
    await applySubscription(ctx, checkout.subscription_id);
    return;
  }
  const closing = checkout.status === "expired" ? "expired" : checkout.status === "failed" ? "failed" : null;
  if (!closing) return;
  const attemptId = morAttemptId(checkout.metadata);
  if (!attemptId) return;
  const owner = morCheckoutOwner(checkout);
  if (!owner) {
    await deps.log(`billing polar checkout ${checkout.id} has no usable user id; attempt ${attemptId} left as is`);
    return;
  }
  await markMorCheckout(deps, attemptId, closing, {
    livemode: ctx.livemode,
    userId: owner,
    failureCode: closing === "failed" ? MOR_CHECKOUT_FAILED : undefined,
  });
}
