/**
 * open redirect 방지 — 내부 경로만 허용.
 * "/path"는 통과, "//evil.com"(protocol-relative)·절대 URL·빈 값은 fallback.
 */
export function sanitizeNextPath(raw: string | null | undefined, fallback = "/ko/dashboard"): string {
  const value = raw ?? "";
  // 백슬래시는 브라우저가 슬래시로 정규화하므로("/\evil.com" → "//evil.com") 함께 차단
  if (value.startsWith("/") && !value.startsWith("//") && !value.startsWith("/\\")) return value;
  return fallback;
}
