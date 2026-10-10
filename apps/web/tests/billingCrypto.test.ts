import { describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { decryptBillingKey, encryptBillingKey, loadEncKey } from "../src/lib/billing/crypto";

const key = randomBytes(32);
const ctx = { userId: "u1", livemode: false };

describe("빌링키 암호화", () => {
  it("왕복하고 v1: 형식이다(0041 check와 같은 접두)", () => {
    const enc = encryptBillingKey("bk_123", ctx, key);
    expect(enc.startsWith("v1:")).toBe(true);
    expect(enc.split(":")).toHaveLength(4);
    expect(decryptBillingKey(enc, ctx, key)).toBe("bk_123");
  });
  it("매번 다른 암호문이 나온다(무작위 IV)", () => {
    expect(encryptBillingKey("bk", ctx, key)).not.toBe(encryptBillingKey("bk", ctx, key));
  });
  it("다른 사용자·모드의 행으로 옮기면 복호화가 실패한다(AAD)", () => {
    const enc = encryptBillingKey("bk", ctx, key);
    expect(decryptBillingKey(enc, { userId: "u2", livemode: false }, key)).toBeNull();
    expect(decryptBillingKey(enc, { userId: "u1", livemode: true }, key)).toBeNull();
  });
  it("변조·다른 키·형식 오류는 null", () => {
    const enc = encryptBillingKey("bk", ctx, key);
    const parts = enc.split(":");
    parts[3] = Buffer.from("x").toString("base64url");
    expect(decryptBillingKey(parts.join(":"), ctx, key)).toBeNull();
    expect(decryptBillingKey(enc, ctx, randomBytes(32))).toBeNull();
    expect(decryptBillingKey("v2:a:b:c", ctx, key)).toBeNull();
    expect(decryptBillingKey("plain", ctx, key)).toBeNull();
  });
  it("암호화 키는 base64 32바이트만 받는다", () => {
    expect(loadEncKey({ BILLING_KEY_ENC_KEY: key.toString("base64") })?.length).toBe(32);
    expect(loadEncKey({ BILLING_KEY_ENC_KEY: randomBytes(16).toString("base64") })).toBeNull();
    expect(loadEncKey({})).toBeNull();
  });
});

describe("빌링키 복호화 — 길이 검사", () => {
  const swap = (enc: string, i: number, value: Buffer) => {
    const parts = enc.split(":");
    parts[i] = value.toString("base64url");
    return parts.join(":");
  };

  it("인증 태그를 한 바이트라도 바꾸면 null", () => {
    const enc = encryptBillingKey("bk_123", ctx, key);
    const tag = Buffer.from(enc.split(":")[2], "base64url");
    tag[0] ^= 0x01;
    expect(decryptBillingKey(swap(enc, 2, tag), ctx, key)).toBeNull();
  });

  it("짧은 태그는 받지 않는다 — 16바이트가 아니면 null(잘린 태그로 위조 시도를 막는다)", () => {
    const enc = encryptBillingKey("bk_123", ctx, key);
    const tag = Buffer.from(enc.split(":")[2], "base64url");
    for (const n of [4, 8, 12, 15]) expect(decryptBillingKey(swap(enc, 2, tag.subarray(0, n)), ctx, key), String(n)).toBeNull();
    expect(decryptBillingKey(swap(enc, 2, Buffer.concat([tag, Buffer.from([0])])), ctx, key)).toBeNull();
  });

  it("IV가 12바이트가 아니면 null", () => {
    const enc = encryptBillingKey("bk_123", ctx, key);
    const iv = Buffer.from(enc.split(":")[1], "base64url");
    expect(decryptBillingKey(swap(enc, 1, iv.subarray(0, 8)), ctx, key)).toBeNull();
    expect(decryptBillingKey(swap(enc, 1, Buffer.concat([iv, Buffer.from([0, 0, 0, 0])])), ctx, key)).toBeNull();
  });
});
