import "server-only";

/**
 * Cloudflare Turnstile 서버측 검증 — 자체 엔드포인트(맛보기 검사 등)용.
 * 기존 가입/로그인 흐름은 Supabase Auth가 captchaToken을 대신 검증하지만,
 * Supabase를 거치지 않는 엔드포인트는 여기서 siteverify를 직접 호출한다.
 *
 * 동작 모드 (fail-closed):
 * - NEXT_PUBLIC_TURNSTILE_SITE_KEY 미설정(개발): 검증 스킵(ok)
 * - 사이트키 설정 + TURNSTILE_SECRET_KEY 미설정: 설정 오류(misconfigured) — 통과 금지
 * - 둘 다 설정: siteverify 결과에 따름 (네트워크 오류는 fail-closed)
 */
export type TurnstileVerdict = "ok" | "failed" | "misconfigured";

export async function verifyTurnstileToken(token: string | undefined, ip?: string): Promise<TurnstileVerdict> {
  const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
  if (!siteKey) return "ok"; // CAPTCHA 비활성 환경(로컬 개발)

  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) return "misconfigured";
  if (!token) return "failed";

  try {
    const body = new URLSearchParams({ secret, response: token });
    if (ip) body.set("remoteip", ip);
    const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
      // 검증 서버 지연이 검사 함수 예산을 잠식하지 않도록 짧게 제한
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) return "failed";
    const data = (await res.json()) as { success?: boolean };
    return data.success === true ? "ok" : "failed";
  } catch {
    return "failed"; // 네트워크 오류 — fail-closed
  }
}
