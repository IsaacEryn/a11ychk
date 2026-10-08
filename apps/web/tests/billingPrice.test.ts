import { describe, expect, it } from "vitest";
import { SELF_SERVE_PLAN_IDS, parsePriceCreate, parsePriceId } from "../src/lib/billing/price";

function fd(entries: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  return f;
}

const base = { planCode: "pro", interval: "month", amount: "1234", livemode: "test", active: "on" };

describe("SELF_SERVE_PLAN_IDS", () => {
  it("셀프서비스로 파는 등급은 pro·enterprise", () => {
    expect([...SELF_SERVE_PLAN_IDS]).toEqual(["pro", "enterprise"]);
  });
});

describe("parsePriceCreate", () => {
  it("정상 입력 — 테스트 모드·활성", () => {
    expect(parsePriceCreate(fd(base))).toEqual({
      ok: true,
      value: { planCode: "pro", interval: "month", amount: 1234, livemode: false, active: true },
    });
  });

  it("실결제·연 주기·enterprise도 허용", () => {
    expect(parsePriceCreate(fd({ ...base, planCode: "enterprise", interval: "year", livemode: "live" }))).toEqual({
      ok: true,
      value: { planCode: "enterprise", interval: "year", amount: 1234, livemode: true, active: true },
    });
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
