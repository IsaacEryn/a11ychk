import { defineRouting } from "next-intl/routing";

export const routing = defineRouting({
  locales: ["ko", "en"],
  defaultLocale: "ko",
});

export type Locale = (typeof routing.locales)[number];

/**
 * 경로의 첫 세그먼트에서 로케일을 읽는다 — 없으면 기본 로케일.
 *
 * 세그먼트 경계를 지키는 것이 중요하다. `startsWith("/en")`으로 판정하면
 * `/enterprise` 같은 경로가 영어로 잡힌다. 로케일 목록도 routing에서 가져와
 * 로케일이 추가될 때 한 곳만 고치면 되게 한다.
 */
export function localeFromPathname(pathname: string): Locale {
  const first = pathname.split("/")[1];
  return routing.locales.find((l) => l === first) ?? routing.defaultLocale;
}
