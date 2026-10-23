import type { Metadata } from "next";
import { routing } from "@/i18n/routing";
import { localeAlternates } from "./alternates";

/** layout의 제목 템플릿("%s — A11y Check")과 같은 조합 — og:title을 템플릿 결과와 맞추는 데 쓴다 */
export const SITE_NAME = "A11y Check";
const TITLE_SEPARATOR = " — ";

const OG_LOCALE: Record<string, string> = { ko: "ko_KR", en: "en_US" };

/**
 * 로케일별 공유 이미지. 한국어판은 디자이너 원본(app/opengraph-image.png)이고,
 * 영문판(public/opengraph-image-en.png)은 같은 원본에서 부제 한 줄만 영어로 바꾼 것이다.
 */
export function ogImage(locale: string) {
  return locale === "en"
    ? { url: "/opengraph-image-en.png", alt: `${SITE_NAME} — Web Accessibility Checker` }
    : { url: "/opengraph-image.png", alt: `${SITE_NAME} — 웹 접근성 점검 도구` };
}

/**
 * Open Graph·트위터 카드.
 *
 * Next는 메타데이터를 키 단위로 얕게 병합한다. 페이지가 openGraph를 아예 안 쓰면 layout의
 * 값(홈 제목·설명)을 통째로 물려받고, 일부만 쓰면 나머지(이미지·사이트명)가 사라진다.
 * 그래서 공유 카드는 항상 이 함수로 한 벌을 다 채운다.
 */
export function socialMetadata(
  locale: string,
  { title, description, url }: { title: string; description: string; url?: string },
): Pick<Metadata, "openGraph" | "twitter"> {
  const image = ogImage(locale);
  return {
    openGraph: {
      type: "website",
      siteName: SITE_NAME,
      title,
      description,
      url,
      locale: OG_LOCALE[locale] ?? OG_LOCALE.ko,
      alternateLocale: routing.locales.filter((l) => l !== locale).map((l) => OG_LOCALE[l]),
      images: [{ url: image.url, width: 1200, height: 630, alt: image.alt }],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [{ url: image.url, alt: image.alt }],
    },
  };
}

/**
 * 색인 대상 공개 페이지의 메타데이터 한 벌 — 제목·설명·canonical·hreflang·공유 카드(og:url 포함).
 *
 * @param path 로케일 접두어를 뺀 경로(홈은 ""). localeAlternates와 같은 규칙.
 * @param absolute true면 layout 템플릿을 태우지 않는다 — 제목에 이미 브랜드가 들어 있을 때.
 */
export function publicMetadata({
  locale,
  path,
  title,
  description,
  absolute = false,
}: {
  locale: string;
  path: string;
  title: string;
  description: string;
  absolute?: boolean;
}): Metadata {
  return {
    title: absolute ? { absolute: title } : title,
    description,
    alternates: localeAlternates(locale, path),
    ...socialMetadata(locale, {
      title: absolute ? title : `${title}${TITLE_SEPARATOR}${SITE_NAME}`,
      description,
      url: `/${locale}${path}`,
    }),
  };
}

/**
 * 설명문을 검색 결과 스니펫 길이에 맞춘다 — 문장 경계에서 끊고, 첫 문장부터 너무 길면 말줄임.
 * 한국어는 글자당 폭이 넓어 상한을 낮게 잡는다.
 */
export function clampDescription(text: string, locale: string) {
  const max = locale === "en" ? 160 : 120;
  const t = text.trim();
  if (t.length <= max) return t;
  const sentences = t.split(/(?<=[.!?])\s+/);
  let out = "";
  for (const s of sentences) {
    const next = out ? `${out} ${s}` : s;
    if (next.length > max) break;
    out = next;
  }
  if (out) return out;
  // 첫 문장부터 넘치면 단어 경계에서 자른다 — "4.5:1" 같은 수치가 반쯤 잘려 뜻이 바뀌지 않게
  const cut = t.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > max / 2 ? cut.slice(0, space) : cut).replace(/[\s,;:·—-]+$/, "")}…`;
}
