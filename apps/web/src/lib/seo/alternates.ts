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
  // x-default는 로케일 접두어 없는 주소 — 방문자 언어를 보고 알아서 보내 주는 자리라
  // "언어가 안 맞는 사람에게 줄 페이지"라는 x-default의 뜻에 정확히 맞는다.
  //
  // 값을 마음대로 정하면 안 된다: next-intl 미들웨어가 이미 같은 내용을 Link 헤더로
  // 내보내고 있어서, head와 헤더가 서로 다른 x-default를 말하면 구글이 hreflang 묶음
  // 전체를 무시할 수 있다. 헤더 쪽과 같은 주소를 쓴다.
  languages["x-default"] = path || "/";
  return { canonical: `/${locale}${path}`, languages };
}
