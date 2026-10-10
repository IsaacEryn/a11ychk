import { describe, expect, it } from "vitest";
import { ANONYMOUS_VIEWER, canCheckout, canSeePrices, priceLivemode } from "../src/lib/billing/visibility";

const closed = { showPrices: false, checkoutOpen: false };
const open = { showPrices: true, checkoutOpen: true };
const admin = { isAdmin: true, isTester: false };
const tester = { isAdmin: false, isTester: true };

describe("결제 공개 범위", () => {
  it("off: 결제는 아무도 못 하고, 가격은 showPrices일 때만(심사용 진열)", () => {
    for (const v of [ANONYMOUS_VIEWER, admin, tester]) expect(canCheckout("off", open, v)).toBe(false);
    expect(canSeePrices("off", closed, admin)).toBe(false);
    expect(canSeePrices("off", { showPrices: true, checkoutOpen: false }, ANONYMOUS_VIEWER)).toBe(true);
  });
  it("test: 관리자·테스터만 — 플래그를 다 열어도 일반 사용자는 영구 불가", () => {
    expect(canCheckout("test", open, ANONYMOUS_VIEWER)).toBe(false);
    expect(canSeePrices("test", open, ANONYMOUS_VIEWER)).toBe(false);
    expect(canCheckout("test", closed, admin)).toBe(true);
    expect(canCheckout("test", closed, tester)).toBe(true);
    expect(canSeePrices("test", closed, tester)).toBe(true);
  });
  it("live: checkoutOpen이면 누구나, 아니면 관리자만", () => {
    expect(canCheckout("live", closed, ANONYMOUS_VIEWER)).toBe(false);
    expect(canCheckout("live", closed, admin)).toBe(true);
    expect(canCheckout("live", closed, tester)).toBe(false);
    expect(canCheckout("live", open, ANONYMOUS_VIEWER)).toBe(true);
    expect(canSeePrices("live", { showPrices: true, checkoutOpen: false }, ANONYMOUS_VIEWER)).toBe(true);
    expect(canSeePrices("live", closed, admin)).toBe(true);
  });
  it("가격 행 livemode: test만 false", () => {
    expect(priceLivemode("test")).toBe(false);
    expect(priceLivemode("live")).toBe(true);
    expect(priceLivemode("off")).toBe(true);
  });
});
