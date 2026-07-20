import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { NextIntlClientProvider, hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { routing } from "@/i18n/routing";
import { Hahmlet } from "next/font/google";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { ServiceStatusBanner } from "@/components/ServiceStatusBanner";
import { themeInitScript } from "@/components/ThemeToggle";
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

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "common" });
  const title = `${t("appName")} — 웹 접근성 점검`;
  return {
    title: {
      default: title,
      template: `%s — ${t("appName")}`,
    },
    description: t("footer.tagline"),
    metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"),
    // 아이콘은 파일 컨벤션(app/icon.svg, apple-icon.png)이 자동 주입.
    // OG 이미지는 루트 세그먼트 파일이 [locale] 하위에 전파되지 않아 명시 지정.
    openGraph: {
      type: "website",
      siteName: t("appName"),
      title,
      description: t("footer.tagline"),
      locale: locale === "ko" ? "ko_KR" : "en_US",
      images: [{ url: "/opengraph-image.png", width: 1200, height: 630, alt: title }],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description: t("footer.tagline"),
      images: ["/opengraph-image.png"],
    },
  };
}

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
  // CSP nonce — 미들웨어가 요청마다 발급 (headers() 사용으로 전 페이지 동적 렌더가 되지만,
  // nonce 기반 CSP는 요청별 값이 필수라 정적 프리렌더와 양립할 수 없다)
  const nonce = (await headers()).get("x-nonce") ?? undefined;

  return (
    // suppressHydrationWarning: 테마 초기화 스크립트가 hydration 전에 data-theme를
    // 설정하므로 html 속성 불일치 경고를 억제한다 (theme attribute 표준 패턴)
    <html lang={locale} suppressHydrationWarning className={hahmlet.variable}>
      <body className="flex min-h-svh flex-col">
        {/* 저장된 테마를 렌더 전에 적용해 깜빡임(FOUC) 방지.
            네이티브 <script>로 렌더 — React 19는 nonce를 클라이언트에 반영하지 않아
            (브라우저가 nonce를 지워도) hydration 불일치가 없다. suppressHydrationWarning은
            방어적. body 최상단이라 파싱 시점에 즉시 실행돼 FOUC 없음. */}
        <script
          nonce={nonce}
          suppressHydrationWarning
          dangerouslySetInnerHTML={{ __html: themeInitScript }}
        />
        <a href="#main" className="skip-link">
          {t("skipToMain")}
        </a>
        <NextIntlClientProvider>
          <ServiceStatusBanner />
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
