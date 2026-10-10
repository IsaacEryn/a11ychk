import { describe, expect, it } from "vitest";
import {
  SELF_SERVE_PLAN_IDS,
  USD_AMOUNT_MAX,
  USD_AMOUNT_MIN,
  amountInMajorUnits,
  parsePriceCreate,
  pricingChannel,
  parsePriceId,
} from "../src/lib/billing/price";

function fd(entries: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  return f;
}

const base = { planCode: "pro", interval: "month", amount: "1234", livemode: "test", active: "on" };
const PRODUCT = "44444444-4444-4444-8444-444444444444";
const mor = { ...base, provider: "mor", amount: "12.34", externalPriceId: PRODUCT };

describe("SELF_SERVE_PLAN_IDS", () => {
  it("셀프서비스로 파는 등급은 pro·enterprise", () => {
    expect([...SELF_SERVE_PLAN_IDS]).toEqual(["pro", "enterprise"]);
  });
});

describe("parsePriceCreate", () => {
  it("정상 입력 — 결제사를 고르지 않으면 토스(원화), 테스트 모드·활성", () => {
    expect(parsePriceCreate(fd(base))).toEqual({
      ok: true,
      value: { provider: "toss", currency: "KRW", planCode: "pro", interval: "month", amount: 1234, externalPriceId: null, livemode: false, active: true },
    });
    expect(parsePriceCreate(fd({ ...base, provider: "toss" }))).toEqual(parsePriceCreate(fd(base)));
  });

  it("실결제·연 주기·enterprise도 허용", () => {
    expect(parsePriceCreate(fd({ ...base, planCode: "enterprise", interval: "year", livemode: "live" }))).toEqual({
      ok: true,
      value: { provider: "toss", currency: "KRW", planCode: "enterprise", interval: "year", amount: 1234, externalPriceId: null, livemode: true, active: true },
    });
  });

  it("토스 가격에 Polar 상품 id가 함께 오면 버린다(토스 행에는 외부 id가 없다)", () => {
    const r = parsePriceCreate(fd({ ...base, externalPriceId: PRODUCT }));
    expect(r.ok && r.value.externalPriceId).toBe(null);
  });

  it("앞뒤 공백은 정리한다", () => {
    const r = parsePriceCreate(fd({ ...base, amount: "  1234 " }));
    expect(r.ok && r.value.amount).toBe(1234);
  });

  describe("금액 경계(100~10,000,000원)", () => {
    it.each([
      ["99", false],
      ["100", true],
      ["10000000", true],
      ["10000001", false],
    ])("%s → ok=%s", (amount, ok) => {
      const r = parsePriceCreate(fd({ ...base, amount }));
      expect(r.ok).toBe(ok);
      if (r.ok) expect(r.value.amount).toBe(Number(amount));
      else expect(r).toEqual({ ok: false, error: "invalid" });
    });

    it.each(["", "0", "-100", "1234.5", "1234.0", "12,345", "1e3", "abc", "12a", "０１２３４", "1 234"])(
      "정수가 아니거나 형식이 틀리면 거부: %j",
      (amount) => {
        expect(parsePriceCreate(fd({ ...base, amount }))).toEqual({ ok: false, error: "invalid" });
      },
    );

    it("금액 필드가 아예 없으면 거부", () => {
      const f = fd(base);
      f.delete("amount");
      expect(parsePriceCreate(f)).toEqual({ ok: false, error: "invalid" });
    });
  });

  it.each([
    ["planCode", "free"],
    ["planCode", "plus1"],
    ["planCode", "unlimited"],
    ["planCode", ""],
    ["planCode", "PRO"],
    ["interval", "week"],
    ["interval", "contract"],
    ["interval", ""],
    ["livemode", "true"],
    ["livemode", "production"],
    ["livemode", ""],
    ["provider", "manual"],
    ["provider", "polar"],
    ["provider", "MOR"],
  ])("모르는 값은 거부: %s=%j", (key, value) => {
    expect(parsePriceCreate(fd({ ...base, [key]: value }))).toEqual({ ok: false, error: "invalid" });
  });

  describe("active 체크박스", () => {
    it('"on"이면 활성', () => {
      const r = parsePriceCreate(fd({ ...base, active: "on" }));
      expect(r.ok && r.value.active).toBe(true);
    });

    it("체크하지 않아 필드가 없으면 비활성", () => {
      const f = fd(base);
      f.delete("active");
      const r = parsePriceCreate(f);
      expect(r.ok && r.value.active).toBe(false);
    });

    it('"on"이 아닌 값은 비활성', () => {
      const r = parsePriceCreate(fd({ ...base, active: "true" }));
      expect(r.ok && r.value.active).toBe(false);
    });
  });
});

describe("parsePriceCreate — 판매 대행(Polar, USD)", () => {
  it("달러로 넣은 금액을 cent로, Polar 상품 id(UUID)는 소문자로", () => {
    expect(parsePriceCreate(fd({ ...mor, externalPriceId: PRODUCT.toUpperCase() }))).toEqual({
      ok: true,
      value: { provider: "mor", currency: "USD", planCode: "pro", interval: "month", amount: 1234, externalPriceId: PRODUCT, livemode: false, active: true },
    });
  });

  it.each([
    ["12", 1200],
    ["12.3", 1230],
    ["12.30", 1230],
    [" 12.34 ", 1234],
    ["012.34", 1234],
  ])("달러 표기 %j → %i cent", (amount, cents) => {
    const r = parsePriceCreate(fd({ ...mor, amount }));
    expect(r.ok && r.value.amount).toBe(cents);
  });

  it.each(["", "12.345", "12.", ".5", "-12", "1,234.00", "1e3", "$12", "12.3a", "１２"])("형식이 틀리면 거부: %j", (amount) => {
    expect(parsePriceCreate(fd({ ...mor, amount }))).toEqual({ ok: false, error: "invalid" });
  });

  it("금액 경계 — cent 기준 최소·최대", () => {
    const dollars = (cents: number) => `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;
    expect(parsePriceCreate(fd({ ...mor, amount: dollars(USD_AMOUNT_MIN) })).ok).toBe(true);
    expect(parsePriceCreate(fd({ ...mor, amount: dollars(USD_AMOUNT_MIN - 1) })).ok).toBe(false);
    expect(parsePriceCreate(fd({ ...mor, amount: dollars(USD_AMOUNT_MAX) })).ok).toBe(true);
    expect(parsePriceCreate(fd({ ...mor, amount: dollars(USD_AMOUNT_MAX + 1) })).ok).toBe(false);
  });

  it("Polar 상품 id가 없거나 UUID가 아니면 거부", () => {
    const f = fd(mor);
    f.delete("externalPriceId");
    expect(parsePriceCreate(f)).toEqual({ ok: false, error: "invalid" });
    for (const externalPriceId of ["", "prod_123", `${PRODUCT} `.repeat(2), "44444444-4444-4444-8444-44444444444g"]) {
      expect(parsePriceCreate(fd({ ...mor, externalPriceId }))).toEqual({ ok: false, error: "invalid" });
    }
  });

  it("앞뒤 공백은 정리한다", () => {
    const r = parsePriceCreate(fd({ ...mor, externalPriceId: `  ${PRODUCT}  ` }));
    expect(r.ok && r.value.externalPriceId).toBe(PRODUCT);
  });
});

describe("amountInMajorUnits — 화면 표시 단위", () => {
  it("원은 그대로, USD cent는 달러로", () => {
    expect(amountInMajorUnits(1234, "KRW")).toBe(1234);
    expect(amountInMajorUnits(1234, "USD")).toBe(12.34);
    expect(amountInMajorUnits(1200, "USD")).toBe(12);
  });
});

describe("pricingChannel — 요금제 화면의 결제 경로", () => {
  it("영어는 판매 대행 Polar(USD), 한국어와 그 밖은 토스(원화)", () => {
    expect(pricingChannel("en")).toEqual({ provider: "mor", currency: "USD" });
    expect(pricingChannel("ko")).toEqual({ provider: "toss", currency: "KRW" });
    expect(pricingChannel("fr")).toEqual({ provider: "toss", currency: "KRW" });
  });
});

describe("parsePriceId", () => {
  it("UUID만 허용", () => {
    expect(parsePriceId(fd({ priceId: "11111111-2222-4333-8444-555555555555" }))).toEqual({
      ok: true,
      value: { priceId: "11111111-2222-4333-8444-555555555555" },
    });
    expect(parsePriceId(fd({ priceId: "not-a-uuid" }))).toEqual({ ok: false, error: "invalid" });
    expect(parsePriceId(fd({}))).toEqual({ ok: false, error: "invalid" });
  });
});
