import { z } from "zod";

/**
 * 가격표 입력 — 관리자 폼(FormData)을 검증한다. 서버 액션(lib/actions/adminBillingPrices.ts)이
 * 이 결과만 믿고 billing_prices에 쓴다. provider는 toss, currency는 KRW로 고정이다(해외 결제는 별도 단계).
 */

/** 카드 정기결제로 파는 등급 */
export const SELF_SERVE_PLAN_IDS = ["pro", "enterprise"] as const;
export type SelfServePlanId = (typeof SELF_SERVE_PLAN_IDS)[number];

/** 결제 주기 */
export const PRICE_INTERVALS = ["month", "year"] as const;
export type PriceInterval = (typeof PRICE_INTERVALS)[number];

/** 금액 범위(원, VAT 포함) — 오타로 0이 하나 더 붙은 가격이 열리지 않게 양쪽을 막는다 */
export const PRICE_AMOUNT_MIN = 100;
export const PRICE_AMOUNT_MAX = 10_000_000;

export interface PriceCreateInput {
  planCode: SelfServePlanId;
  interval: PriceInterval;
  amount: number;
  /** true = 실결제 가격, false = 테스트 가격 */
  livemode: boolean;
  active: boolean;
}

export type PriceParse = { ok: true; value: PriceCreateInput } | { ok: false; error: "invalid" };

const field = (fd: FormData, key: string) => String(fd.get(key) ?? "");

const PriceSchema = z.object({
  planCode: z.enum(SELF_SERVE_PLAN_IDS),
  interval: z.enum(PRICE_INTERVALS),
  amount: z.number().int().min(PRICE_AMOUNT_MIN).max(PRICE_AMOUNT_MAX),
  livemode: z.enum(["test", "live"]),
});

export function parsePriceCreate(fd: FormData): PriceParse {
  const amountRaw = field(fd, "amount").trim();
  const parsed = PriceSchema.safeParse({
    planCode: field(fd, "planCode"),
    interval: field(fd, "interval"),
    // 정수 숫자만 — 소수점·쉼표·지수 표기·문자는 NaN으로 걸러진다
    amount: /^\d+$/.test(amountRaw) ? Number(amountRaw) : NaN,
    livemode: field(fd, "livemode"),
  });
  if (!parsed.success) return { ok: false, error: "invalid" };
  const { planCode, interval, amount, livemode } = parsed.data;
  return {
    ok: true,
    value: { planCode, interval, amount, livemode: livemode === "live", active: fd.get("active") === "on" },
  };
}

export function parsePriceId(fd: FormData): { ok: true; value: { priceId: string } } | { ok: false; error: "invalid" } {
  const id = z.string().uuid().safeParse(field(fd, "priceId"));
  return id.success ? { ok: true, value: { priceId: id.data } } : { ok: false, error: "invalid" };
}
