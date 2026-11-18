import type { Viewport } from "next";
import { NextIntlClientProvider } from "next-intl";
import { getTranslations } from "next-intl/server";
import type { Locale } from "@/i18n/routing";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { ServiceStatusBanner } from "@/components/ServiceStatusBanner";
import { AnnouncementSlot } from "@/components/AnnouncementBanner";
import { bootScript, gtmBootstrapScript, gtmContainerId } from "@/lib/inlineScripts";
import { JsonLd, organizationJsonLd } from "@/components/JsonLd";
import { AuthSync } from "@/components/AuthSync";
import "@/app/globals.css";
// Pretendard 자체 호스팅 — 패키지 CSS를 import하면 Next가 woff2까지 번들 자산으로 서빙한다 (CDN 미사용)
import "pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css";
// 제목용 세리프 Hahmlet도 같은 방식으로 싣는다. next/font/google은 빌드마다 Google Fonts에서 받아 오는데,
// 그 응답이 가끔 Next가 풀지 못하는 주소 꼴로 와서 빌드가 깨졌다(vercel/next.js#99114, tests/selfHostedFonts.test.ts).
// 굵기마다 Google Fonts와 같은 unicode-range 92조각이라 쓰는 글자의 조각만 받는다. 가변 글꼴 한 벌
// (@fontsource-variable)은 파일 수가 3분의 1이지만 조각 하나가 커서, 랜딩 첫 화면 기준 전송량이 300KB에서
// 485KB로 늘어 쓰지 않았다(2026-11 측정). 쓰는 굵기를 늘리면 여기와 테스트의 목록을 함께 고친다.
import "@fontsource/hahmlet/500.css";
import "@fontsource/hahmlet/700.css";
import "@fontsource/hahmlet/800.css";

/*
 * 로케일 페이지의 문서 골격(<html lang>부터 헤더·본문·푸터까지).
 *
 * [locale]/layout.tsx와 app/global-not-found.tsx가 함께 쓴다. 없는 주소의 404는 로케일
 * 레이아웃 밖(/_not-found)에서 렌더되므로, 같은 골격을 여기 한 곳에 두지 않으면 404 화면만
 * 헤더·테마·건너뛰기 링크가 다른 화면이 된다.
 *
 * 여기서는 요청 정보(헤더·쿠키·검색어)와 DB를 읽지 않는다 — 읽는 순간 로케일 레이아웃 아래 모든 페이지가
 * 요청마다 렌더되어 정적 공개 페이지(랜딩·가이드)가 사라진다. 요청마다 달라지는 것은 클라이언트가 채운다:
 * 로그인 여부(boot 스크립트의 data-auth + AuthSync), 관리자 링크(AdminNavLink), 공지 배너(AnnouncementSlot).
 */

/**
 * 뷰포트 — 모바일 필수 기반.
 * viewport-fit=cover로 노치/홈바 안전영역(env(safe-area-inset-*)) 사용을 활성화하고,
 * themeColor를 테마별로 지정해 브라우저 UI(주소창) 색을 페이지 배경(--color-paper)과 맞춘다.
 */
export const localeViewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#faf8f3" },
    { media: "(prefers-color-scheme: dark)", color: "#14201d" },
  ],
};

/** 호출하는 쪽이 locale을 검증하고 setRequestLocale을 마친 뒤 렌더한다 */
export async function LocaleDocument({ locale, children }: { locale: Locale; children: React.ReactNode }) {
  const t = await getTranslations({ locale, namespace: "common" });
  // GTM 컨테이너 ID — 미설정이면 스니펫 자체를 렌더하지 않는다 (CSP 허용 목록도 같은 환경변수로 연다)
  const gtmId = gtmContainerId();

  return (
    // suppressHydrationWarning: boot 스크립트가 hydration 전에 data-theme·data-auth를
    // 설정하므로 html 속성 불일치 경고를 억제한다 (theme attribute 표준 패턴)
    <html lang={locale} suppressHydrationWarning>
      <body className="flex min-h-svh flex-col">
        {/* 저장된 테마와 로그인 힌트(data-auth)를 첫 페인트 전에 적용해 깜빡임을 막는다.
            nonce 없이 싣는다 — 내용이 고정이라 CSP가 해시로 허용한다(lib/inlineScripts.ts).
            body 최상단이라 파싱 시점에 즉시 실행된다. */}
        <script dangerouslySetInnerHTML={{ __html: bootScript }} />
        {/* GTM(GA4) — NEXT_PUBLIC_GTM_ID 설정 시에만 삽입(셀프호스팅 기본 미포함).
            부트스트랩은 해시로 허용되고, gtm.js·gtag.js는 동적 페이지에서는 strict-dynamic이,
            정적 페이지에서는 script-src의 googletagmanager.com 출처가 허용한다. */}
        {gtmId && (
          <>
            {/* next/script·@next/third-parties 대신 네이티브 script — 내용이 고정이어야 해시로 허용할 수 있다 */}
            <script dangerouslySetInnerHTML={{ __html: gtmBootstrapScript(gtmId) }} />
            <noscript>
              <iframe
                src={`https://www.googletagmanager.com/ns.html?id=${gtmId}`}
                height="0"
                width="0"
                style={{ display: "none", visibility: "hidden" }}
                title="Google Tag Manager"
              />
            </noscript>
          </>
        )}
        <JsonLd data={organizationJsonLd} />
        <a href="#main" className="skip-link">
          {t("skipToMain")}
        </a>
        <NextIntlClientProvider>
          <AuthSync />
          <ServiceStatusBanner />
          <AnnouncementSlot />
          <Header />
          <main id="main" tabIndex={-1} className="flex-1 focus:outline-none">
            {children}
          </main>
          <Footer />
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
