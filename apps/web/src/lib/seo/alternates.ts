import type { Metadata } from "next";
import { routing } from "@/i18n/routing";

/**
 * 공개 페이지의 canonical + hreflang.
 *
 * 같은 내용을 /ko와 /en 두 주소로 내보내고 있어, 검색엔진에 어느 쪽이 정본이고
 * 서로 어떤 언어 짝인지 알려주지 않으면 중복 문서로 취급될 수 있다. sitemap에는
 * alternates가 있었지만 head에는 없었다.
 *
 * 경로는 상대값으로 둔다 — layout의 metadataBase가 절대 URL로 풀어 준다.
 *
 * @param path 로케일 접두어를 뺀 경로. 홈이면 빈 문자열, 그 외에는 "/about"처럼 슬래시로 시작.
 */
export function localeAlternates(locale: string, path = ""): Metadata["alternates"] {
  const languages: Record<string, string> = {};
  for (const l of routing.locales) languages[l] = `/${l}${path}`;
  // 언어 매칭이 안 되는 방문자에게 보여 줄 기본판
  languages["x-default"] = `/${routing.defaultLocale}${path}`;
  return { canonical: `/${locale}${path}`, languages };
}
