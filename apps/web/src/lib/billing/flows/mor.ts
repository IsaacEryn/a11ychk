import "server-only";
import { createHash } from "node:crypto";
import { UUID_RE } from "@/lib/billing/checkout";
import { errorText } from "@/lib/billing/errorText";
import { graceUntil, iso } from "@/lib/billing/period";
import {
  PolarError,
  isPolarOutcomeUnknown,
  isPolarRateLimited,
  polarCode,
  type PolarCheckout,
  type PolarClient,
  type PolarMetadata,
  type PolarOrder,
  type PolarRefund,
  type PolarSubscription,
} from "@/lib/billing/polar";
import {
  MOR_NON_FIRST_ORDER_PREFIX,
  isLiveStatus,
  type MorDeps,
  type MorSubscriptionPatch,
  type MorSubscriptionRow,
  type NewExternalPayment,
  type PaymentRow,
  type PriceRow,
  type SubscriptionRow,
} from "@/lib/billing/types";

/**
 * 판매 대행(Polar) 구독·주문을 우리 결제 기록(subscriptions·billing_payments·billing_refunds)에 맞추는 흐름.
 * 웹훅(flows/morWebhook.ts)·결제창 복귀(flows/morReturn.ts)·크론 대사(flows/morCycle.ts)·관리자 동기화 도구가 부르고, 탈퇴
 * (flows/manage.ts)는 해지·행 종료 도우미(revokeAtPolar·endMorRow)를 함께 쓴다. 입력은 늘 Polar API로 다시 읽은 정본이다 —
 * 웹훅 본문의 상태는 믿지 않는다.
 *
 * 순서: 구독 행은 Polar의 modified_at(없으면 created_at)이 저장된 external_updated_at보다 새롭거나 같을 때만 바꾼다.
 * 같으면 재전송이라 같은 값을 다시 적고(멱등), 오래됐으면 "stale"로 무시한다. 판정은 저장소의 조건부 갱신이 한다
 * (읽고 나서 조건 없이 쓰지 않는다). 시각은 마이크로초까지 비교한다 — Polar 시각은 소수 6자리이고 Date.parse는 밀리초에서 자른다.
 *
 * 돈 안전 불변식(토스 renew.ts의 refundUngranted와 같은 뜻): 결제된 Polar 구독에 기간을 줄 수 없으면 — 그 사용자·모드에
 * 다른 진행 중 구독이 이미 있거나(유니크 충돌), 사용자가 없거나(탈퇴), 일시정지에서 돌아왔는데 다른 진행 중 구독이 있으면 —
 * Polar 구독을 즉시 해지(revoke)하고 그 주문을 전액 환불한다. 같은 결제는 두 번 자동 환불하지 않는다 — 환불 기록의 id를 결제 id에서
 * 정해(morAutoRefundId) Polar에 요청하기 전에 pending으로 먼저 넣는다. 기본 키가 동시 요청 중 하나만 통과시킨다(유니크 제약을 새로
 * 만들지 않고 선점한다). Polar의 RefundedAlready도 성공으로 본다. 결과 불명인 쓰기(해지·환불)는 한 번만 다시 읽어 확인하고, 그래도
 * 모르면 needs review로 멈춘다(반복하지 않는다). 해지한 뒤의 단계가 저장소 오류로 멈추면 needs review 한 줄을 남기고 던진다 —
 * 웹훅 재시도가 받은 적 없는 해지 구독으로 다시 들어와 마저 환불한다(settleNeverGranted).
 *
 * 모르는 값(상태·주기·통화)은 needs review로 보내고 행을 만들거나 바꾸지 않는다 — 진행 중 행을 새로 만들지 않는다.
 * 기록은 id만 남긴다(이메일·금액·Polar 응답 문구 없음). MoR 구독에는 a11ychk 결제 메일을 보내지 않는다(Polar가 보낸다).
 * 저장소 오류와 Polar 읽기 실패(동기화 입력)는 던진다 — 웹훅이 다시 시도한다. Polar 한도 초과(429)도 실패로 적지 않고 던진다
 * (해지·환불할 주문 읽기·환불 요청) — Polar가 처리하지 않고 돌려보낸 요청이라 다시 시도하면 된다.
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

const ISO_TIME_RE = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,9}))?(Z|[+-]\d{2}:\d{2})$/;

const GRANTABLE = new Set(["active", "trialing", "past_due", "unpaid"]);
const NOT_STARTED = new Set(["incomplete", "incomplete_expired"]);
const KNOWN_STATUSES = new Set([...GRANTABLE, ...NOT_STARTED, "canceled", "paused"]);

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

/**
 * 자동 환불 기록 id의 이름공간 — 바꾸면 이미 남은 기록과 다른 id가 나와 이중 환불 방지가 깨진다(테스트가 값을 고정한다)
 */
const AUTO_REFUND_NAMESPACE = "a11ychk/billing/mor-auto-refund/v1:";

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
 * Date.parse만 통과한 느슨한 표기(괄호 주석 등)는 여기서 걸러진다. 탈퇴 정리(flows/manage.ts)도 같은 시각으로 쓴다.
 */
export function canonicalTime(s: string | null | undefined): string | null {
  if (typeof s !== "string") return null;
  const us = micros(s);
  if (Number.isNaN(us)) return null;
  const head = new Date(Math.floor(us / 1e6) * 1000).toISOString().slice(0, 19);
  return `${head}.${String(us % 1e6).padStart(6, "0")}Z`;
}

/** 저장된 시각이 들어온 시각보다 새로우면 true(같으면 재전송이라 false) — 마이크로초까지 */
export function storedIsNewer(stored: string | null, incoming: string): boolean {
  return stored !== null && micros(stored) > micros(incoming);
}

// ── 공통 ──

async function review(deps: MorDeps, message: string): Promise<{ kind: "review" }> {
  await deps.log(`billing needs review: ${message}`);
  return { kind: "review" };
}

/** UUID 모양이면 소문자로, 아니면 null — Polar metadata·본문의 id를 믿기 전에 거른다(웹훅도 같은 함수를 쓴다) */
export const lowerUuid = (v: unknown): string | null => (typeof v === "string" && UUID_RE.test(v) ? v.toLowerCase() : null);

/**
 * 결제 하나의 자동 환불 기록 id — SHA-256(이름공간 + 결제 id 소문자)의 앞 16바이트를 UUID로 적고 version 5·RFC 4122 variant
 * 비트를 박는다. 같은 결제면 늘 같은 id라 billing_refunds 기본 키가 동시 자동 환불을 하나로 줄인다. 관리자 부분 환불(후속 작업)은
 * 무작위 id를 쓰므로 이 id와 겹치지 않고, 자동 환불 판정에도 세지 않는다.
 */
export function morAutoRefundId(paymentId: string): string {
  const b = createHash("sha256").update(AUTO_REFUND_NAMESPACE).update(paymentId.toLowerCase()).digest().subarray(0, 16);
  b[6] = (b[6] & 0x0f) | 0x50;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = b.toString("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** Polar metadata의 우리 결제 시도 id(billing_checkouts) — 결제 시작(flows/morStart.ts)이 checkout_id로 넣는다 */
export function morAttemptId(metadata: PolarMetadata): string | null {
  return lowerUuid(metadata.checkout_id);
}

/** Polar 결제창이 실패로 끝난 우리 결제 시도의 실패 코드 — 결제 시작·웹훅·결제창 복귀가 같은 값을 쓴다 */
export const MOR_CHECKOUT_FAILED = "polarCheckoutFailed";

/**
 * 결제창의 a11ychk 사용자 — external_customer_id, 없으면 metadata.user_id(구독의 resolveOwner와 같은 규칙, 소문자).
 * 값이 있는데 UUID가 아니거나 둘이 다르면 믿지 않는다(null). 웹훅과 결제창 복귀 라우트가 함께 쓴다.
 */
export function morCheckoutOwner(checkout: Pick<PolarCheckout, "external_customer_id" | "metadata">): string | null {
  const read = (v: unknown): string | null | "bad" => (v === undefined || v === null ? null : (lowerUuid(v) ?? "bad"));
  const ext = read(checkout.external_customer_id);
  const meta = read(checkout.metadata.user_id);
  if (ext === "bad" || meta === "bad" || (ext && meta && ext !== meta)) return null;
  return ext ?? meta;
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

/**
 * 미납 유예 기한 — 처음 미납이 된 때부터 GRACE_DAYS. 기간 끝 기준이 아니다: Polar는 주기가 시작될 때 기간을 먼저 넘기고 그다음
 * 결제를 시도하므로, 기간 끝 + 7일이면 결제하지 않은 한 주기를 통째로 더 준다.
 */
const freshGrace = (now: number) => graceUntil(iso(now));

/**
 * 진행 중 구독의 Polar 값 — 플랜·금액·기간·해지 예약을 따라간다.
 * 유예: active면 지운다. 미납으로 처음 바뀌면(직전이 active이거나 일시정지로 끝난 행) 지금 + 7일. 이미 미납이고 유예가 있으면
 * 키를 빼서 그대로 둔다 — 미납 중 기간이 넘어가도 유예가 늘지 않는다.
 */
function livePatch(
  sub: PolarSubscription,
  target: "active" | "past_due",
  price: PriceRow,
  interval: "month" | "year",
  period: { start: string; end: string },
  source: string,
  row: MorSubscriptionRow,
  now: number,
): MorSubscriptionPatch {
  const keepGrace = target === "past_due" && row.status === "past_due" && row.grace_until !== null;
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
    ...(target === "active" ? { grace_until: null } : keepGrace ? {} : { grace_until: freshGrace(now) }),
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
  if (sub.status === "paused") return review(deps, `mor subscription ${sub.id} is paused before it was recorded`);
  if (sub.status === "canceled") return settleNeverGranted(deps, sub, livemode, hint);
  // 주기·통화는 진행 중으로 적을 때만 본다 — 끝내는 상태는 낯선 값이어도 처리한다
  const terms = await readTerms(deps, sub);
  if ("kind" in terms) return terms;

  const owner = await resolveOwner(deps, sub);
  if (owner.kind === "review") return owner;
  const price = await deps.store.findPriceByExternal("mor", sub.product_id, livemode);
  if (!price) return review(deps, `no mor price for product ${sub.product_id} (subscription ${sub.id})`);
  const period = periodOf(sub);
  if (!period) return review(deps, `mor subscription ${sub.id} has no usable current period`);
  if (owner.kind === "missing") return rejectSubscription(deps, sub, livemode, { why: "userMissing", row: null, hint, userId: null });

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
    grace_until: target === "past_due" ? freshGrace(deps.now()) : null,
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
  if (live) return rejectSubscription(deps, sub, livemode, { why: "hasActive", row: null, hint, userId: owner.userId });
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
  const expected = { status: row.status, notAfter: source };

  if (sub.status === "canceled" || sub.status === "paused") {
    const ending = isLiveStatus(row.status);
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
        : // 우리 화면에는 일시정지가 없다 — 끝내 두고 사람이 본다. 같은 구독이 돌아오면 이 행을 되살린다.
          // ended_reason admin은 이 "일시정지 표지"를 겸한다(되살리기 허용). 후속 작업의 관리자 종료는 Polar에서 먼저 revoke해야
          // 한다 — 그러면 Polar가 다시 active를 보내지 않아 관리자가 끝낸 행이 되살아나지 않는다
          { status: "ended", ended_reason: "admin", ended_at: endedAt, external_updated_at: source };
    const written = await deps.store.updateMorSubscriptionIf(row.id, expected, patch);
    if (written === "skipped") return "retry";
    if (written === "conflict") throw new Error(`billing mor subscription ${sub.id}: unexpected unique conflict while ending`);
    if (ending && sub.status === "paused") await deps.log(`billing needs review: mor subscription ${sub.id} was paused at Polar; row ${row.id} ended`);
    return { kind: "applied", subscriptionId: row.id, status: "ended" };
  }

  // active·trialing·past_due·unpaid — 되살릴 수 있는 끝난 행은 일시정지 표지(admin)뿐이다
  if (row.status === "ended" && row.ended_reason !== "admin") {
    return review(deps, `mor subscription ${sub.id} is live at Polar but row ${row.id} has ended`);
  }
  const terms = await readTerms(deps, sub);
  if ("kind" in terms) return terms;
  const owner = await resolveOwner(deps, sub);
  if (owner.kind === "review") return owner;
  if (row.user_id !== null && row.user_id !== owner.userId) return review(deps, `mor subscription ${sub.id} belongs to another user than row ${row.id}`);
  const price = await deps.store.findPriceByExternal("mor", sub.product_id, livemode);
  if (!price) return review(deps, `no mor price for product ${sub.product_id} (subscription ${sub.id})`);
  const period = periodOf(sub);
  if (!period) return review(deps, `mor subscription ${sub.id} has no usable current period`);
  if (owner.kind === "missing") return rejectSubscription(deps, sub, livemode, { why: "userMissing", row, hint, userId: null });

  const target = sub.status === "active" || sub.status === "trialing" ? "active" : "past_due";
  const patch = livePatch(sub, target, price, terms.interval, period, source, row, deps.now());
  const written = await deps.store.updateMorSubscriptionIf(row.id, expected, patch);
  if (written === "skipped") return "retry";
  // 일시정지(ended·admin)에서 돌아왔는데 그 사용자에게 다른 진행 중 구독이 있다
  if (written === "conflict") return rejectSubscription(deps, sub, livemode, { why: "resumedHasActive", row, hint, userId: owner.userId });
  await completeAttempt(deps, sub, livemode, owner.userId, row.id);
  return { kind: "applied", subscriptionId: row.id, status: target };
}

/**
 * 받은 적 없는(행이 없는) 구독이 이미 끝나 있다 — 기간을 준 적이 없으니 그 주문이 결제됐으면 돌려준다.
 * 우리가 기간을 줄 수 없어 해지한 구독의 주문이 해지 뒤에 도착했거나, 해지 뒤 환불이 저장소 오류로 멈춘 뒤의 재시도가 이것이다.
 * 주문: 단서(hint.orderId), 없으면 우리 결제 시도에 묶인 첫 결제 — 행이 없으니 기간을 받은 결제가 아니고, 주문의 구독 id는
 * refundOrder가 확인한다. 우리 구독임(사용자 id·가격 매핑)을 확인한 뒤에만 환불한다. 주문을 모르면 할 일이 없다.
 */
async function settleNeverGranted(deps: MorDeps, sub: PolarSubscription, livemode: boolean, hint: MorSyncHint): Promise<MorSyncResult> {
  const orderId = hint.orderId ?? (await initialOrderIdFor(deps, sub, livemode));
  if (!orderId) return { kind: "skipped" };
  const owner = await resolveOwner(deps, sub);
  if (owner.kind === "review") return owner;
  if (!(await deps.store.findPriceByExternal("mor", sub.product_id, livemode))) {
    return review(deps, `no mor price for product ${sub.product_id} (subscription ${sub.id})`);
  }
  return { kind: "ungranted", refund: await refundOrder(deps, orderId, livemode, sub.id, "neverGranted") };
}

/** 새 구독이 우리 결제 시도에서 왔으면 그 시도를 completed로 닫고 동의 기록을 잇는다(이미 닫혔으면 그대로) */
async function completeAttempt(deps: MorDeps, sub: PolarSubscription, livemode: boolean, userId: string, subscriptionId: string): Promise<void> {
  const attemptId = morAttemptId(sub.metadata);
  if (attemptId) await markMorCheckout(deps, attemptId, "completed", { livemode, userId, subscriptionId });
}

/**
 * 돈 안전 불변식 — Polar 구독을 즉시 해지하고, 우리 행이 있으면 ended(refunded)로, 그 주문을 전액 환불한다.
 * 주문: 단서(hint.orderId), 없으면 새 구독일 때만 우리 결제 시도(metadata.checkout_id)에 묶인 첫 결제 행. 되살리려던 기존 행의
 * 첫 결제는 이미 기간을 받은 결제라 찾지 않고, 기존 행의 단서 주문도 그 행이 받은 기간보다 뒤에 만든 것만 환불한다.
 * 해지한 뒤의 단계(행 정리·주문 기록·환불)가 던지면 needs review 한 줄을 남기고 다시 던진다(웹훅 재시도). 환불까지 마친 뒤 결제 시도를
 * 닫다 실패하면 사실대로(환불은 끝, 시도는 열림) needs review 한 줄만 남기고 던지지 않는다 — 다시 받아도 할 일이 없고, 열린 시도는
 * 크론의 만료 처리(flows/morCycle.ts 1단계)가 만료 시각에 닫는다.
 */
async function rejectSubscription(
  deps: MorDeps,
  sub: PolarSubscription,
  livemode: boolean,
  ctx: { why: UngrantedWhy; row: MorSubscriptionRow | null; hint: MorSyncHint; userId: string | null },
): Promise<MorSyncResult> {
  let revoked: PolarSubscription;
  if (sub.status === "canceled") {
    revoked = sub;
  } else {
    // 429는 던진다(웹훅 재시도) — 여기서는 아직 아무것도 바꾸지 않았다
    const outcome = await revokeAtPolar(deps.polar, sub.id);
    if (!outcome.ok) {
      await review(deps, outcome.unknown ? `revoke of mor subscription ${sub.id} has an unknown outcome` : `revoke of mor subscription ${sub.id} failed: ${outcome.code}`);
      return { kind: "review" };
    }
    // 이미 해지돼 있었는데 다시 읽지 못했으면 읽은 정본을 해지된 것으로 쓴다
    revoked = outcome.sub ?? { ...sub, status: "canceled" };
  }
  let refund: RefundOutcome;
  try {
    if (ctx.row && !(await endMorRow(deps, ctx.row, "refunded", revoked))) {
      // 돈은 움직이지 않는다 — 환불은 이어서 진행한다
      await deps.log(`billing mor subscription ${sub.id}: row ${ctx.row.id} could not be marked refunded after revoke`);
    }
    refund = await refundAfterRevoke(deps, sub, livemode, ctx);
  } catch (e) {
    await deps.log(`billing needs review: mor subscription ${sub.id} was revoked (${UNGRANTED_TEXT[ctx.why]}) but its refund did not finish`);
    throw e;
  }
  // 시도는 환불 뒤에 닫는다 — 닫다가 멈춰도 환불은 이미 끝났다
  const attemptId = ctx.why === "hasActive" ? morAttemptId(sub.metadata) : null;
  if (attemptId) {
    try {
      await markMorCheckout(deps, attemptId, "failed", { livemode, userId: ctx.userId, failureCode: "duplicateRefunded" });
    } catch {
      const done = refund === "refunded" ? "and its order refunded" : refund === "none" ? "with nothing to refund" : "with its refund under review";
      await review(
        deps,
        `mor subscription ${sub.id} was revoked (${UNGRANTED_TEXT[ctx.why]}) ${done}, but checkout attempt ${attemptId} could not be closed (refund done, attempt not closed)`,
      );
    }
  }
  return { kind: "ungranted", refund };
}

async function refundAfterRevoke(
  deps: MorDeps,
  sub: PolarSubscription,
  livemode: boolean,
  ctx: { why: UngrantedWhy; row: MorSubscriptionRow | null; hint: MorSyncHint },
): Promise<RefundOutcome> {
  const bound = ctx.row ? grantedUntil(ctx.row, sub) : undefined;
  const orderId = ctx.hint.orderId ?? (ctx.row ? null : await initialOrderIdFor(deps, sub, livemode));
  if (!orderId) {
    // 기존 행이면 그 행이 이미 기간을 준 주문이 있다 — 경계 시각 뒤에 만든 주문이 있을 때만 수동 환불한다(새 주문이 없을 수도 있다)
    const next = bound
      ? `refund an order of this subscription manually only if it was created ${bound.strict ? "after" : "at or after"} ${canonicalTime(bound.time) ?? bound.time} — check billing_refunds first`
      : "the refund will run automatically when the order event arrives — check billing_refunds before refunding manually";
    await review(deps, `mor subscription ${sub.id} was revoked (${UNGRANTED_TEXT[ctx.why]}) but its order is not known yet; ${next}`);
    return "review";
  }
  return refundOrder(deps, orderId, livemode, sub.id, ctx.why, bound);
}

/**
 * 기존 행이 이미 기간을 준 경계 — 이보다 먼저 만든 주문은 기간을 받은 결제라 자동 환불하지 않는다.
 * 일시정지로 끝난 행(admin)은 끝난 시각 뒤, 그 밖은 지금 기간의 시작 이후에 만든 주문만 받는다. 지금 기간의 시작은 행과 Polar 정본 중
 * 늦은 쪽이다 — Polar가 기간을 넘겼는데 행이 아직 지난 기간이면, 넘기기 전 주문은 기간을 받은 결제다.
 */
function grantedUntil(row: MorSubscriptionRow, sub: PolarSubscription): { time: string; strict: boolean } {
  if (row.status === "ended" && row.ended_reason === "admin" && row.ended_at) return { time: row.ended_at, strict: true };
  const polarStart = canonicalTime(sub.current_period_start);
  const later = polarStart !== null && micros(polarStart) > micros(row.current_period_start) ? polarStart : row.current_period_start;
  return { time: later, strict: false };
}

/**
 * 해지한 구독의 우리 행을 끝낸다 — 해지 정본(canonical: 해지 응답·다시 읽은 정본, 없으면 null)의 시각으로 적어 뒤에 오는 오래된
 * 이벤트가 되살리지 못하게 한다. 조건부 갱신(읽은 상태·저장된 Polar 시각 이하) → 엇갈리면 다시 읽어 → 저장된 시각이 더 늦으면 그 시각을
 * 조건으로 한 번 더. 이미 끝나 있으면: refunded(돈 안전 불변식)는 사유만 refunded로 맞추고(돈을 돌려줬다), user_canceled(탈퇴)는 그대로 둔다.
 * 끝냈거나(이미 끝나 있었던 것 포함) 맞췄으면 true, 다시 해도 맞추지 못했으면 false. 저장소 오류는 던진다. 돈 안전 불변식과 탈퇴가 함께 쓴다.
 */
export async function endMorRow(
  deps: Pick<MorDeps, "store" | "now">,
  row: MorSubscriptionRow,
  reason: "refunded" | "user_canceled",
  canonical: PolarSubscription | null,
): Promise<boolean> {
  const nowIso = iso(deps.now());
  const source = canonicalTime(canonical?.modified_at ?? canonical?.created_at) ?? canonicalTime(nowIso)!;
  const endedAt = canonicalTime(canonical?.ended_at) ?? nowIso;
  const patchAt = (at: string): MorSubscriptionPatch => ({
    status: "ended",
    ended_reason: reason,
    ended_at: endedAt,
    canceled_at: canonicalTime(canonical?.canceled_at) ?? row.canceled_at ?? endedAt,
    external_updated_at: at,
  });
  if ((await deps.store.updateMorSubscriptionIf(row.id, { status: row.status, notAfter: source }, patchAt(source))) === "updated") return true;

  const current = row.external_id ? await deps.store.getSubscriptionByExternal("mor", row.external_id, row.livemode) : null;
  if (!current) return false;
  // 저장된 시각이 더 새로우면 그 시각을 조건으로 — 그 사이 또 바뀌지 않았을 때만 맞춘다
  const notAfter = storedIsNewer(current.external_updated_at, source) ? (canonicalTime(current.external_updated_at) ?? source) : source;
  if (current.status === "ended") {
    if (reason === "user_canceled" || current.ended_reason === "refunded") return true;
    return (await deps.store.updateMorSubscriptionIf(current.id, { status: "ended", notAfter }, { ended_reason: "refunded" })) === "updated";
  }
  return (await deps.store.updateMorSubscriptionIf(current.id, { status: current.status, notAfter }, patchAt(notAfter))) === "updated";
}

async function initialOrderIdFor(deps: MorDeps, sub: PolarSubscription, livemode: boolean): Promise<string | null> {
  const attemptId = morAttemptId(sub.metadata);
  if (!attemptId) return null;
  const payment = await deps.store.findInitialPaymentByCheckout(attemptId, "mor", livemode);
  return payment?.external_payment_id ?? null;
}

/**
 * revoke 결과 — ok: 해지됐다(sub는 해지 뒤 정본, 이미 해지돼 있었는데 다시 읽지 못했으면 null) / 못 했다: unknown이면 결과 불명
 * (다시 읽어도 canceled가 아님), 아니면 확정 실패(code = 코드·상태).
 */
export type PolarRevoke = { ok: true; sub: PolarSubscription | null } | { ok: false; unknown: boolean; code: string };

/**
 * Polar 구독 즉시 해지 — 돈 안전 불변식(이 모듈)과 탈퇴(flows/manage.ts)가 함께 쓰는 하나의 판정.
 * - 200이어도 status를 본다 — canceled가 아니면 결과 불명처럼 한 번만 다시 읽어 canceled일 때만 성공으로 본다(반복하지 않는다).
 * - 403 AlreadyCanceledSubscription(이미 해지됐거나 기간 끝 해지가 예약돼 더 청구되지 않는다)은 성공 — 행을 끝낼 정본 시각을 얻으려고
 *   한 번 다시 읽는다(읽지 못하면 sub null).
 * - 결과 불명(NETWORK·5xx·408·쓰기 BAD_RESPONSE)은 한 번만 다시 읽어 canceled일 때만 성공.
 * - 429(한도)는 던진다 — Polar가 처리하지 않았고, 호출부가 재시도(웹훅)나 막기(탈퇴)를 정한다.
 * 기록은 남기지 않는다(호출부가 남긴다).
 */
export async function revokeAtPolar(polar: Pick<PolarClient, "updateSubscription" | "getSubscription">, id: string): Promise<PolarRevoke> {
  try {
    const sub = await polar.updateSubscription(id, { revoke: true });
    if (sub.status === "canceled") return { ok: true, sub };
  } catch (e) {
    if (isPolarRateLimited(e)) throw e;
    if (e instanceof PolarError && e.code === "AlreadyCanceledSubscription") {
      try {
        return { ok: true, sub: await polar.getSubscription(id) };
      } catch {
        return { ok: true, sub: null };
      }
    }
    if (!isPolarOutcomeUnknown(e)) return { ok: false, unknown: false, code: polarCode(e) };
  }
  try {
    const again = await polar.getSubscription(id);
    if (again.status === "canceled") return { ok: true, sub: again };
  } catch {
    // 아래 결과 불명 하나로 충분하다
  }
  return { ok: false, unknown: true, code: "outcome unknown" };
}

/** 아직 환불할 수 있는 금액(cent, 세금 제외) — Polar 환불 금액은 세금을 뺀 금액이고 세금은 Polar가 비율대로 함께 돌려준다 */
function refundableOf(order: PolarOrder): number {
  if (order.refundable_amount !== null) return order.refundable_amount;
  const net = order.net_amount ?? order.total_amount - (order.tax_amount ?? 0);
  return Math.max(0, net - order.refunded_amount);
}

/** 자동 환불 기록이 아직 요청 전 그대로일 때만 결과를 적는다 — 그 사이 환불 웹훅이 먼저 맞췄으면 덮지 않는다 */
const UNSETTLED = { status: "pending", externalRefundId: null } as const;

/**
 * 주문을 전액 환불하고 billing_refunds에 적는다(결제 행은 recordMorOrder로 먼저 만들거나 맞춘다).
 * 환불 기록(pending·succeeded)이 이미 있으면 다시 요청하지 않는다. 요청 전에 pending 기록을 먼저 남긴다 — 결과를 모르면 그 기록이
 * 다음 시도의 이중 환불을 막는다. 403 RefundedAlready는 성공. 실패는 needs review 한 줄(id만)을 먼저 남기고 기록을 failed로 적는다.
 * 결과는 요청 전 그대로인 기록에만 적는다(updateRefundIf) — 그 사이 환불 웹훅이 맞췄으면 그 값을 둔다.
 * 429: 주문 읽기면 그대로 던지고, 환불 요청이면 선점을 풀고(Polar가 처리하지 않았다) 던진다 — 다시 받으면 같은 id로 다시 선점한다.
 */
async function refundOrder(
  deps: MorDeps,
  orderId: string,
  livemode: boolean,
  subscriptionId: string,
  why: UngrantedWhy,
  /** 기존 행의 단서 주문일 때 — 이보다 먼저 만든 주문은 이미 기간을 받았다 */
  notBefore?: { time: string; strict: boolean },
): Promise<RefundOutcome> {
  let order: PolarOrder;
  try {
    order = await deps.polar.getOrder(orderId);
  } catch (e) {
    if (isPolarRateLimited(e)) throw e;
    await review(deps, `order ${orderId} of mor subscription ${subscriptionId} could not be read for refund: ${errorText(e)}`);
    return "review";
  }
  if (order.subscription_id !== subscriptionId) {
    await review(deps, `order ${order.id} does not belong to mor subscription ${subscriptionId}; not refunded`);
    return "review";
  }
  if (notBefore) {
    const created = micros(order.created_at);
    const bound = micros(notBefore.time);
    const after = Number.isFinite(created) && Number.isFinite(bound) && (notBefore.strict ? created > bound : created >= bound);
    if (!after) {
      await review(deps, `order ${order.id} predates the ungranted period of mor subscription ${subscriptionId}; not refunded`);
      return "review";
    }
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
  // 결정적 id로 선점한다 — 확인과 기록 사이에 다른 요청이 끼어도 기본 키가 하나만 통과시킨다. 이미 있으면(어떤 상태든)
  // 그 자동 환불이 진행 중이거나 끝났다(실패였다면 그때 needs review를 남겼다)
  const refundId = morAutoRefundId(payment.id);
  if (await deps.store.hasRefundFor(payment.id, refundId)) return "refunded";
  const record = await deps.store.insertRefund({
    id: refundId,
    payment_id: payment.id,
    // 세금 제외(Polar 환불 금액 기준) — 결제 행의 amount·refunded_amount(세금 포함)와 기준이 다르다
    amount,
    reason: REFUND_REASON[why],
    external_refund_id: null,
    status: "pending",
    requested_by: null,
  });
  if (record === "duplicate") return "refunded";
  // Polar 호출의 오류만 아래에서 가른다 — 기록(updateRefundIf)의 저장소 오류를 환불 실패로 적으면 안 된다(돈은 이미 돌아갔을 수 있다).
  // 저장소 오류는 던진다: 기록은 pending으로 남아 재시도가 다시 요청하지 않는다
  let refund: PolarRefund | null = null;
  let failure: unknown = null;
  try {
    refund = await deps.polar.createRefund({
      order_id: order.id,
      reason: why === "hasActive" || why === "resumedHasActive" ? "duplicate" : "other",
      amount,
      // refund_record_id로 환불 웹훅이 이 기록을 찾는다(flows/morWebhook.ts) — payment_id는 운영자가 대시보드에서 보는 단서
      metadata: { payment_id: payment.id, refund_record_id: record.id },
    });
  } catch (e) {
    failure = e;
  }
  const ref = `of order ${order.id} (mor subscription ${subscriptionId})`;
  if (refund) {
    const status = refund.status === "succeeded" ? "succeeded" : refund.status === "pending" ? "pending" : "failed";
    if (status === "failed") await review(deps, `refund ${refund.id} ${ref} did not go through`);
    // false면 그 사이 환불 웹훅이 기록을 먼저 맞췄다 — 그 값을 둔다
    await deps.store.updateRefundIf(record.id, UNSETTLED, { status, external_refund_id: refund.id });
    if (status === "failed") return "review";
  } else if (failure instanceof PolarError && failure.code === "RefundedAlready") {
    await deps.store.updateRefundIf(record.id, UNSETTLED, { status: "succeeded" });
  } else if (isPolarRateLimited(failure)) {
    // Polar가 처리하지 않았다 — 선점을 풀어 다음 시도(웹훅 재시도)가 다시 선점해 요청하게 한다
    await deps.store.releaseRefundClaim(record.id);
    throw failure;
  } else if (isPolarOutcomeUnknown(failure)) {
    if (!(await refundConfirmed(deps, order, amount))) {
      await review(deps, `refund ${ref} has an unknown outcome; refund record ${record.id} left pending`);
      return "review";
    }
    await deps.store.updateRefundIf(record.id, UNSETTLED, { status: "succeeded" });
  } else {
    // 기록부터 남긴다 — 실패를 적다 저장소 오류가 나도 운영자가 안다
    await review(deps, `refund ${ref} failed: ${errorText(failure)}`);
    await deps.store.updateRefundIf(record.id, UNSETTLED, { status: "failed" });
    return "review";
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

/**
 * 결제 행의 종류와 주문번호 — 갱신(subscription_cycle)은 renewal, 그 밖은 initial. 첫 결제가 아닌 주문(플랜 변경 차액
 * subscription_update·사용량 청구 subscription_meter_cycle)은 kind 제약 안에서 initial로 두되(renewal로 적으면 그 기간의 갱신 칸
 * attempt 1 유니크와 부딪힌다) 주문번호 접두 mor_upd_로 갈라 결제 시작을 막는 첫 결제로 세지 않는다(store hasPendingInitialPayment).
 * 외부 결제 id 유니크는 그대로라 같은 주문은 접두와 무관하게 한 행이다.
 */
const NON_FIRST_REASONS = new Set(["subscription_update", "subscription_meter_cycle"]);
const kindOf = (reason: string): PaymentRow["kind"] => (reason === "subscription_cycle" ? "renewal" : "initial");
const orderNumberOf = (order: PolarOrder) => `${NON_FIRST_REASONS.has(order.billing_reason) ? MOR_NON_FIRST_ORDER_PREFIX : "mor_"}${order.id}`;
/** 결제 행의 환불액 — 세금 포함(amount = total_amount와 같은 기준). Polar의 refunded_amount는 세금 제외다 */
const paidBackOf = (order: PolarOrder) => order.refunded_amount + (order.refunded_tax_amount ?? 0);

function approvedAtOf(order: PolarOrder): string | null {
  if (!order.paid) return null;
  return canonicalTime(order.status === "paid" ? (order.modified_at ?? order.created_at) : order.created_at);
}

/**
 * Polar 주문(정본)을 결제 행에 맞춘다 — (provider mor, external_payment_id = 주문 id) 기준으로 만들거나 합친다. 주문번호는 mor_<주문 id>
 * (첫 결제가 아닌 플랜 변경·사용량 주문은 mor_upd_<주문 id>). 종류: subscription_cycle → renewal, 그 밖 → initial(kindOf). 금액은 total_amount(세금 포함), 환불액은 refunded_amount + refunded_tax_amount
 * (Polar의 refunded_amount는 세금 제외라 세금을 더해 금액과 같은 기준으로 맞춘다).
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
      order_id: orderNumberOf(order),
      external_payment_id: order.id,
      amount: order.total_amount,
      currency: "USD",
      period_start: subRow?.current_period_start ?? null,
      period_end: subRow?.current_period_end ?? null,
      attempt: 1,
      status,
      refunded_amount: paidBackOf(order),
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
  const paidBack = paidBackOf(order);
  if (paidBack > existing.refunded_amount) patch.refunded_amount = paidBack;
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
 * 그 모드의 MoR 시도이고 (주면) 그 사용자의 것일 때만 바꾼다. 상태를 바꿨으면 true.
 * completed는 구독 id를 잇고 동의 기록도 그 구독에 잇는다(먼저 — 중간에 멈추면 다음 동기화가 마저 한다).
 * 동의 연결은 시도가 이미 닫혔어도 한다(새 시작이 superseded로 닫았거나 만료된 시도의 이전 결제창에서 결제를 마친 경우 — 사용자는
 * 그 시도에서 동의했다). 닫힌 시도는 사용자(userId)까지 맞을 때만 잇고, 상태는 바꾸지 않는다(false). 이미 completed인 시도는 닫을 때
 * 이었으므로 다시 잇지 않는다.
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
  const unfinished = attempt.status === "open" || attempt.status === "processing";
  if (status === "completed" && opts.subscriptionId && (unfinished || (attempt.status !== "completed" && opts.userId === attempt.user_id))) {
    await deps.store.linkConsents(attempt.id, opts.subscriptionId);
  }
  if (attempt.status !== "open" && attempt.status !== "processing") return false;
  if (status === "expired") {
    await deps.store.expireCheckouts([attempt.id], attempt.status, null);
  } else if (status === "completed") {
    await deps.store.finishCheckout(attempt.id, { status: "completed", subscription_id: opts.subscriptionId ?? null });
  } else {
    await deps.store.finishCheckout(attempt.id, { status: "failed", failure_code: opts.failureCode ?? null });
  }
  return true;
}
