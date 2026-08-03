/**
 * 딥링크(?url=) 프리필 값 정리 — 폼 초기값으로만 쓰고 서버에서 fetch하지 않으므로
 * SSRF 가드 대상이 아니다. http/https 절대 URL만 통과시키고 나머지는 버린다
 * (javascript: 등 스킴 주입, 비정상 길이 차단).
 */
export function sanitizePrefillUrl(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > 2048) return null;
  try {
    const u = new URL(raw);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return u.toString();
  } catch {
    return null;
  }
}
