import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { NextIntlClientProvider, hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { routing } from "@/i18n/routing";
import Script from "next/script";
import { Header } from "@/components/Header";
import { Footer } from "@/components/Footer";
import { themeInitScript } from "@/components/ThemeToggle";
import "../globals.css";

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

  return (
    // suppressHydrationWarning: 테마 초기화 스크립트가 hydration 전에 data-theme를
    // 설정하므로 html 속성 불일치 경고를 억제한다 (theme attribute 표준 패턴)
    <html lang={locale} suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://cdn.jsdelivr.net" crossOrigin="anonymous" />
        <link
          rel="stylesheet"
          href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css"
        />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Hahmlet:wght@500;700;800&display=swap"
        />
      </head>
      <body className="flex min-h-svh flex-col">
        {/* 저장된 테마를 렌더 전에 적용해 깜빡임(FOUC) 방지 */}
        <Script id="theme-init" strategy="beforeInteractive">
          {themeInitScript}
        </Script>
        <a href="#main" className="skip-link">
          {t("skipToMain")}
        </a>
        <NextIntlClientProvider>
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
