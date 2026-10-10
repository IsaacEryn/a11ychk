import "server-only";
import { graceUntil, iso } from "@/lib/billing/period";
import { PolarError, isPolarOutcomeUnknown, type PolarMetadata, type PolarOrder, type PolarSubscription } from "@/lib/billing/polar";
import type {
  MorDeps,
  MorSubscriptionPatch,
  MorSubscriptionRow,
  NewExternalPayment,
  PaymentRow,
  PriceRow,
  SubscriptionRow,
} from "@/lib/billing/types";

/**
 * 판매 대행(Polar) 구독·주문을 우리 결제 기록(subscriptions·billing_payments·billing_refunds)에 맞추는 흐름.
 * 웹훅(Task 3)·결제창 복귀(Task 4)·크론 대사와 탈퇴(Task 5)가 부른다. 입력은 늘 Polar API로 다시 읽은 정본이다 —
 * 웹훅 본문의 상태는 믿지 않는다.
 *
 * 순서: 구독 행은 Polar의 modified_at(없으면 created_at)이 저장된 external_updated_at보다 새롭거나 같을 때만 바꾼다.
 * 같으면 재전송이라 같은 값을 다시 적고(멱등), 오래됐으면 "stale"로 무시한다. 판정은 저장소의 조건부 갱신이 한다
 * (읽고 나서 조건 없이 쓰지 않는다). 시각은 마이크로초까지 비교한다 — Polar 시각은 소수 6자리이고 Date.parse는 밀리초에서 자른다.
 *
 * 돈 안전 불변식(토스 renew.ts의 refundUngranted와 같은 뜻): 결제된 Polar 구독에 기간을 줄 수 없으면 — 그 사용자·모드에
 * 다른 진행 중 구독이 이미 있거나(유니크 충돌), 사용자가 없거나(탈퇴), 일시정지에서 돌아왔는데 다른 진행 중 구독이 있으면 —
 * Polar 구독을 즉시 해지(revoke)하고 그 주문을 전액 환불한다. 같은 주문은 두 번 환불하지 않는다(billing_refunds 기록 + Polar의
 * RefundedAlready). 결과 불명인 쓰기(해지·환불)는 한 번만 다시 읽어 확인하고, 그래도 모르면 needs review로 멈춘다(반복하지 않는다).
 *
 * 모르는 값(상태·주기·통화)은 needs review로 보내고 행을 만들거나 바꾸지 않는다 — 진행 중 행을 새로 만들지 않는다.
 * 기록은 id만 남긴다(이메일·금액·Polar 응답 문구 없음). MoR 구독에는 a11ychk 결제 메일을 보내지 않는다(Polar가 보낸다).
 * 저장소 오류와 Polar 읽기 실패(동기화 입력)는 던진다 — 웹훅이 다시 시도한다.
 */

export interface MorSyncHint {
  /** 이 동기화를 일으킨 주문(order.* 웹훅) — 기간을 줄 수 없으면 이 주문을 환불한다 */
  orderId?: string;
}

/**
 * applied: 행을 만들었거나 Polar 상태로 맞췄다(status는 지금 행 상태).
 * stale: 저장된 것보다 오래된 상태라 무시했다.
 * skipped: 적을 것이 없다(incomplete, 받은 적 없는 해지 구독에 주문 단서가 없음).
 * review: needs review를 남기고 아무것도 바꾸지 않았다(해지 실패 포함).
 * ungranted: 기간을 줄 수 없어 해지했다(또는 이미 해지돼 있었다). refund — refunded: 환불했거나 환불 기록이 이미 있다 /
 *   none: 돌려줄 결제가 없다(무효 주문·이미 전액 환불) / review: 환불을 확정하지 못해 needs review를 남겼다.
 */
export type MorSyncResult =
  | { kind: "applied"; subscriptionId: string; status: SubscriptionRow["status"] }
  | { kind: "stale"; subscriptionId: string }
  | { kind: "skipped" }
  | { kind: "review" }
  | { kind: "ungranted"; refund: RefundOutcome };

type RefundOutcome = "refunded" | "none" | "review";
type Owner = { kind: "ok" | "missing"; userId: string };
/** 기간을 줄 수 없는 이유 — 기록·환불 사유에 쓴다 */
type UngrantedWhy = "hasActive" | "userMissing" | "resumedHasActive" | "neverGranted";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_TIME_RE = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,9}))?(Z|[+-]\d{2}:\d{2})$/;

const GRANTABLE = new Set(["active", "trialing", "past_due", "unpaid"]);
const NOT_STARTED = new Set(["incomplete", "incomplete_expired"]);
const KNOWN_STATUSES = new Set([...GRANTABLE, ...NOT_STARTED, "canceled", "paused"]);
const LIVE = new Set<SubscriptionRow["status"]>(["active", "past_due"]);

const ORDER_STATUS = new Map<string, PaymentRow["status"]>([
  ["paid", "paid"],
  ["refunded", "refunded"],
  ["partially_refunded", "partially_refunded"],
  ["pending", "pending"],
  ["draft", "pending"],
  ["void", "failed"],
]);
/** 결제 행 상태는 이 순서로만 나아간다 — 늦게 읽은 주문이 환불 기록을 되돌리지 않게 */
const STATUS_RANK: Record<PaymentRow["status"], number> = { pending: 0, failed: 1, paid: 2, partially_refunded: 3, refunded: 4 };

const UNGRANTED_TEXT: Record<UngrantedWhy, string> = {
  hasActive: "user already has a live subscription",
  userMissing: "user account does not exist",
  resumedHasActive: "resumed while another subscription is live",
  neverGranted: "subscription ended before it was granted",
};
/** billing_refunds.reason — 자동 환불의 경위(운영 화면용 코드) */
const REFUND_REASON: Record<UngrantedWhy, string> = {
  hasActive: "auto_duplicate",
  userMissing: "auto_user_missing",
  resumedHasActive: "auto_duplicate",
  neverGranted: "auto_ungranted",
};

// ── 시각 ──

/** ISO 시각의 마이크로초 — 모양이 다르면 NaN(PostgREST 표기 +00:00와 Polar 표기 Z 모두) */
function micros(s: string): number {
  const m = ISO_TIME_RE.exec(s);
  if (!m) return NaN;
  const base = Date.parse(`${m[1]}${m[3]}`);
  if (Number.isNaN(base)) return NaN;
  return base * 1000 + Number((m[2] ?? "").padEnd(6, "0").slice(0, 6));
}

/**
 * 저장·비교에 쓰는 시각 — UTC, 소수 6자리 Z. ISO가 아닌 문자열은 null(필터에 들어가는 값이라 모양을 고정한다).
 * Date.parse만 통과한 느슨한 표기(괄호 주석 등)는 여기서 걸러진다.
 */
function canonicalTime(s: string | null | undefined): string | null {
  if (typeof s !== "string") return null;
  const us = micros(s);
  if (Number.isNaN(us)) return null;
  const head = new Date(Math.floor(us / 1e6) * 1000).toISOString().slice(0, 19);
  return `${head}.${String(us % 1e6).padStart(6, "0")}Z`;
}

/** 저장된 시각이 들어온 시각보다 새로우면 true(같으면 재전송이라 false) */
function storedIsNewer(stored: string | null, incoming: string): boolean {
  return stored !== null && micros(stored) > micros(incoming);
}

// ── 공통 ──

const errorText = (e: unknown) => (e instanceof PolarError ? `${e.code} (${e.status})` : e instanceof Error ? e.message : String(e)).slice(0, 300);

async function review(deps: MorDeps, message: string): Promise<{ kind: "review" }> {
  await deps.log(`billing needs review: ${message}`);
  return { kind: "review" };
}

const lowerUuid = (v: unknown): string | null => (typeof v === "string" && UUID_RE.test(v) ? v.toLowerCase() : null);

/** Polar metadata의 우리 결제 시도 id(billing_checkouts) — 결제 시작(Task 4)이 checkout_id로 넣는다 */
export function morAttemptId(metadata: PolarMetadata): string | null {
  return lowerUuid(metadata.checkout_id);
}

/**
 * 구독의 a11ychk 사용자 — customer.external_id, 없으면 metadata.user_id. 둘 다 있는데 다르면 믿지 않는다.
 * 사용자 id가 UUID인데 profiles에 없으면 missing(탈퇴). 그 밖(없음·모양 틀림·불일치)은 needs review.
 */
async function resolveOwner(deps: MorDeps, sub: PolarSubscription): Promise<Owner | { kind: "review" }> {
  const ext = sub.customer.external_id;
  const meta = sub.metadata.user_id;
  if (ext !== null && meta !== undefined && meta !== null && (typeof meta !== "string" || meta.toLowerCase() !== ext.toLowerCase())) {
    return review(deps, `mor subscription ${sub.id} has conflicting user ids`);
  }
  const candidate = ext ?? meta;
  if (candidate === undefined || candidate === null) return review(deps, `mor subscription ${sub.id} has no user id`);
  const userId = lowerUuid(candidate);
  if (!userId) return review(deps, `mor subscription ${sub.id} has a malformed user id`);
  return { kind: (await deps.store.profileExists(userId)) ? "ok" : "missing", userId };
}

/** 주기·통화 — month·year(횟수 1), USD만. 그 밖은 needs review */
async function readTerms(deps: MorDeps, sub: PolarSubscription): Promise<{ interval: "month" | "year" } | { kind: "review" }> {
  const interval = sub.recurring_interval === "month" ? "month" : sub.recurring_interval === "year" ? "year" : null;
  if (!interval || sub.recurring_interval_count !== 1) return review(deps, `mor subscription ${sub.id} has an unsupported billing interval`);
  if (sub.currency.toLowerCase() !== "usd") return review(deps, `mor subscription ${sub.id} is not billed in USD`);
  return { interval };
}

function periodOf(sub: PolarSubscription): { start: string; end: string } | null {
  const start = canonicalTime(sub.current_period_start);
  const end = canonicalTime(sub.current_period_end);
  if (!start || !end || !(micros(end) > micros(start))) return null;
  return { start, end };
}

/** 진행 중 구독의 Polar 값 — 플랜·금액·기간·해지 예약을 따라간다. 미납은 기간 끝 + 7일까지 유예 */
function livePatch(
  sub: PolarSubscription,
  target: "active" | "past_due",
  price: PriceRow,
  interval: "month" | "year",
  period: { start: string; end: string },
  source: string,
): MorSubscriptionPatch {
  return {
    status: target,
    plan_code: price.plan_code,
    price_id: price.id,
    amount: sub.amount,
    currency: "USD",
    interval,
    current_period_start: period.start,
    current_period_end: period.end,
    cancel_at_period_end: sub.cancel_at_period_end,
    canceled_at: canonicalTime(sub.canceled_at),
    grace_until: target === "past_due" ? graceUntil(period.end) : null,
    ended_reason: null,
    ended_at: null,
    external_customer_id: sub.customer.id,
    external_updated_at: source,
  };
}

// ── 구독 ──

/**
 * Polar 구독(정본)을 우리 구독 행에 맞춘다. 상태 매핑은 constraints.md의 표 그대로다. 저장소 오류는 던진다.
 * 조건부 갱신이 엇갈리면(그 사이 다른 동기화가 행을 바꿨다) 한 번만 다시 읽어 판정하고, 그래도 엇갈리면 던진다(웹훅 재시도).
 */
export async function syncMorSubscription(deps: MorDeps, sub: PolarSubscription, livemode: boolean, hint: MorSyncHint = {}): Promise<MorSyncResult> {
  if (!KNOWN_STATUSES.has(sub.status)) return review(deps, `mor subscription ${sub.id} has an unknown status`);
  const source = canonicalTime(sub.modified_at ?? sub.created_at);
  if (!source) return review(deps, `mor subscription ${sub.id} has an unreadable modification time`);

  for (let pass = 0; pass < 2; pass++) {
    const existing = await deps.store.getSubscriptionByExternal("mor", sub.id, livemode);
    if (existing && storedIsNewer(existing.external_updated_at, source)) return { kind: "stale", subscriptionId: existing.id };
    const result = existing ? await syncExisting(deps, sub, livemode, hint, source, existing) : await syncNew(deps, sub, livemode, hint, source);
    if (result !== "retry") return result;
  }
  throw new Error(`billing mor subscription ${sub.id} changed during sync; retry later`);
}

/** 행이 아직 없는 구독. "retry"는 그 사이 같은 구독의 행이 생겼다는 뜻이다(다시 읽어 갱신으로) */
async function syncNew(deps: MorDeps, sub: PolarSubscription, livemode: boolean, hint: MorSyncHint, source: string): Promise<MorSyncResult | "retry"> {
  if (NOT_STARTED.has(sub.status)) return { kind: "skipped" };
  const terms = await readTerms(deps, sub);
  if ("kind" in terms) return terms;
  if (sub.status === "paused") return review(deps, `mor subscription ${sub.id} is paused before it was recorded`);
  if (sub.status === "canceled") return settleNeverGranted(deps, sub, livemode, hint);

  const owner = await resolveOwner(deps, sub);
  if (owner.kind === "review") return owner;
  const price = await deps.store.findPriceByExternal("mor", sub.product_id, livemode);
  if (!price) return review(deps, `no mor price for product ${sub.product_id} (subscription ${sub.id})`);
  const period = periodOf(sub);
  if (!period) return review(deps, `mor subscription ${sub.id} has no usable current period`);
  if (owner.kind === "missing") return rejectSubscription(deps, sub, livemode, { why: "userMissing", row: null, hint });

  const target = sub.status === "active" || sub.status === "trialing" ? "active" : "past_due";
  const inserted = await deps.store.insertMorSubscription({
    user_id: owner.userId,
    provider: "mor",
    mor_provider: "polar",
    livemode,
    plan_code: price.plan_code,
    price_id: price.id,
    amount: sub.amount,
    currency: "USD",
    interval: terms.interval,
    current_period_start: period.start,
    current_period_end: period.end,
    billing_anchor_day: null,
    status: target,
    cancel_at_period_end: sub.cancel_at_period_end,
    canceled_at: canonicalTime(sub.canceled_at),
    grace_until: target === "past_due" ? graceUntil(period.end) : null,
    external_id: sub.id,
    external_customer_id: sub.customer.id,
    external_updated_at: source,
  });
  if (inserted !== "conflict") {
    await completeAttempt(deps, sub, livemode, owner.userId, inserted.id);
    return { kind: "applied", subscriptionId: inserted.id, status: inserted.status };
  }
  // 유니크 충돌 — 같은 구독을 다른 요청이 먼저 넣었거나(갱신으로), 그 사용자에게 다른 진행 중 구독이 있다(불변식).
  // 제약 이름에 기대지 않고 다시 읽어 가른다
  if (await deps.store.getSubscriptionByExternal("mor", sub.id, livemode)) return "retry";
  const live = await deps.store.getLiveSubscription(owner.userId, livemode);
  if (live) return rejectSubscription(deps, sub, livemode, { why: "hasActive", row: null, hint });
  // 충돌한 진행 중 구독이 그 사이 끝났다 — 다시 시도한다
  return "retry";
}

async function syncExisting(
  deps: MorDeps,
  sub: PolarSubscription,
  livemode: boolean,
  hint: MorSyncHint,
  source: string,
  row: MorSubscriptionRow,
): Promise<MorSyncResult | "retry"> {
  if (NOT_STARTED.has(sub.status)) {
    await deps.log(`billing mor subscription ${sub.id} is not started at Polar; row ${row.id} left unchanged`);
    return { kind: "skipped" };
  }
  const terms = await readTerms(deps, sub);
  if ("kind" in terms) return terms;
  const expected = { status: row.status, notAfter: source };

  if (sub.status === "canceled" || sub.status === "paused") {
    const ending = LIVE.has(row.status);
    const endedAt = canonicalTime(sub.ended_at) ?? iso(deps.now());
    const patch: MorSubscriptionPatch = !ending
      ? // 이미 끝난 행 — 끝난 사유·시각은 그대로 두고 순서만 기록한다
        { external_updated_at: source }
      : sub.status === "canceled"
        ? {
            status: "ended",
            ended_reason: row.status === "past_due" ? "payment_failed" : "user_canceled",
            ended_at: endedAt,
            canceled_at: canonicalTime(sub.canceled_at) ?? row.canceled_at ?? endedAt,
            cancel_at_period_end: sub.cancel_at_period_end,
            external_updated_at: source,
          }
        : // 우리 화면에는 일시정지가 없다 — 끝내 두고 사람이 본다. 같은 구독이 돌아오면 이 행을 되살린다
          { status: "ended", ended_reason: "admin", ended_at: endedAt, external_updated_at: source };
    const written = await deps.store.updateMorSubscriptionIf(row.id, expected, patch);
    if (written === "skipped") return "retry";
    if (written === "conflict") throw new Error(`billing mor subscription ${sub.id}: unexpected unique conflict while ending`);
    if (ending && sub.status === "paused") await deps.log(`billing needs review: mor subscription ${sub.id} was paused at Polar; row ${row.id} ended`);
    return { kind: "applied", subscriptionId: row.id, status: "ended" };
  }

  // active·trialing·past_due·unpaid
  if (row.status === "ended" && row.ended_reason !== "admin") {
    return review(deps, `mor subscription ${sub.id} is live at Polar but row ${row.id} has ended`);
  }
  const owner = await resolveOwner(deps, sub);
  if (owner.kind === "review") return owner;
  if (row.user_id !== null && row.user_id !== owner.userId) return review(deps, `mor subscription ${sub.id} belongs to another user than row ${row.id}`);
  const price = await deps.store.findPriceByExternal("mor", sub.product_id, livemode);
  if (!price) return review(deps, `no mor price for product ${sub.product_id} (subscription ${sub.id})`);
  const period = periodOf(sub);
  if (!period) return review(deps, `mor subscription ${sub.id} has no usable current period`);
  if (owner.kind === "missing") return rejectSubscription(deps, sub, livemode, { why: "userMissing", row, hint });

  const target = sub.status === "active" || sub.status === "trialing" ? "active" : "past_due";
  const written = await deps.store.updateMorSubscriptionIf(row.id, expected, livePatch(sub, target, price, terms.interval, period, source));
  if (written === "skipped") return "retry";
  // 일시정지(ended·admin)에서 돌아왔는데 그 사용자에게 다른 진행 중 구독이 있다
  if (written === "conflict") return rejectSubscription(deps, sub, livemode, { why: "resumedHasActive", row, hint });
  await completeAttempt(deps, sub, livemode, owner.userId, row.id);
  return { kind: "applied", subscriptionId: row.id, status: target };
}

/**
 * 받은 적 없는(행이 없는) 구독이 이미 끝나 있다 — 기간을 준 적이 없으니 이 동기화를 일으킨 주문이 결제됐으면 돌려준다.
 * 우리가 기간을 줄 수 없어 해지한 구독의 주문이 해지 뒤에 도착한 경우가 이것이다. 우리 구독임(사용자 id·가격 매핑)을
 * 확인한 뒤에만 환불한다. 주문 단서가 없으면 할 일이 없다.
 */
async function settleNeverGranted(deps: MorDeps, sub: PolarSubscription, livemode: boolean, hint: MorSyncHint): Promise<MorSyncResult> {
  if (!hint.orderId) return { kind: "skipped" };
  const owner = await resolveOwner(deps, sub);
  if (owner.kind === "review") return owner;
  if (!(await deps.store.findPriceByExternal("mor", sub.product_id, livemode))) {
    return review(deps, `no mor price for product ${sub.product_id} (subscription ${sub.id})`);
  }
  return { kind: "ungranted", refund: await refundOrder(deps, hint.orderId, livemode, sub.id, "neverGranted") };
}

/** 새 구독이 우리 결제 시도에서 왔으면 그 시도를 completed로 닫고 동의 기록을 잇는다(이미 닫혔으면 그대로) */
async function completeAttempt(deps: MorDeps, sub: PolarSubscription, livemode: boolean, userId: string, subscriptionId: string): Promise<void> {
  const attemptId = morAttemptId(sub.metadata);
  if (attemptId) await markMorCheckout(deps, attemptId, "completed", { livemode, userId, subscriptionId });
}

/**
 * 돈 안전 불변식 — Polar 구독을 즉시 해지하고, 우리 행이 있으면 ended(refunded)로, 그 주문을 전액 환불한다.
 * 주문: 단서(hint.orderId), 없으면 새 구독일 때만 우리 결제 시도(metadata.checkout_id)에 묶인 첫 결제 행. 되살리려던 기존 행의
 * 첫 결제는 이미 기간을 받은 결제라 찾지 않는다. 찾지 못하면 needs review(구독 id) — 나중에 오는 주문 이벤트(해지된 구독)는
 * settleNeverGranted가 환불한다(새 구독일 때).
 */
async function rejectSubscription(
  deps: MorDeps,
  sub: PolarSubscription,
  livemode: boolean,
  ctx: { why: UngrantedWhy; row: MorSubscriptionRow | null; hint: MorSyncHint },
): Promise<MorSyncResult> {
  const revoked = await revokeAtPolar(deps, sub);
  if (!revoked) return { kind: "review" };

  if (ctx.row) {
    // 해지 응답의 시각으로 적는다 — 뒤에 오는 오래된 이벤트가 이 행을 되살리지 못하게
    const source = canonicalTime(revoked.modified_at ?? revoked.created_at) ?? canonicalTime(sub.modified_at ?? sub.created_at)!;
    const endedAt = canonicalTime(revoked.ended_at) ?? iso(deps.now());
    await deps.store.updateMorSubscriptionIf(
      ctx.row.id,
      { status: ctx.row.status, notAfter: source },
      { status: "ended", ended_reason: "refunded", ended_at: endedAt, canceled_at: canonicalTime(revoked.canceled_at) ?? endedAt, external_updated_at: source },
    );
  }
  if (ctx.why === "hasActive") {
    const attemptId = morAttemptId(sub.metadata);
    if (attemptId) await markMorCheckout(deps, attemptId, "failed", { livemode, failureCode: "duplicateRefunded" });
  }

  const orderId = ctx.hint.orderId ?? (ctx.row ? null : await initialOrderIdFor(deps, sub, livemode));
  if (!orderId) {
    await review(deps, `mor subscription ${sub.id} was revoked (${UNGRANTED_TEXT[ctx.why]}) but its order is not known yet; refund it manually`);
    return { kind: "ungranted", refund: "review" };
  }
  return { kind: "ungranted", refund: await refundOrder(deps, orderId, livemode, sub.id, ctx.why) };
}

async function initialOrderIdFor(deps: MorDeps, sub: PolarSubscription, livemode: boolean): Promise<string | null> {
  const attemptId = morAttemptId(sub.metadata);
  if (!attemptId) return null;
  const payment = await deps.store.findInitialPaymentByCheckout(attemptId, "mor", livemode);
  return payment?.external_payment_id ?? null;
}

/**
 * Polar 구독 즉시 해지 — 해지됐으면 그 뒤 상태(정본), 못 했으면 null(needs review 기록).
 * 이미 해지됨(403 AlreadyCanceledSubscription)은 성공. 결과 불명이면 한 번만 다시 읽어 canceled일 때만 성공으로 본다.
 */
async function revokeAtPolar(deps: MorDeps, sub: PolarSubscription): Promise<PolarSubscription | null> {
  if (sub.status === "canceled") return sub;
  try {
    return await deps.polar.updateSubscription(sub.id, { revoke: true });
  } catch (e) {
    if (e instanceof PolarError && e.code === "AlreadyCanceledSubscription") return { ...sub, status: "canceled" };
    if (!isPolarOutcomeUnknown(e)) {
      await review(deps, `revoke of mor subscription ${sub.id} failed: ${errorText(e)}`);
      return null;
    }
    try {
      const again = await deps.polar.getSubscription(sub.id);
      if (again.status === "canceled") return again;
    } catch {
      // 아래 기록 한 줄로 충분하다
    }
    await review(deps, `revoke of mor subscription ${sub.id} has an unknown outcome`);
    return null;
  }
}

/** 아직 환불할 수 있는 금액(cent, 세금 제외) — Polar 환불 금액은 세금을 뺀 금액이고 세금은 Polar가 비율대로 함께 돌려준다 */
function refundableOf(order: PolarOrder): number {
  if (order.refundable_amount !== null) return order.refundable_amount;
  const net = order.net_amount ?? order.total_amount - (order.tax_amount ?? 0);
  return Math.max(0, net - order.refunded_amount);
}

/**
 * 주문을 전액 환불하고 billing_refunds에 적는다(결제 행은 recordMorOrder로 먼저 만들거나 맞춘다).
 * 환불 기록(pending·succeeded)이 이미 있으면 다시 요청하지 않는다. 요청 전에 pending 기록을 먼저 남긴다 — 결과를 모르면 그 기록이
 * 다음 시도의 이중 환불을 막는다. 403 RefundedAlready는 성공. 실패는 needs review 한 줄(id만).
 */
async function refundOrder(deps: MorDeps, orderId: string, livemode: boolean, subscriptionId: string, why: UngrantedWhy): Promise<RefundOutcome> {
  let order: PolarOrder;
  try {
    order = await deps.polar.getOrder(orderId);
  } catch (e) {
    await review(deps, `order ${orderId} of mor subscription ${subscriptionId} could not be read for refund: ${errorText(e)}`);
    return "review";
  }
  if (order.subscription_id !== subscriptionId) {
    await review(deps, `order ${order.id} does not belong to mor subscription ${subscriptionId}; not refunded`);
    return "review";
  }
  const payment = await recordMorOrder(deps, order, livemode);
  if (!payment) return "review"; // recordMorOrder가 needs review를 남겼다
  if (!order.paid) {
    if (order.status === "pending" || order.status === "draft") {
      await review(deps, `order ${order.id} of revoked mor subscription ${subscriptionId} is not paid yet; check it manually`);
      return "review";
    }
    return "none";
  }
  const amount = refundableOf(order);
  if (amount < 1) {
    await deps.log(`billing auto-canceled mor subscription ${subscriptionId}: ${UNGRANTED_TEXT[why]}, order ${order.id} was already refunded`);
    return "none";
  }
  if (await deps.store.hasRefundFor(payment.id)) return "refunded";

  const record = await deps.store.insertRefund({
    payment_id: payment.id,
    amount,
    reason: REFUND_REASON[why],
    external_refund_id: null,
    status: "pending",
    requested_by: null,
  });
  try {
    const refund = await deps.polar.createRefund({
      order_id: order.id,
      reason: why === "hasActive" || why === "resumedHasActive" ? "duplicate" : "other",
      amount,
      metadata: { payment_id: payment.id },
    });
    const status = refund.status === "succeeded" ? "succeeded" : refund.status === "pending" ? "pending" : "failed";
    await deps.store.updateRefund(record.id, { status, external_refund_id: refund.id });
    if (status === "failed") {
      await review(deps, `refund ${refund.id} of order ${order.id} (mor subscription ${subscriptionId}) did not go through`);
      return "review";
    }
  } catch (e) {
    if (e instanceof PolarError && e.code === "RefundedAlready") {
      await deps.store.updateRefund(record.id, { status: "succeeded" });
    } else if (isPolarOutcomeUnknown(e)) {
      if (!(await refundConfirmed(deps, order, amount))) {
        await review(deps, `refund of order ${order.id} (mor subscription ${subscriptionId}) has an unknown outcome; refund record ${record.id} left pending`);
        return "review";
      }
      await deps.store.updateRefund(record.id, { status: "succeeded" });
    } else {
      await deps.store.updateRefund(record.id, { status: "failed" });
      await review(deps, `refund of order ${order.id} (mor subscription ${subscriptionId}) failed: ${errorText(e)}`);
      return "review";
    }
  }
  await deps.log(`billing auto-canceled mor subscription ${subscriptionId}: ${UNGRANTED_TEXT[why]}, order ${order.id} refunded (payment ${payment.id})`);
  return "refunded";
}

/** 결과 불명 환불 확인 — 주문을 한 번만 다시 읽어 환불액이 늘었을 때만 true */
async function refundConfirmed(deps: MorDeps, before: PolarOrder, amount: number): Promise<boolean> {
  try {
    const after = await deps.polar.getOrder(before.id);
    return after.status === "refunded" || after.refunded_amount >= before.refunded_amount + amount;
  } catch {
    return false;
  }
}

// ── 주문 ──

/** 주문의 사용자 — profiles에 있을 때만(FK). 구독과 같은 규칙이지만 기록 없이 null */
async function orderOwner(deps: MorDeps, order: PolarOrder): Promise<string | null> {
  const ext = lowerUuid(order.customer?.external_id);
  const meta = order.metadata.user_id;
  if (ext && meta !== undefined && meta !== null && lowerUuid(meta) !== ext) return null;
  const userId = ext ?? lowerUuid(meta);
  return userId && (await deps.store.profileExists(userId)) ? userId : null;
}

/** 주문 metadata의 우리 결제 시도 — 그 모드·MoR·(알면) 그 사용자의 시도일 때만(FK) */
async function orderAttempt(deps: MorDeps, order: PolarOrder, livemode: boolean, userId: string | null): Promise<string | null> {
  const attemptId = morAttemptId(order.metadata);
  if (!attemptId) return null;
  const attempt = await deps.store.getCheckout(attemptId);
  if (!attempt || attempt.provider !== "mor" || attempt.livemode !== livemode) return null;
  if (userId !== null && attempt.user_id !== userId) return null;
  return attempt.id;
}

const kindOf = (reason: string): PaymentRow["kind"] => (reason === "subscription_cycle" ? "renewal" : "initial");

function approvedAtOf(order: PolarOrder): string | null {
  if (!order.paid) return null;
  return canonicalTime(order.status === "paid" ? (order.modified_at ?? order.created_at) : order.created_at);
}

/**
 * Polar 주문(정본)을 결제 행에 맞춘다 — (provider mor, external_payment_id = 주문 id) 기준으로 만들거나 합친다. 주문번호는 mor_<주문 id>.
 * 종류: subscription_cycle → renewal, 그 밖 → initial. 금액은 total_amount(세금 포함), 환불액은 Polar refunded_amount.
 * 기간은 연결 구독 행의 지금 기간이다. 갱신인데 기간을 모르면(구독 행이 아직 없음) initial로 적고 로그 한 줄 — 갱신 행은 구독·기간이
 * 있어야 한다(0041 check). 구독 행이 아직 없으면 subscription_id를 비워 두고, 다음에 같은 주문을 받을 때 채운다.
 * 상태는 앞으로만 나아간다(pending → paid → 부분 환불 → 환불). 모르는 상태·USD 아닌 주문은 needs review로 쓰지 않고 null.
 */
export async function recordMorOrder(deps: MorDeps, order: PolarOrder, livemode: boolean): Promise<PaymentRow | null> {
  const status = ORDER_STATUS.get(order.status);
  if (!status) {
    await review(deps, `mor order ${order.id} has an unknown status`);
    return null;
  }
  if (order.currency.toLowerCase() !== "usd") {
    await review(deps, `mor order ${order.id} is not in USD`);
    return null;
  }
  const subRow = order.subscription_id ? await deps.store.getSubscriptionByExternal("mor", order.subscription_id, livemode) : null;
  const approvedAt = approvedAtOf(order);

  for (let pass = 0; pass < 2; pass++) {
    const existing = await deps.store.getPaymentByExternal("mor", order.id, livemode);
    if (existing) {
      const merged = await mergeOrder(deps, existing, order, status, subRow, approvedAt);
      if (merged) return merged;
      continue;
    }
    const userId = subRow ? subRow.user_id : await orderOwner(deps, order);
    const base: NewExternalPayment = {
      user_id: userId,
      subscription_id: subRow?.id ?? null,
      checkout_id: await orderAttempt(deps, order, livemode, userId),
      provider: "mor",
      livemode,
      kind: kindOf(order.billing_reason),
      order_id: `mor_${order.id}`,
      external_payment_id: order.id,
      amount: order.total_amount,
      currency: "USD",
      period_start: subRow?.current_period_start ?? null,
      period_end: subRow?.current_period_end ?? null,
      attempt: 1,
      status,
      refunded_amount: order.refunded_amount,
      approved_at: approvedAt,
    };
    if (base.kind === "renewal" && (base.subscription_id === null || base.period_start === null)) {
      const inserted = await deps.store.insertExternalPayment({ ...base, kind: "initial" });
      if (inserted === "duplicate") continue;
      await deps.log(`billing mor order ${order.id} recorded as initial: subscription period not known yet`);
      return inserted;
    }
    const inserted = await deps.store.insertExternalPayment(base);
    if (inserted !== "duplicate") return inserted;
    if (await deps.store.getPaymentByExternal("mor", order.id, livemode)) continue; // 같은 주문을 다른 요청이 먼저 넣었다
    if (base.kind === "renewal") {
      // 같은 구독·기간의 갱신 칸을 다른 주문이 먼저 차지했다(주문이 구독 갱신보다 먼저 옴) — 돈 기록이 우선이라 initial로 남긴다
      const fallback = await deps.store.insertExternalPayment({ ...base, kind: "initial" });
      if (fallback !== "duplicate") {
        await deps.log(`billing mor order ${order.id} recorded as initial: renewal slot for subscription ${base.subscription_id} is taken`);
        return fallback;
      }
      continue;
    }
  }
  throw new Error(`billing mor order ${order.id} could not be recorded; retry later`);
}

/** 기존 결제 행에 주문을 합친다 — 바꿀 것이 없으면 그대로. 읽은 뒤 다른 요청이 바꿨으면 null(다시 읽어 합친다) */
async function mergeOrder(
  deps: MorDeps,
  existing: PaymentRow,
  order: PolarOrder,
  status: PaymentRow["status"],
  subRow: MorSubscriptionRow | null,
  approvedAt: string | null,
): Promise<PaymentRow | null> {
  const patch: Partial<Omit<PaymentRow, "id">> = {};
  if (STATUS_RANK[status] > STATUS_RANK[existing.status]) patch.status = status;
  if (order.refunded_amount > existing.refunded_amount) patch.refunded_amount = order.refunded_amount;
  if (existing.status === "pending" && existing.amount !== order.total_amount) patch.amount = order.total_amount;
  if (existing.approved_at === null && approvedAt !== null) patch.approved_at = approvedAt;
  if (subRow) {
    if (existing.subscription_id === null) patch.subscription_id = subRow.id;
    if (existing.user_id === null && subRow.user_id !== null) patch.user_id = subRow.user_id;
    // 갱신 행의 기간은 유니크 키라 바꾸지 않는다 — 처음 기간 없이 적은 첫 결제만 채운다
    if (existing.kind === "initial" && existing.period_start === null && (existing.subscription_id === null || existing.subscription_id === subRow.id)) {
      patch.period_start = subRow.current_period_start;
      patch.period_end = subRow.current_period_end;
    }
  }
  if (Object.keys(patch).length === 0) return existing;
  const ok = await deps.store.updatePaymentIf(existing.id, { status: existing.status, refundedAmount: existing.refunded_amount }, patch);
  return ok ? { ...existing, ...patch } : null;
}

// ── 결제 시도 ──

/**
 * 우리 결제 시도(billing_checkouts, Polar metadata.checkout_id)를 닫는다 — 끝나지 않은(open·processing) 것만.
 * 그 모드의 MoR 시도이고 (주면) 그 사용자의 것일 때만 바꾼다. 바꿨으면 true.
 * completed는 구독 id를 잇고 동의 기록도 그 구독에 잇는다(먼저 — 중간에 멈추면 다음 동기화가 마저 한다).
 */
export async function markMorCheckout(
  deps: MorDeps,
  checkoutId: string,
  status: "completed" | "expired" | "failed",
  opts: { livemode: boolean; userId?: string | null; subscriptionId?: string; failureCode?: string },
): Promise<boolean> {
  const id = lowerUuid(checkoutId);
  if (!id) return false;
  const attempt = await deps.store.getCheckout(id);
  if (!attempt || attempt.provider !== "mor" || attempt.livemode !== opts.livemode) return false;
  if (opts.userId && attempt.user_id !== opts.userId) return false;
  if (attempt.status !== "open" && attempt.status !== "processing") return false;
  if (status === "expired") {
    await deps.store.expireCheckouts([attempt.id], attempt.status, null);
  } else if (status === "completed") {
    if (opts.subscriptionId) await deps.store.linkConsents(attempt.id, opts.subscriptionId);
    await deps.store.finishCheckout(attempt.id, { status: "completed", subscription_id: opts.subscriptionId ?? null });
  } else {
    await deps.store.finishCheckout(attempt.id, { status: "failed", failure_code: opts.failureCode ?? null });
  }
  return true;
}
