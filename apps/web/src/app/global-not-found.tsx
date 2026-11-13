import type { Metadata } from "next";
import { headers } from "next/headers";
import { hasLocale } from "next-intl";
import { getLocale, getTranslations, setRequestLocale } from "next-intl/server";
import { routing } from "@/i18n/routing";
import { LocaleDocument, localeViewport } from "@/components/LocaleDocument";
import { NotFoundContent } from "@/components/NotFoundContent";
import RootNotFound from "./not-found";

/*
 * 어느 라우트에도 맞지 않는 주소의 404 — 오타 URL과, 프록시가 숨긴 관리자 경로를 돌려보내는
 * /{locale}/__404__가 여기로 온다(next.config의 experimental.globalNotFound).
 *
 * 예전에는 [locale]/[...rest] catch-all이 notFound()를 던져 로케일 레이아웃 안에서 404를
 * 그렸다. 그런데 이 앱은 nonce 때문에 모든 페이지가 동적 렌더이고, Next 16의 동적 렌더는
 * 렌더 중에 던진 notFound()를 서버에서 잡지 못한다. 서버 HTML은 lang도 본문도 없는
 * <html id="__next_error__"> 껍데기로 나가고 화면은 브라우저가 JS로 다시 그렸다
 * (그때 제목도 홈 제목으로 바뀌었다). 라우트가 없는 주소는 Next가 /_not-found를 페이지로
 * 렌더하므로 던지는 일 없이 서버에서 완성된 문서가 404 상태로 나간다.
 *
 * 로케일은 next-intl 미들웨어가 넣은 요청 헤더에서 읽는다. 프록시를 거치지 않은 주소(/api·
 * /auth 아래 등)는 로케일도 nonce도 없으므로 DB를 읽지 않는 이중 언어 화면으로 끝낸다.
 *
 * 숨긴 관리자 경로는 오타 URL과 상태코드·본문·헤더가 같아야 한다. 여기서 요청 경로를
 * 화면에 쓰면 그 대칭이 깨진다(test:routes가 두 응답을 비교한다).
 */

export const viewport = localeViewport;

/** 프록시(src/proxy.ts)를 거친 요청인지 — 거쳤으면 nonce와 로케일 헤더가 붙어 있다 */
async function viaProxy() {
  return !!(await headers()).get("x-nonce");
}

export async function generateMetadata(): Promise<Metadata> {
  // 루트의 opengraph-image 같은 파일 컨벤션 주소를 절대 URL로 풀 기준 — 로케일 레이아웃과 같은 값
  const metadataBase = new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000");
  if (!(await viaProxy())) {
    return { metadataBase, title: "페이지를 찾을 수 없습니다 · Page not found — A11y Check" };
  }
  const locale = await getLocale();
  const [t, common] = await Promise.all([
    getTranslations({ locale, namespace: "errors" }),
    getTranslations({ locale, namespace: "common" }),
  ]);
  // 로케일 레이아웃의 제목 템플릿(%s — 앱 이름)이 여기엔 없어 직접 붙인다
  return { metadataBase, title: `${t("notFoundTitle")} — ${common("appName")}`, description: t("notFoundDesc") };
}

export default async function GlobalNotFound() {
  if (!(await viaProxy())) {
    return (
      <html lang="ko">
        <body>
          <RootNotFound />
        </body>
      </html>
    );
  }
  const requested = await getLocale();
  const locale = hasLocale(routing.locales, requested) ? requested : routing.defaultLocale;
  setRequestLocale(locale);
  return (
    <LocaleDocument locale={locale}>
      <NotFoundContent />
    </LocaleDocument>
  );
}
