import "server-only";

/**
 * Cloudflare Turnstile 서버측 검증 — 자체 엔드포인트(맛보기 검사 등)용.
 * 기존 가입/로그인 흐름은 Supabase Auth가 captchaToken을 대신 검증하지만,
 * Supabase를 거치지 않는 엔드포인트는 여기서 siteverify를 직접 호출한다.
 *
 * 동작 모드:
 * - 키 두 개 모두 설정: siteverify 결과에 따름 (네트워크 오류는 fail-closed)
 * - 키가 빠졌는데 개발 환경: 검증 스킵(ok) — 로컬에서 CAPTCHA 없이 개발하기 위함
 * - 키가 빠졌는데 배포본: 설정 오류(misconfigured) — 통과시키지 않는다
 * - TURNSTILE_DISABLED=1: 명시적 비활성(ok) — CAPTCHA 없이 운영하겠다고 선언한 경우
 *
 * 예전에는 사이트키가 없으면 배포본에서도 조용히 ok를 돌려줬다. 그 경로로 배포되면
 * 위젯도 안 뜨고 siteverify도 안 불리는데 요청은 전부 통과한다 — 화면상 아무 증상이
 * 없어서 알아채기 어렵다. 설정 누락은 삼키지 말고 503으로 드러낸다.
 */
export type TurnstileVerdict = "ok" | "failed" | "misconfigured";

/** CAPTCHA 없이 운영하겠다는 명시적 선언 — 셀프호스팅 등 */
function explicitlyDisabled(): boolean {
  return process.env.TURNSTILE_DISABLED === "1";
}

export async function verifyTurnstileToken(token: string | undefined, ip?: string): Promise<TurnstileVerdict> {
  const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
  const secret = process.env.TURNSTILE_SECRET_KEY;

  // 사이트키만 있고 시크릿이 없으면 검증할 수단이 없고, 시크릿만 있으면 위젯이 렌더되지
  // 않아 클라이언트가 토큰을 만들 수 없다. 어느 쪽이든 설정이 덜 된 상태다.
  if (!siteKey || !secret) {
    if (explicitlyDisabled()) return "ok";
    if (process.env.NODE_ENV !== "production") return "ok";
    return "misconfigured";
  }
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
