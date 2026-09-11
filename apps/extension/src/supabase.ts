/**
 * 확장이 직접 쓰는 Supabase Auth REST 엔드포인트 — 세션 교환·갱신·철회.
 * URL과 anon 키는 공개값이며 빌드 시 esbuild define으로 박힌다(build.mjs).
 * supabase-js를 번들하지 않고 fetch 세 개로 끝낸다 — 확장 번들 크기를 지킨다.
 */
declare const process: { env: { A11YCHK_SUPABASE_URL: string; A11YCHK_SUPABASE_ANON_KEY: string } };
export const SUPABASE_URL = process.env.A11YCHK_SUPABASE_URL;
export const SUPABASE_ANON_KEY = process.env.A11YCHK_SUPABASE_ANON_KEY;

export interface AuthSession {
  access_token: string;
  refresh_token: string;
  /** 초 단위 epoch */
  expires_at?: number;
  expires_in?: number;
  user?: { email?: string | null };
}

function headers(extra: Record<string, string> = {}): Record<string, string> {
  return { apikey: SUPABASE_ANON_KEY, "content-type": "application/json", ...extra };
}

/** 웹 연결 페이지가 건네준 1회용 토큰 해시를 확장 전용 세션(자체 refresh token)으로 교환 */
export async function exchangeTokenHash(tokenHash: string): Promise<AuthSession | null> {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/verify`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ type: "magiclink", token_hash: tokenHash }),
  });
  if (!res.ok) return null;
  const data = (await res.json()) as AuthSession;
  return data.access_token && data.refresh_token ? data : null;
}

/** refresh token으로 새 세션 발급 — Supabase는 refresh token을 회전시키므로 결과를 반드시 저장할 것 */
export async function refreshWithToken(refreshToken: string): Promise<AuthSession | null> {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ refresh_token: refreshToken }),
  });
  if (!res.ok) return null;
  const data = (await res.json()) as AuthSession;
  return data.access_token && data.refresh_token ? data : null;
}

/** 확장 세션 철회(연결 해제) — 서버 쪽 refresh token까지 무효화. best-effort */
export async function revokeSession(accessToken: string): Promise<void> {
  try {
    await fetch(`${SUPABASE_URL}/auth/v1/logout?scope=local`, {
      method: "POST",
      headers: headers({ authorization: `Bearer ${accessToken}` }),
    });
  } catch {
    // 네트워크 오류 — 로컬 저장소는 어차피 지운다
  }
}

/** 세션 응답 → 저장 형태의 만료 시각(ms) */
export function expiresAtMs(s: AuthSession): number {
  if (typeof s.expires_at === "number") return s.expires_at * 1000;
  return Date.now() + (s.expires_in ?? 3600) * 1000;
}
