import "server-only";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * 토스 빌링키 암호화 — DB(백업·SQL Editor·대시보드)만 유출되는 경우를 막는 심층 방어다.
 * 형식 "v1:<iv>:<tag>:<ct>"(base64url) — 0041의 check가 v1: 접두만 받는다.
 * AAD를 user_id|모드로 묶어 암호문을 다른 행으로 옮기면 복호화가 실패한다.
 */
const VERSION = "v1";
/** IV·인증 태그 길이 — 암호화가 만드는 길이 그대로이고, 복호화는 다른 길이를 받지 않는다 */
const IV_BYTES = 12;
const TAG_BYTES = 16;

export function loadEncKey(env: Record<string, string | undefined> = process.env): Buffer | null {
  const raw = env.BILLING_KEY_ENC_KEY?.trim();
  if (!raw) return null;
  const key = Buffer.from(raw, "base64");
  return key.length === 32 ? key : null;
}

const aad = (ctx: { userId: string; livemode: boolean }) =>
  Buffer.from(`${ctx.userId}|${ctx.livemode ? "live" : "test"}`, "utf8");

export function encryptBillingKey(plain: string, ctx: { userId: string; livemode: boolean }, key: Buffer): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv, { authTagLength: TAG_BYTES });
  cipher.setAAD(aad(ctx));
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return [VERSION, iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), ct.toString("base64url")].join(":");
}

/**
 * 복호화 — 형식·길이가 맞지 않거나 인증이 실패하면 null. GCM은 짧은 인증 태그도 받아 주므로(위조가 쉬워진다)
 * 태그 길이를 16바이트로 고정하고, IV·태그 길이를 먼저 검사한다.
 */
export function decryptBillingKey(enc: string, ctx: { userId: string; livemode: boolean }, key: Buffer): string | null {
  const parts = enc.split(":");
  if (parts.length !== 4 || parts[0] !== VERSION) return null;
  const iv = Buffer.from(parts[1], "base64url");
  const tag = Buffer.from(parts[2], "base64url");
  if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) return null;
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, iv, { authTagLength: TAG_BYTES });
    decipher.setAAD(aad(ctx));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(Buffer.from(parts[3], "base64url")), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}
