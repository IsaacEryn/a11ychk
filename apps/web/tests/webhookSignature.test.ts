import crypto from "node:crypto";
import { describe, expect, it } from "vitest";
import { standardWebhookKeys, verifyStandardWebhook } from "../src/lib/webhookSignature";

// 테스트 전용 가짜 키 — 실제 시크릿이 아니다
const RAW_KEY = Buffer.from("fake-signing-key-for-tests-only!");
const SECRET = `whsec_${RAW_KEY.toString("base64")}`;
const ID = "msg_fake_1";
const TS = "1700000000";
const BODY = JSON.stringify({ type: "subscription.updated", data: { id: "sub_fake" } });

function sign(key: Buffer, id = ID, ts = TS, body = BODY): string {
  return crypto.createHmac("sha256", key).update(`${id}.${ts}.${body}`).digest("base64");
}

function input(over: Partial<Parameters<typeof verifyStandardWebhook>[0]> = {}) {
  return {
    id: ID,
    timestamp: TS,
    signatureHeader: `v1,${sign(RAW_KEY)}`,
    body: BODY,
    keys: standardWebhookKeys(SECRET),
    ...over,
  };
}

describe("verifyStandardWebhook", () => {
  it("Standard 키로 만든 서명은 ok", () => {
    expect(verifyStandardWebhook(input())).toBe("ok");
  });

  it("본문·id·타임스탬프를 바꾸면 bad_signature", () => {
    expect(verifyStandardWebhook(input({ body: `${BODY} ` }))).toBe("bad_signature");
    expect(verifyStandardWebhook(input({ id: "msg_fake_2" }))).toBe("bad_signature");
    expect(verifyStandardWebhook(input({ timestamp: "1700000001" }))).toBe("bad_signature");
  });

  it("다른 키로 만든 서명은 bad_signature", () => {
    const other = Buffer.from("another-fake-key-for-tests-only!");
    expect(verifyStandardWebhook(input({ signatureHeader: `v1,${sign(other)}` }))).toBe("bad_signature");
  });

  it("공백으로 구분한 여러 서명 중 하나만 맞아도 ok", () => {
    const good = sign(RAW_KEY);
    const bad = sign(Buffer.from("another-fake-key-for-tests-only!"));
    expect(verifyStandardWebhook(input({ signatureHeader: `v1,${bad} v1,${good}` }))).toBe("ok");
    expect(verifyStandardWebhook(input({ signatureHeader: `v1,${good} v1,${bad}` }))).toBe("ok");
    expect(verifyStandardWebhook(input({ signatureHeader: `  v1,${bad}   v1,${good}  ` }))).toBe("ok");
    expect(verifyStandardWebhook(input({ signatureHeader: `v1,${bad} v1,${bad}` }))).toBe("bad_signature");
  });

  it("v1, 접두가 아닌 서명은 보지 않는다", () => {
    const good = sign(RAW_KEY);
    expect(verifyStandardWebhook(input({ signatureHeader: good }))).toBe("bad_signature");
    expect(verifyStandardWebhook(input({ signatureHeader: `v2,${good}` }))).toBe("bad_signature");
    expect(verifyStandardWebhook(input({ signatureHeader: `v1a,${good}` }))).toBe("bad_signature");
  });

  it("길이가 다른 서명은 예외 없이 bad_signature", () => {
    expect(verifyStandardWebhook(input({ signatureHeader: "v1,short" }))).toBe("bad_signature");
    expect(verifyStandardWebhook(input({ signatureHeader: `v1,${sign(RAW_KEY)}AAAA` }))).toBe("bad_signature");
    expect(verifyStandardWebhook(input({ signatureHeader: "v1," }))).toBe("bad_signature");
  });

  it("키가 없으면 bad_signature", () => {
    expect(verifyStandardWebhook(input({ keys: [] }))).toBe("bad_signature");
  });

  it("두 키 중 아무 키로 만든 서명이든 받는다(Polar 옛 시크릿)", () => {
    const legacy = Buffer.from(SECRET, "utf8");
    expect(verifyStandardWebhook(input({ signatureHeader: `v1,${sign(legacy)}` }))).toBe("ok");
  });

  it.each([
    ["id", { id: null }],
    ["id 빈 값", { id: "" }],
    ["timestamp", { timestamp: undefined }],
    ["timestamp 빈 값", { timestamp: "" }],
    ["signature", { signatureHeader: null }],
    ["signature 빈 값", { signatureHeader: "" }],
  ])("%s가 없으면 missing", (_, over) => {
    expect(verifyStandardWebhook(input(over))).toBe("missing");
  });

  it.each(["abc", "1700000000.5", "-1700000000", "1e9", " 1700000000"])("숫자가 아닌 타임스탬프 %j는 missing", (ts) => {
    const sig = sign(RAW_KEY, ID, ts);
    expect(verifyStandardWebhook(input({ timestamp: ts, signatureHeader: `v1,${sig}` }))).toBe("missing");
  });

  describe("시간 허용 범위", () => {
    const at = (sec: number) => sec * 1000;

    it("toleranceSec가 없으면 시간을 보지 않는다", () => {
      expect(verifyStandardWebhook(input({ now: at(1700000000 + 10 * 365 * 86400) }))).toBe("ok");
    });

    it("범위 안(경계 포함)이면 ok", () => {
      expect(verifyStandardWebhook(input({ toleranceSec: 300, now: at(1700000000) }))).toBe("ok");
      expect(verifyStandardWebhook(input({ toleranceSec: 300, now: at(1700000300) }))).toBe("ok");
      expect(verifyStandardWebhook(input({ toleranceSec: 300, now: at(1699999700) }))).toBe("ok");
    });

    it("너무 오래됐거나 미래면 stale", () => {
      expect(verifyStandardWebhook(input({ toleranceSec: 300, now: at(1700000301) }))).toBe("stale");
      expect(verifyStandardWebhook(input({ toleranceSec: 300, now: at(1699999699) }))).toBe("stale");
    });

    it("서명이 틀리면 시간과 관계없이 bad_signature — stale은 진짜인데 늦은 요청만", () => {
      expect(verifyStandardWebhook(input({ body: "{}", toleranceSec: 300, now: at(1800000000) }))).toBe("bad_signature");
    });

    it("now를 주지 않으면 현재 시각을 쓴다", () => {
      const ts = String(Math.floor(Date.now() / 1000));
      const sig = sign(RAW_KEY, ID, ts);
      expect(verifyStandardWebhook(input({ timestamp: ts, signatureHeader: `v1,${sig}`, toleranceSec: 300 }))).toBe("ok");
      const old = String(Math.floor(Date.now() / 1000) - 3600);
      const oldSig = sign(RAW_KEY, ID, old);
      expect(verifyStandardWebhook(input({ timestamp: old, signatureHeader: `v1,${oldSig}`, toleranceSec: 300 }))).toBe("stale");
    });
  });
});

describe("standardWebhookKeys", () => {
  it("whsec_ 뒤 base64를 디코딩한 Standard 키와 문자열 전체의 UTF-8 키(Polar 옛 방식)", () => {
    const keys = standardWebhookKeys(SECRET);
    expect(keys).toHaveLength(2);
    expect(keys[0]!.equals(RAW_KEY)).toBe(true);
    expect(keys[1]!.equals(Buffer.from(SECRET, "utf8"))).toBe(true);
  });

  it("v1,whsec_ 접두도 받는다 — 옛 키에는 v1,을 빼고 whsec_는 남긴다", () => {
    const keys = standardWebhookKeys(`v1,${SECRET}`);
    expect(keys[0]!.equals(RAW_KEY)).toBe(true);
    expect(keys[1]!.equals(Buffer.from(SECRET, "utf8"))).toBe(true);
  });

  it("v1,whsec_ 시크릿으로도 서명을 검증한다", () => {
    expect(verifyStandardWebhook(input({ keys: standardWebhookKeys(`v1,${SECRET}`) }))).toBe("ok");
  });

  it("whsec_ 접두가 없으면 전체를 base64로 본다", () => {
    const keys = standardWebhookKeys(RAW_KEY.toString("base64"));
    expect(keys[0]!.equals(RAW_KEY)).toBe(true);
  });

  it("base64 부분이 비어 있으면 옛 키만", () => {
    const keys = standardWebhookKeys("whsec_");
    expect(keys).toHaveLength(1);
    expect(keys[0]!.equals(Buffer.from("whsec_", "utf8"))).toBe(true);
  });

  it("polarLegacy: false면 Standard 키만(옛 키 없음)", () => {
    const keys = standardWebhookKeys(`v1,${SECRET}`, { polarLegacy: false });
    expect(keys).toHaveLength(1);
    expect(keys[0]!.equals(RAW_KEY)).toBe(true);
    expect(standardWebhookKeys("whsec_", { polarLegacy: false })).toEqual([]);
    const legacySig = sign(Buffer.from(SECRET, "utf8"));
    expect(
      verifyStandardWebhook(input({ signatureHeader: `v1,${legacySig}`, keys: standardWebhookKeys(SECRET, { polarLegacy: false }) })),
    ).toBe("bad_signature");
  });
});
