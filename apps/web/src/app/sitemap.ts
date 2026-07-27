import type { MetadataRoute } from "next";
import { KWCAG_ITEMS, kwcagSlug } from "@a11ychk/core/catalog";

const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.a11ychk.com";

/** 공개(비로그인) 페이지만 노출 — 대시보드·보고서·관리자는 robots에서 차단 */
// /pricing은 요금제 시행 전이라 검색·푸터 노출에서 제외 (직접 URL 접근은 유지)
const PUBLIC_PATHS = ["", "/about", "/guide", "/impact", "/directory", "/scan", "/accessibility", "/notices", "/terms", "/privacy", "/login"];
const LOCALES = ["ko", "en"] as const;

// `/site/{hostname}` 리졸버는 여기 넣지 않는다. 302로 보고서로 넘기는데 그 목적지가
// robots.txt에서 막혀 있어, 색인될 수 없는 주소를 색인해 달라고 내미는 꼴이었다.
// 등재 도메인이 늘면 리졸버 대신 색인 가능한 요약 페이지를 만들어 넣는 게 맞다.

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  // KWCAG 33항목 상세 — 항목 단위로 찾아오는 검색을 받는 면
  const guideItems = KWCAG_ITEMS.map((item) => `/guide/${kwcagSlug(item)}`);
  const paths = [...PUBLIC_PATHS, ...guideItems];

  return LOCALES.flatMap((locale) =>
    paths.map((path) => ({
      url: `${SITE}/${locale}${path}`,
      lastModified: now,
      changeFrequency: path === "" ? ("weekly" as const) : ("monthly" as const),
      priority: path === "" ? 1 : path === "/scan" || path === "/about" ? 0.8 : 0.5,
      alternates: {
        languages: Object.fromEntries(LOCALES.map((l) => [l, `${SITE}/${l}${path}`])),
      },
    })),
  );
}
