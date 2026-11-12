import type { Metadata, Viewport } from "next";
import { notFound } from "next/navigation";
import { NextIntlClientProvider, hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { routing } from "@/i18n/routing";
import { Hahmlet } from "next/font/google";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { ServiceStatusBanner } from "@/components/ServiceStatusBanner";
import { AnnouncementSlot } from "@/components/AnnouncementBanner";
import { bootScript, gtmBootstrapScript, gtmContainerId } from "@/lib/inlineScripts";
import { JsonLd, organizationJsonLd } from "@/components/JsonLd";
import { AuthSync } from "@/components/AuthSync";
import { socialMetadata } from "@/lib/seo/pageMetadata";
import "../globals.css";
// Pretendard 자체 호스팅 — 패키지 CSS를 import하면 Next가 woff2까지 번들 자산으로 서빙한다 (CDN 미사용)
import "pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css";

// 제목용 세리프 — next/font가 빌드 시 받아 자체 호스팅한다 (구글 CDN 런타임 요청 없음).
// 한글 폰트는 preload 대상 서브셋 지정이 불가해 preload: false (unicode-range 지연 로드).
const hahmlet = Hahmlet({
  weight: ["500", "700", "800"],
  display: "swap",
  preload: false,
  variable: "--font-hahmlet",
});

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

/**
 * 뷰포트 — 모바일 필수 기반.
 * viewport-fit=cover로 노치/홈바 안전영역(env(safe-area-inset-*)) 사용을 활성화하고,
 * themeColor를 테마별로 지정해 브라우저 UI(주소창) 색을 페이지 배경(--color-paper)과 맞춘다.
 */
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#faf8f3" },
    { media: "(prefers-color-scheme: dark)", color: "#14201d" },
  ],
};

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "common" });
  // 브랜드명만으로는 검색에서 찾히지 않는다 — 사람들이 실제로 넣는 말을 앞에 둔다
  const title = t("seoTitle");
  const description = t("seoDescription");
  return {
    title: {
      default: title,
      template: `%s — ${t("appName")}`,
    },
    description,
    metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"),
    // 사이트 소유확인 — env 설정 시에만 메타태그 삽입(셀프호스팅·포크 기본 미포함).
    // 네이버 서치어드바이저는 파일 대신 메타태그 방식으로 확인.
    verification: process.env.NAVER_SITE_VERIFICATION
      ? { other: { "naver-site-verification": process.env.NAVER_SITE_VERIFICATION } }
      : undefined,
    // 아이콘은 파일 컨벤션(app/icon.svg, apple-icon.png)이 자동 주입.
    // 공유 카드는 페이지가 publicMetadata로 자기 값을 채운다 — 여기 값은 그걸 안 쓰는
    // 페이지(로그인 뒤 화면 등)의 기본값. OG 이미지는 루트 세그먼트 파일이 [locale] 하위에
    // 전파되지 않아 명시 지정한다.
    ...socialMetadata(locale, { title, description }),
  };
}

/**
 * 이 레이아웃은 요청 정보(헤더·쿠키·검색어)와 DB를 읽지 않는다 — 읽는 순간 그 아래 모든 페이지가 요청마다
 * 렌더되어 정적 공개 페이지(랜딩·가이드)가 사라진다. 요청마다 달라지는 것은 클라이언트가 채운다:
 * 로그인 여부(boot 스크립트의 data-auth + AuthSync), 관리자 링크(AdminNavLink), 공지 배너(AnnouncementSlot).
 */
export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) {
    notFound();
  }
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: "common" });
  // GTM 컨테이너 ID — 미설정이면 스니펫 자체를 렌더하지 않는다 (CSP 허용 목록도 같은 환경변수로 연다)
  const gtmId = gtmContainerId();

  return (
    // suppressHydrationWarning: boot 스크립트가 hydration 전에 data-theme·data-auth를
    // 설정하므로 html 속성 불일치 경고를 억제한다 (theme attribute 표준 패턴)
    <html lang={locale} suppressHydrationWarning className={hahmlet.variable}>
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
