import { z } from "zod";
import { addInterval, earliestChargeAt, kstDayOfMonth } from "./period";
import type { CheckoutRow, PriceRow, SubscriptionRow } from "./types";
import type { CheckoutOutcome } from "./flows/subscribe";

/**
 * 결제 시작·토스 리다이렉트의 순수 부분 — 입력 검증, 돌아올 주소(요청 origin), 동시 시도 차단 판정,
 * 확인 화면·동의 스냅샷의 조건, 콜백 뒤 이동할 주소. 서버 액션·라우트는 이 결과만 믿고 저장소를 부른다.
 * 금액·주기는 항상 DB 가격 행에서 오고, 클라이언트가 보내는 값은 가격 id·구독 id·동의 체크뿐이다.
 */

const MIN_MS = 60_000;
/** 결제 시도 유효 시간 — 결제창을 열고 카드를 등록하기에 충분하고, 버려진 시도가 오래 막지 않게 */
export const CHECKOUT_TTL_MS = 30 * MIN_MS;
/**
 * 선점(processing)된 채 멈춘 시도를 버려진 것으로 보는 시점 — 만료 시각 기준 +30분.
 * 선점은 만료 전에만 되므로 이 시점이면 선점한 지 30분이 넘었다(토스 호출은 15초 제한이라 실행은 끝났다)
 */
export const PROCESSING_STALE_MS = 30 * MIN_MS;
/** 결제 확인 화면 문구의 판 — 문구를 바꾸면 올린다(동의 기록이 어떤 문구를 봤는지 남긴다) */
export const DISCLOSURE_VERSION = "recurring-2026-10";

export const CHECKOUT_LOCALES = ["ko", "en"] as const;
export type CheckoutLocale = (typeof CHECKOUT_LOCALES)[number];

export function checkoutLocale(raw: string | null | undefined): CheckoutLocale {
  return raw === "en" ? "en" : "ko";
}

// ── 입력 ──

const field = (fd: FormData, key: string) => String(fd.get(key) ?? "");
const Uuid = z.string().uuid();

export type StartInput = { ok: true; value: { priceId: string } } | { ok: false; error: "invalid" | "consent" };

/** 결제 시작 — 가격 id(UUID), purpose(없으면 subscribe — 카드 변경은 startCardChange가 맡는다), 동의 체크 */
export function parseStartCheckout(fd: FormData): StartInput {
  const priceId = Uuid.safeParse(field(fd, "priceId"));
  const purpose = field(fd, "purpose");
  if (!priceId.success || (purpose !== "" && purpose !== "subscribe")) return { ok: false, error: "invalid" };
  // 미리 체크하지 않은 필수 동의 — 체크박스가 보낸 "on"만 동의로 본다
  if (fd.get("consent") !== "on") return { ok: false, error: "consent" };
  return { ok: true, value: { priceId: priceId.data } };
}

export function parseCardChange(fd: FormData): { ok: true; value: { subscriptionId: string } } | { ok: false; error: "invalid" } {
  const id = Uuid.safeParse(field(fd, "subscriptionId"));
  return id.success ? { ok: true, value: { subscriptionId: id.data } } : { ok: false, error: "invalid" };
}

// ── 돌아올 주소 ──

/** 호스트 헤더 모양 — 이름(영문·숫자·-·.) 또는 [IPv6], 선택 포트. 경로·사용자 정보·공백이 섞이면 거부 */
const HOST_RE = /^(?:[a-z0-9-]+(?:\.[a-z0-9-]+)*|\[[0-9a-f:.]+\])(?::\d{1,5})?$/i;
const first = (v: string | null) => v?.split(",")[0]?.trim() || null;

function isLoopback(hostname: string): boolean {
  const h = hostname.toLowerCase();
  return h === "localhost" || h.endsWith(".localhost") || h === "127.0.0.1" || h === "[::1]";
}

/**
 * 결제창이 돌아올 origin — 요청 헤더(host·x-forwarded-host·x-forwarded-proto)에서 만든다.
 * 클라이언트가 보내는 값(폼·Origin·Referer)은 쓰지 않는다. x-forwarded-host가 있으면 host와 같아야 하고,
 * 프로토콜은 https만(로컬 개발 호스트는 http도) 받는다. 프로토콜 헤더가 없으면 로컬은 http, 나머지는 https.
 * 조건이 맞지 않으면 null — 호출부는 결제 시도를 만들기 전에 멈춘다.
 */
export function requestOrigin(headers: { get(name: string): string | null }): string | null {
  const host = first(headers.get("host"));
  if (!host || !HOST_RE.test(host)) return null;
  const forwarded = first(headers.get("x-forwarded-host"));
  if (forwarded && forwarded.toLowerCase() !== host.toLowerCase()) return null;
  const hostname = host.replace(/:\d+$/, "");
  const local = isLoopback(hostname);
  const proto = first(headers.get("x-forwarded-proto"))?.toLowerCase() ?? (local ? "http" : "https");
  if (proto !== "https" && !(proto === "http" && local)) return null;
  return `${proto}://${host.toLowerCase()}`;
}

/** 토스 결제창의 성공·실패 주소 — 결제 시도 id와 로케일만 싣는다(개인정보 없음). 토스가 뒤에 인증 결과를 붙인다 */
export function checkoutReturnUrls(origin: string, checkoutId: string, locale: CheckoutLocale): { successUrl: string; failUrl: string } {
  const query = `checkout=${encodeURIComponent(checkoutId)}&locale=${locale}`;
  return {
    successUrl: `${origin}/api/billing/toss/callback?${query}`,
    failUrl: `${origin}/api/billing/toss/fail?${query}`,
  };
}

/**
 * 결제창이 돌아온 주소의 쿼리 — 토스가 우리 쿼리(checkout·locale) 뒤에 인증 결과를 붙인다. 이어 붙일 때 `?`를 한 번 더
 * 쓰더라도(`...&locale=ko?customerKey=...`) 같은 값을 읽는다: 두 번째 이후의 `?`를 `&`로 보고, 서버가 그 `?`를 인코딩해
 * 넘겨 값 안에 `?`가 남았으면(`locale` = `ko?customerKey=...`) 그 뒤를 다시 쿼리로 읽는다. 우리가 읽는 값(시도 id·로케일·
 * 고객 키·authKey·코드)에는 `?`가 들어가지 않는다. 같은 이름이 또 나오면 앞의 값이 이긴다(get은 첫 값).
 */
export function tossReturnParams(search: string): URLSearchParams {
  const out = new URLSearchParams();
  const visit = (query: string, depth: number) => {
    for (const [key, value] of new URLSearchParams(query)) {
      const at = depth < 4 ? value.indexOf("?") : -1;
      out.append(key, at === -1 ? value : value.slice(0, at));
      if (at !== -1) visit(value.slice(at + 1), depth + 1);
    }
  };
  visit(search.replace(/^\?/, "").replace(/\?/g, "&"), 0);
  return out;
}

// ── 동시 시도 차단 ──

/** 새 시도를 막는 까닭 — open: 선점 전 시도(사용자가 닫을 수 있다), processing: 처리 중인 시도·결과 불명 결제(기다려야 한다) */
export type CheckoutBlock = "open" | "processing";

export interface CheckoutGuardPlan {
  /** 만료 시각이 지난 open — expired로 정리한다 */
  expireOpen: string[];
  /** 선점된 채 멈춘 processing(결과를 모르는 첫 결제가 없을 때만) — expired로 정리한다 */
  expireProcessing: string[];
  /** 정리 뒤에도 남는 막는 까닭(없으면 null) — 둘 다 있으면 processing(open을 닫아도 풀리지 않는다) */
  blockedBy: CheckoutBlock | null;
}

/**
 * 같은 사용자·모드의 끝나지 않은 시도로 새 시도를 막을지 정한다. 결제창이 둘 열리면 카드 등록이 겹쳐
 * 이중 결제(뒤이은 자동 환불)가 날 수 있어, 한 번에 한 시도만 둔다.
 * - open: 만료 전이면 막고, 만료됐으면 정리한다(선점은 만료 전에만 되므로 만료 시각과 같아도 만료로 본다).
 * - processing: 결과를 모르는 첫 결제가 있으면 정리하지 않고 막는다(대사가 확정한다). 없고 만료 시각 +30분이
 *   지났으면 멈춘 시도로 보고 정리한다. 그 전이면 아직 처리 중이라 막는다.
 * - 결과를 모르는 첫 결제가 있으면 시도와 무관하게 막는다 — 결제가 됐는지 확인하기 전에 다시 결제하지 않게.
 */
export function planCheckoutGuard(
  rows: Array<Pick<CheckoutRow, "id" | "status" | "expires_at">>,
  opts: { now: number; pendingInitialPayment: boolean },
): CheckoutGuardPlan {
  const expireOpen: string[] = [];
  const expireProcessing: string[] = [];
  let openBlock = false;
  let processingBlock = opts.pendingInitialPayment;
  for (const row of rows) {
    const expires = Date.parse(row.expires_at);
    if (row.status === "open") {
      if (expires <= opts.now) expireOpen.push(row.id);
      else openBlock = true;
    } else if (row.status === "processing") {
      if (!opts.pendingInitialPayment && expires + PROCESSING_STALE_MS <= opts.now) expireProcessing.push(row.id);
      else processingBlock = true;
    }
  }
  return { expireOpen, expireProcessing, blockedBy: processingBlock ? "processing" : openBlock ? "open" : null };
}

// ── 확인 화면·동의 ──

export interface CheckoutTerms {
  planCode: string;
  amount: number;
  currency: PriceRow["currency"];
  interval: PriceRow["interval"];
  /** 오늘 첫 결제 시각 = 첫 이용 기간의 시작 */
  firstChargeAt: string;
  /** 첫 이용 기간의 끝 — 오늘의 KST 일자를 앵커로 한 주기 뒤(짧은 달은 말일). 첫 결제가 만드는 구독의 current_period_end와 같은 계산 */
  periodEnd: string;
  /**
   * 다음(첫 갱신) 결제가 나갈 수 있는 가장 이른 시각 — 기간 끝 하루 전(earliestChargeAt). 크론이 이때부터 결제하고
   * 결제 예정 안내 메일도 이 시각을 결제일로 적는다. 화면의 "다음 결제일"은 이 시각의 KST 날짜다
   */
  nextChargeAt: string;
}

/** 확인 화면과 동의 스냅샷이 같은 계산을 쓴다 — 보여 준 조건과 기록한 조건이 어긋나지 않게 */
export function checkoutTerms(price: Pick<PriceRow, "plan_code" | "amount" | "currency" | "interval">, now: number): CheckoutTerms {
  const firstChargeAt = new Date(now).toISOString();
  const periodEnd = addInterval(firstChargeAt, price.interval, kstDayOfMonth(now));
  return {
    planCode: price.plan_code,
    amount: price.amount,
    currency: price.currency,
    interval: price.interval,
    firstChargeAt,
    periodEnd,
    nextChargeAt: earliestChargeAt(periodEnd),
  };
}

/** billing_consents.snapshot — 동의한 조건 그대로(열 이름은 DB 관례대로 snake_case) */
export function consentSnapshot(
  price: Pick<PriceRow, "plan_code" | "amount" | "currency" | "interval">,
  now: number,
  locale: CheckoutLocale,
): Record<string, unknown> {
  const terms = checkoutTerms(price, now);
  return {
    plan_code: terms.planCode,
    amount: terms.amount,
    currency: terms.currency,
    interval: terms.interval,
    first_charge_at: terms.firstChargeAt,
    period_end: terms.periodEnd,
    next_charge_at: terms.nextChargeAt,
    locale,
  };
}

// ── 카드 변경 대상 ──

/** 카드를 바꿀 수 있는 구독 — 그 사용자의 진행 중(active·past_due) 토스 구독이고 모드가 같다 */
export function isCardChangeTarget(
  sub: Pick<SubscriptionRow, "user_id" | "provider" | "livemode" | "status" | "interval">,
  userId: string,
  livemode: boolean,
): boolean {
  return (
    sub.user_id === userId &&
    sub.provider === "toss" &&
    sub.livemode === livemode &&
    (sub.status === "active" || sub.status === "past_due") &&
    sub.interval !== "contract"
  );
}

// ── 토스 리다이렉트 뒤 이동 ──

const managePath = (locale: CheckoutLocale, query: string) => `/${locale}/mypage/billing?${query}`;

/** 오류 안내 주소 — 새 구독의 가격을 알면 그 결제 화면, 아니면(카드 변경·모르는 시도) 결제 관리. code는 흐름이 정한 코드만 */
export function checkoutErrorPath(locale: CheckoutLocale, priceId: string | null | undefined, code: string): string {
  return priceId ? `/${locale}/billing/checkout?price=${encodeURIComponent(priceId)}&error=${code}` : managePath(locale, `error=${code}`);
}

/** 결제창 성공(콜백) 뒤 — 결과는 결제 관리로, 오류는 가격이 있으면 결제 화면으로 */
export function callbackRedirectPath(outcome: CheckoutOutcome, locale: CheckoutLocale): string {
  switch (outcome.kind) {
    case "subscribed":
      return managePath(locale, "result=subscribed");
    case "cardChanged":
      return managePath(locale, `result=cardChanged&retry=${outcome.retry}`);
    case "pending":
      return managePath(locale, "result=pending");
    case "error":
      return checkoutErrorPath(locale, outcome.priceId, outcome.code);
  }
}

/** 결제창 실패·취소 뒤 — 카드 변경이었거나 시도를 모르면 결제 관리로, 새 구독이면 그 가격의 결제 화면으로 */
export function failRedirectPath(
  result: { priceId: string | null; reason: "canceled" | "failed"; purpose: CheckoutRow["purpose"] | null },
  locale: CheckoutLocale,
): string {
  return checkoutErrorPath(locale, result.purpose === "subscribe" ? result.priceId : null, result.reason);
}

// ── 돌아온 화면의 안내 ──

/**
 * 결제창에서 돌아와 결제 화면·결제 관리가 보여 줄 수 있는 오류 — 위 경로들이 싣는 코드 전부.
 * 이 목록 밖의 값은 무시한다(쿼리 문자열을 화면에 그대로 싣지 않는다)
 */
export const RETURN_ERRORS = [
  "canceled",
  "cardRejected",
  "failed",
  "expired",
  "hasActive",
  "duplicateRefunded",
  "customerMismatch",
  "priceInactive",
  "notConfigured",
  "notFound",
] as const;
export type ReturnError = (typeof RETURN_ERRORS)[number];

/** ?error= 값 — 목록에 있는 코드만(배열·빈 값·모르는 값은 null) */
export function returnErrorOf(raw: unknown): ReturnError | null {
  return typeof raw === "string" && (RETURN_ERRORS as readonly string[]).includes(raw) ? (raw as ReturnError) : null;
}

export const CARD_CHANGE_RETRIES = ["paid", "failed", "pending", "none"] as const;
export type CardChangeRetry = (typeof CARD_CHANGE_RETRIES)[number];

/** 결제 관리로 돌아온 결과(callbackRedirectPath가 싣는 값) */
export type ManageReturn = { kind: "subscribed" } | { kind: "cardChanged"; retry: CardChangeRetry } | { kind: "pending" };

/** ?result=·?retry= 값 — 콜백이 싣는 조합만. 카드 변경인데 재결제 결과가 목록 밖이면 아무것도 보이지 않는다 */
export function manageReturnOf(result: unknown, retry: unknown): ManageReturn | null {
  if (result === "subscribed" || result === "pending") return { kind: result };
  if (result !== "cardChanged") return null;
  return typeof retry === "string" && (CARD_CHANGE_RETRIES as readonly string[]).includes(retry)
    ? { kind: "cardChanged", retry: retry as CardChangeRetry }
    : null;
}
