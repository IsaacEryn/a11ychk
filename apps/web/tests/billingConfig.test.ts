import { describe, expect, it } from "vitest";
import { billingMode, billingTestUserIds, entitlementLivemodes, polarKeys, rowLivemode, tossKeys } from "../src/lib/billing/config";

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

describe("polarKeys", () => {
  // 가짜 값 — 실제 토큰·시크릿이 아니다
  const TOKEN = "polar_oat_fake";
  const SECRET = "whsec_ZmFrZQ==";

  it("test 모드는 sandbox, live 모드는 운영 API", () => {
    expect(polarKeys({ BILLING_MODE: "test", POLAR_ACCESS_TOKEN: TOKEN, POLAR_WEBHOOK_SECRET: SECRET })).toEqual({
      accessToken: TOKEN,
      webhookSecret: SECRET,
      apiBase: "https://sandbox-api.polar.sh",
    });
    expect(polarKeys({ BILLING_MODE: "live", POLAR_ACCESS_TOKEN: TOKEN, POLAR_WEBHOOK_SECRET: SECRET })).toEqual({
      accessToken: TOKEN,
      webhookSecret: SECRET,
      apiBase: "https://api.polar.sh",
    });
  });

  it("앞뒤 공백은 잘라 낸다", () => {
    expect(polarKeys({ BILLING_MODE: "test", POLAR_ACCESS_TOKEN: ` ${TOKEN}\n`, POLAR_WEBHOOK_SECRET: ` ${SECRET} ` })).toMatchObject({
      accessToken: TOKEN,
      webhookSecret: SECRET,
    });
  });

  it("v1,whsec_ 시크릿도 받는다", () => {
    expect(polarKeys({ BILLING_MODE: "test", POLAR_ACCESS_TOKEN: TOKEN, POLAR_WEBHOOK_SECRET: `v1,${SECRET}` })?.webhookSecret).toBe(`v1,${SECRET}`);
  });

  it("토스 키와 함께 있어도 모드가 맞으면 준다", () => {
    expect(
      polarKeys({ BILLING_MODE: "live", TOSS_SECRET_KEY: "live_sk_x", POLAR_ACCESS_TOKEN: TOKEN, POLAR_WEBHOOK_SECRET: SECRET })?.apiBase,
    ).toBe("https://api.polar.sh");
  });

  it.each([
    ["모드 off", { POLAR_ACCESS_TOKEN: TOKEN, POLAR_WEBHOOK_SECRET: SECRET }],
    ["모드 값 이상", { BILLING_MODE: "on", POLAR_ACCESS_TOKEN: TOKEN, POLAR_WEBHOOK_SECRET: SECRET }],
    ["토스 키가 모드와 어긋남(전체 off)", { BILLING_MODE: "live", TOSS_SECRET_KEY: "test_sk_x", POLAR_ACCESS_TOKEN: TOKEN, POLAR_WEBHOOK_SECRET: SECRET }],
    ["토큰 없음", { BILLING_MODE: "test", POLAR_WEBHOOK_SECRET: SECRET }],
    ["시크릿 없음", { BILLING_MODE: "test", POLAR_ACCESS_TOKEN: TOKEN }],
    ["토큰이 공백뿐", { BILLING_MODE: "test", POLAR_ACCESS_TOKEN: "  ", POLAR_WEBHOOK_SECRET: SECRET }],
    ["토큰 접두가 다름", { BILLING_MODE: "test", POLAR_ACCESS_TOKEN: "oat_fake", POLAR_WEBHOOK_SECRET: SECRET }],
    ["토큰이 접두뿐", { BILLING_MODE: "test", POLAR_ACCESS_TOKEN: "polar_", POLAR_WEBHOOK_SECRET: SECRET }],
    ["시크릿 접두가 다름", { BILLING_MODE: "test", POLAR_ACCESS_TOKEN: TOKEN, POLAR_WEBHOOK_SECRET: "ZmFrZQ==" }],
    ["v1, 뒤에 whsec_가 없음", { BILLING_MODE: "test", POLAR_ACCESS_TOKEN: TOKEN, POLAR_WEBHOOK_SECRET: "v1,ZmFrZQ==" }],
    ["시크릿이 접두뿐", { BILLING_MODE: "test", POLAR_ACCESS_TOKEN: TOKEN, POLAR_WEBHOOK_SECRET: "whsec_" }],
    ["v1, 시크릿이 접두뿐", { BILLING_MODE: "test", POLAR_ACCESS_TOKEN: TOKEN, POLAR_WEBHOOK_SECRET: "v1,whsec_" }],
  ])("%s → null", (_, env) => {
    expect(polarKeys(env)).toBeNull();
  });
});
