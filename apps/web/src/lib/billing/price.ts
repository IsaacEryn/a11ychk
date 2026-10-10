import { z } from "zod";

/**
 * 가격표 입력 — 관리자 폼(FormData)을 검증한다. 서버 액션(lib/actions/adminBillingPrices.ts)이
 * 이 결과만 믿고 billing_prices에 쓴다. 결제사가 통화를 정한다: 토스는 원(KRW, 부가세 포함 원 단위), 판매 대행(mor, Polar)은
 * USD(cent로 저장, 화면에서는 달러로 넣는다 — 세금은 Polar가 결제창에서 더한다). mor 가격은 Polar 상품 id(UUID)가 있어야 한다.
 * 클라이언트(관리자 폼)도 상수를 쓰므로 서버 전용 모듈을 가져오지 않는다.
 */

/** 카드 정기결제로 파는 등급 */
export const SELF_SERVE_PLAN_IDS = ["pro", "enterprise"] as const;
export type SelfServePlanId = (typeof SELF_SERVE_PLAN_IDS)[number];

/** 결제 주기 */
export const PRICE_INTERVALS = ["month", "year"] as const;
export type PriceInterval = (typeof PRICE_INTERVALS)[number];

/** 관리자가 가격을 넣을 수 있는 결제사 — 토스(국내, 원화)와 판매 대행 Polar(해외, USD) */
export const PRICE_PROVIDERS = ["toss", "mor"] as const;
export type PriceProvider = (typeof PRICE_PROVIDERS)[number];

/** 금액 범위(원, VAT 포함) — 오타로 0이 하나 더 붙은 가격이 열리지 않게 양쪽을 막는다 */
export const PRICE_AMOUNT_MIN = 100;
export const PRICE_AMOUNT_MAX = 10_000_000;
/** USD 금액 범위(cent) — 같은 까닭으로 양쪽을 막는다. 화면에서는 달러로 보인다 */
export const USD_AMOUNT_MIN = 100;
export const USD_AMOUNT_MAX = 1_000_000;

export interface PriceCreateInput {
  provider: PriceProvider;
  /** 결제사가 정한다 — toss는 KRW, mor는 USD */
  currency: "KRW" | "USD";
  planCode: SelfServePlanId;
  interval: PriceInterval;
  /** toss는 원, mor는 cent */
  amount: number;
  /** mor만 — Polar 상품 id(소문자 UUID). toss는 null */
  externalPriceId: string | null;
  /** true = 실결제 가격, false = 테스트 가격 */
  livemode: boolean;
  active: boolean;
}

export type PriceParse = { ok: true; value: PriceCreateInput } | { ok: false; error: "invalid" };

const field = (fd: FormData, key: string) => String(fd.get(key) ?? "");

const common = {
  planCode: z.enum(SELF_SERVE_PLAN_IDS),
  interval: z.enum(PRICE_INTERVALS),
  livemode: z.enum(["test", "live"]),
};
const PriceSchema = z.discriminatedUnion("provider", [
  z.object({ provider: z.literal("toss"), ...common, amount: z.number().int().min(PRICE_AMOUNT_MIN).max(PRICE_AMOUNT_MAX) }),
  z.object({
    provider: z.literal("mor"),
    ...common,
    amount: z.number().int().min(USD_AMOUNT_MIN).max(USD_AMOUNT_MAX),
    externalPriceId: z.string().uuid(),
  }),
]);

/** 원 — 정수 숫자만(소수점·쉼표·지수 표기·문자는 NaN) */
function wonOf(raw: string): number {
  return /^\d+$/.test(raw) ? Number(raw) : NaN;
}

/** 달러 표기 → cent — 정수 또는 소수 둘째 자리까지(부동소수 계산 없이 자릿수로 바꾼다). 그 밖의 모양은 NaN */
function centsOf(raw: string): number {
  const m = /^(\d{1,9})(?:\.(\d{1,2}))?$/.exec(raw);
  if (!m) return NaN;
  return Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0"));
}

export function parsePriceCreate(fd: FormData): PriceParse {
  // 결제사를 고르지 않은 요청(이전 폼)은 토스로 본다
  const provider = field(fd, "provider") || "toss";
  const amountRaw = field(fd, "amount").trim();
  const parsed = PriceSchema.safeParse({
    provider,
    planCode: field(fd, "planCode"),
    interval: field(fd, "interval"),
    amount: provider === "mor" ? centsOf(amountRaw) : wonOf(amountRaw),
    livemode: field(fd, "livemode"),
    ...(provider === "mor" ? { externalPriceId: field(fd, "externalPriceId").trim() } : {}),
  });
  if (!parsed.success) return { ok: false, error: "invalid" };
  const v = parsed.data;
  return {
    ok: true,
    value: {
      provider: v.provider,
      currency: v.provider === "mor" ? "USD" : "KRW",
      planCode: v.planCode,
      interval: v.interval,
      amount: v.amount,
      externalPriceId: v.provider === "mor" ? v.externalPriceId.toLowerCase() : null,
      livemode: v.livemode === "live",
      active: fd.get("active") === "on",
    },
  };
}

/** 요금제 화면의 결제 경로 — 한국어(국내)는 토스(원화), 영어(해외)는 판매 대행 Polar(USD) */
export function pricingChannel(locale: string): { provider: PriceProvider; currency: "KRW" | "USD" } {
  return locale === "en" ? { provider: "mor", currency: "USD" } : { provider: "toss", currency: "KRW" };
}

/** 화면에 보이는 금액 단위 — 원은 그대로, USD는 cent를 달러로(Intl 통화 서식에 넘기는 값) */
export function amountInMajorUnits(amount: number, currency: "KRW" | "USD"): number {
  return currency === "USD" ? amount / 100 : amount;
}

export function parsePriceId(fd: FormData): { ok: true; value: { priceId: string } } | { ok: false; error: "invalid" } {
  const id = z.string().uuid().safeParse(field(fd, "priceId"));
  return id.success ? { ok: true, value: { priceId: id.data } } : { ok: false, error: "invalid" };
}
