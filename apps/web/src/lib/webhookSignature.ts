import "server-only";
import crypto from "node:crypto";

/**
 * Standard Webhooks 서명 검증(https://www.standardwebhooks.com) — Supabase Auth 훅과 Polar 웹훅이 같이 쓴다.
 * 헤더: webhook-id, webhook-timestamp(unix 초), webhook-signature("v1,<base64>"를 공백으로 여러 개).
 * 서명 대상은 `${id}.${timestamp}.${rawBody}`, HMAC-SHA256.
 */
export type WebhookVerifyResult = "ok" | "bad_signature" | "stale" | "missing";

export interface StandardWebhookInput {
  id: string | null | undefined;
  timestamp: string | null | undefined;
  signatureHeader: string | null | undefined;
  /** 받은 그대로의 본문 — 파싱했다 다시 직렬화하면 서명이 맞지 않는다 */
  body: string;
  keys: Buffer[];
  /** |now − timestamp| 허용 초. 없으면 시간을 보지 않는다. 유한한 수가 아니면(NaN·Infinity) 늘 stale */
  toleranceSec?: number;
  /** 현재 시각(ms) */
  now?: number;
}

/**
 * 순서: 헤더 확인(missing) → 서명(bad_signature) → 시간(stale).
 * 서명을 먼저 보므로 stale은 "진짜인데 늦게 온 요청"(재전송 공격·시계 어긋남)만 뜻한다.
 * 길이 0인 키는 버린다 — 빈 키의 HMAC은 시크릿 없이 누구나 만들 수 있다.
 */
export function verifyStandardWebhook(input: StandardWebhookInput): WebhookVerifyResult {
  const { id, timestamp, signatureHeader, body, keys } = input;
  if (!id || !timestamp || !signatureHeader || !/^\d+$/.test(timestamp)) return "missing";

  const signed = `${id}.${timestamp}.${body}`;
  const expected = keys
    .filter((key) => key.length > 0)
    .map((key) => Buffer.from(crypto.createHmac("sha256", key).update(signed).digest("base64")));
  const received = signatureHeader
    .split(/\s+/)
    .filter((part) => part.startsWith("v1,"))
    .map((part) => Buffer.from(part.slice(3)));
  const matched = received.some((sig) => expected.some((exp) => safeEqual(sig, exp)));
  if (!matched) return "bad_signature";

  if (input.toleranceSec !== undefined) {
    // 잘못된 허용 범위는 닫힌 쪽으로 — NaN은 어떤 비교도 거짓이라 그대로 두면 통과해 버린다
    if (!Number.isFinite(input.toleranceSec)) return "stale";
    const nowSec = (input.now ?? Date.now()) / 1000;
    if (!(Math.abs(nowSec - Number(timestamp)) <= input.toleranceSec)) return "stale";
  }
  return "ok";
}

/** 길이가 다르면 false — timingSafeEqual은 길이가 다르면 예외를 던진다 */
function safeEqual(a: Buffer, b: Buffer): boolean {
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/**
 * 시크릿("whsec_<base64>" 또는 "v1,whsec_<base64>")에서 검증 키를 만든다.
 * - Standard 키: whsec_ 뒤 base64를 디코딩한 바이트(Supabase, 최근에 만든 Polar 시크릿).
 * - Polar 옛 키: v1,만 뗀 "whsec_…" 문자열 전체의 UTF-8 바이트(Polar가 Standard 방식으로 바꾸기 전에 만든 시크릿).
 * 둘 다 같은 시크릿을 알아야 만들 수 있어 키를 하나 더 받아도 검증이 약해지지 않는다.
 * polarLegacy: false면 Standard 키만 — Polar가 아닌 발신자(Supabase 훅)는 옛 방식을 쓰지 않는다.
 * 접두를 떼고 남는 게 없으면(""·"v1,"·"whsec_"·"v1,whsec_") 키가 없다 — 누구나 아는 값이라 키로 쓰지 않는다.
 */
export function standardWebhookKeys(secret: string, opts: { polarLegacy?: boolean } = {}): Buffer[] {
  const withoutVersion = secret.replace(/^v1,/, "");
  const encoded = withoutVersion.replace(/^whsec_/, "");
  if (encoded.length === 0) return [];
  const standard = Buffer.from(encoded, "base64");
  const keys = standard.length > 0 ? [standard] : [];
  if (opts.polarLegacy !== false) keys.push(Buffer.from(withoutVersion, "utf8"));
  return keys;
}
