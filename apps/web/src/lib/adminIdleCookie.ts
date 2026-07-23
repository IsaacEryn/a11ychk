/**
 * 관리자 무활동 타임아웃 쿠키 — `{unixMs}.{HMAC-SHA256 hex}` 형식의 서명 타임스탬프.
 * 발급은 post-login(AAL2 완성 시)에서만, 슬라이딩 갱신은 proxy에서 "유효한 쿠키가
 * 이미 있을 때만", 검사·강제는 requireAdmin에서 한다. 이 쿠키는 권한을 부여하지
 * 않는다 — role·AAL2는 requireAdmin이 독립 검증하고, 쿠키는 시계 역할만 한다.
 *
 * proxy(미들웨어)·route handler·RSC가 공유하므로 Web Crypto(crypto.subtle)만 사용.
 * ("server-only"는 proxy에서 import 불가라 넣지 않는다 — 시크릿은 env로만 접근)
 */

export const ADMIN_TS_COOKIE = "a11ychk_admin_ts";

export function adminIdleMinutes(): number {
  const n = Number(process.env.ADMIN_IDLE_MINUTES ?? 20);
  return Number.isFinite(n) && n > 0 ? n : 20;
}

function secret(): string {
  const s = process.env.INTERNAL_API_SECRET;
  // 로컬 개발(미설정)은 고정 키로 동작 허용 — 운영은 SETUP.md에 따라 반드시 설정
  if (!s || s === "change-me") {
    if (process.env.NODE_ENV === "production" && process.env.VERCEL) {
      throw new Error("INTERNAL_API_SECRET이 설정되지 않았습니다.");
    }
    return "dev-only-admin-ts-key";
  }
  return s;
}

async function hmacKey(): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

function toHex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function fromHex(hex: string): Uint8Array | null {
  if (!/^[0-9a-f]+$/.test(hex) || hex.length % 2 !== 0) return null;
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/** 현재 시각(또는 지정 시각)으로 서명된 쿠키 값 생성 */
export async function signAdminTs(nowMs: number = Date.now()): Promise<string> {
  const key = await hmacKey();
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(String(nowMs)));
  return `${nowMs}.${toHex(sig)}`;
}

/**
 * 쿠키 값 검증 — 서명이 유효하면 타임스탬프(ms)를, 아니면 null을 반환.
 * 만료 판정은 호출자가 adminIdleMinutes 기준으로 한다(검사·갱신 지점별 기준 분리).
 */
export async function verifyAdminTs(value: string | undefined): Promise<number | null> {
  if (!value) return null;
  const dot = value.indexOf(".");
  if (dot <= 0) return null;
  const tsStr = value.slice(0, dot);
  const ts = Number(tsStr);
  if (!Number.isFinite(ts) || ts <= 0) return null;
  const sig = fromHex(value.slice(dot + 1));
  if (!sig || sig.length !== 32) return null;
  const key = await hmacKey();
  // crypto.subtle.verify는 타이밍 안전 비교
  const ok = await crypto.subtle.verify("HMAC", key, sig as BufferSource, new TextEncoder().encode(tsStr));
  return ok ? ts : null;
}

/** 타임스탬프가 무활동 한도를 초과했는지 */
export function isIdleExpired(ts: number, nowMs: number = Date.now()): boolean {
  return nowMs - ts > adminIdleMinutes() * 60_000;
}

/** 쿠키 속성 — 발급(route handler)·갱신(proxy) 공용 */
export function adminTsCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: adminIdleMinutes() * 60,
  };
}
