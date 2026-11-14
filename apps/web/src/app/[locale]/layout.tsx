import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { routing } from "@/i18n/routing";
import { LocaleDocument, localeViewport } from "@/components/LocaleDocument";
import { socialMetadata } from "@/lib/seo/pageMetadata";

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

// 문서 골격·뷰포트는 global-not-found와 함께 쓰려고 LocaleDocument에 둔다
export const viewport = localeViewport;

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
 * 렌더되어 정적 공개 페이지(랜딩·가이드)가 사라진다. 문서 골격(LocaleDocument)도 같은 규칙을 따른다.
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
  return <LocaleDocument locale={locale}>{children}</LocaleDocument>;
}
