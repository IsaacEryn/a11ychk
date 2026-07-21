import "server-only";

/**
 * 배지·공유 링크처럼 로케일 프리픽스가 없는 진입점에서 방문자의 Accept-Language로
 * ko/en을 협상한다. (demo·site 라우트에 복붙돼 있던 것을 공용화)
 */
export function negotiateLocale(req: Request): "ko" | "en" {
  const header = req.headers.get("accept-language") ?? "";
  const first = header.split(",")[0]?.trim().toLowerCase() ?? "";
  return first.startsWith("en") ? "en" : "ko";
}
