import { describe, expect, it } from "vitest";
import { billingMode, entitlementLivemodes } from "../src/lib/billing/config";

describe("billingMode", () => {
  it.each([
    [{}, "off"],
    [{ BILLING_MODE: "" }, "off"],
    [{ BILLING_MODE: "on" }, "off"],
    [{ BILLING_MODE: "test" }, "test"],
    [{ BILLING_MODE: "live" }, "live"],
    [{ BILLING_MODE: "test", TOSS_SECRET_KEY: "test_sk_x" }, "test"],
    [{ BILLING_MODE: "live", TOSS_SECRET_KEY: "live_sk_x" }, "live"],
    // 키와 모드가 어긋나면 결제를 아예 막는다
    [{ BILLING_MODE: "live", TOSS_SECRET_KEY: "test_sk_x" }, "off"],
    [{ BILLING_MODE: "test", TOSS_SECRET_KEY: "live_sk_x" }, "off"],
    [{ BILLING_MODE: "test", TOSS_SECRET_KEY: "test_gsk_x" }, "test"],
  ] as const)("%j → %s", (env, expected) => {
    expect(billingMode(env)).toBe(expected);
  });
});

describe("entitlementLivemodes", () => {
  it("테스트 모드에서만 테스트 결제 행도 권한에 반영한다", () => {
    expect(entitlementLivemodes("test")).toEqual([true, false]);
    expect(entitlementLivemodes("live")).toEqual([true]);
    expect(entitlementLivemodes("off")).toEqual([true]);
  });
});
