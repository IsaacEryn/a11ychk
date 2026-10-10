import { describe, expect, it } from "vitest";
import { billingMode, billingTestUserIds, entitlementLivemodes, rowLivemode, tossKeys } from "../src/lib/billing/config";

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

describe("tossKeys / billingTestUserIds / rowLivemode", () => {
  it("모드 값의 앞뒤 공백은 무시한다", () => {
    expect(billingMode({ BILLING_MODE: " test " })).toBe("test");
  });
  it("모드가 켜져 있고 두 키가 모두 모드 접두면 키를 준다", () => {
    expect(tossKeys({ BILLING_MODE: "test", TOSS_CLIENT_KEY: "test_ck_a", TOSS_SECRET_KEY: "test_sk_b" })).toEqual({
      clientKey: "test_ck_a",
      secretKey: "test_sk_b",
    });
  });
  it("off이거나 키가 비었거나 클라이언트 키 접두가 다르면 null", () => {
    expect(tossKeys({ TOSS_CLIENT_KEY: "test_ck_a", TOSS_SECRET_KEY: "test_sk_b" })).toBeNull();
    expect(tossKeys({ BILLING_MODE: "test", TOSS_SECRET_KEY: "test_sk_b" })).toBeNull();
    expect(tossKeys({ BILLING_MODE: "test", TOSS_CLIENT_KEY: "live_ck_a", TOSS_SECRET_KEY: "test_sk_b" })).toBeNull();
  });
  it("테스터 목록은 쉼표 구분·공백 무시", () => {
    expect([...billingTestUserIds({ BILLING_TEST_USER_IDS: " a , b,," })]).toEqual(["a", "b"]);
    expect(billingTestUserIds({}).size).toBe(0);
  });
  it("새 결제 행의 livemode", () => {
    expect(rowLivemode("test")).toBe(false);
    expect(rowLivemode("live")).toBe(true);
    expect(rowLivemode("off")).toBeNull();
  });
});
