import "server-only";

/**
 * 배지·공유 링크처럼 로케일 프리픽스가 없는 진입점에서 ko/en을 정한다.
 * (demo·site·join 라우트에 복붙돼 있던 것을 공용화)
 *
 * `?lang=ko|en`이 있으면 그것이 우선이다 — 로케일 페이지 안의 링크(예: /ko 랜딩의 예시 보고서)는
 * 방문자가 이미 고른 언어를 넘겨야 한다. Accept-Language만 보면 영어 브라우저로 /ko를 보던 사람이
 * 영어 보고서로 떨어진다. 없으면 Accept-Language의 첫 언어로 협상한다.
 */
export function negotiateLocale(req: Request): "ko" | "en" {
  const lang = new URL(req.url).searchParams.get("lang");
  if (lang === "ko" || lang === "en") return lang;
  const header = req.headers.get("accept-language") ?? "";
  const first = header.split(",")[0]?.trim().toLowerCase() ?? "";
  return first.startsWith("en") ? "en" : "ko";
}
