import type { MetadataRoute } from "next";
import { KWCAG_ITEMS, kwcagSlug } from "@a11ychk/core/catalog";
import { collectListedSites } from "@/lib/directory";

const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.a11ychk.com";

/**
 * 공개(비로그인) 페이지만 노출 — 대시보드·보고서·관리자는 robots에서 차단.
 * /scan·/login은 넣지 않는다 — 크롤러는 항상 로그아웃 상태라 리다이렉트만 만난다.
 * /pricing은 요금제 시행 전이라 제외 (직접 URL 접근은 유지).
 */
const PUBLIC_PATHS: { path: string; priority: number }[] = [
  { path: "", priority: 1 },
  { path: "/about", priority: 0.8 },
  { path: "/guide", priority: 0.8 },
  { path: "/directory", priority: 0.7 },
  { path: "/impact", priority: 0.6 },
  { path: "/accessibility", priority: 0.5 },
  { path: "/notices", priority: 0.4 },
  { path: "/inquiries", priority: 0.4 },
  { path: "/sitemap", priority: 0.3 },
  { path: "/terms", priority: 0.3 },
  { path: "/privacy", priority: 0.3 },
];
const LOCALES = ["ko", "en"] as const;

/**
 * 정적 콘텐츠 갱신 기준일 — 가이드는 카탈로그가 바뀔 때만 내용이 변한다.
 * 매 요청 "지금"을 lastmod로 내보내면 구글이 신호를 통째로 무시하므로 고정값을 쓰고,
 * 카탈로그·주요 문구를 손볼 때 함께 올린다.
 */
const CONTENT_UPDATED = new Date("2026-08-03");

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  // KWCAG 33항목 상세 — 항목 단위로 찾아오는 검색을 받는 면 (유입 자산이라 우선순위 상향)
  const guideItems = KWCAG_ITEMS.map((item) => ({ path: `/guide/${kwcagSlug(item)}`, priority: 0.7 }));
  const paths = [...PUBLIC_PATHS, ...guideItems];

  const staticEntries = LOCALES.flatMap((locale) =>
    paths.map(({ path, priority }) => ({
      url: `${SITE}/${locale}${path}`,
      lastModified: CONTENT_UPDATED,
      changeFrequency: path === "" ? ("weekly" as const) : ("monthly" as const),
      priority,
      alternates: {
        // head의 hreflang(x-default 포함)과 일치해야 한다 — 어긋나면 묶음 전체가 무시될 수 있다
        languages: {
          ...Object.fromEntries(LOCALES.map((l) => [l, `${SITE}/${l}${path}`])),
          "x-default": `${SITE}/ko${path}`,
        },
      },
    })),
  );

  // 등재 사이트 요약(/directory/{host}) — UGC를 색인 자산으로. 실패 시 정적 목록만
  let siteEntries: MetadataRoute.Sitemap = [];
  try {
    const sites = await collectListedSites();
    siteEntries = LOCALES.flatMap((locale) =>
      sites.map((s) => {
        const path = `/directory/${encodeURIComponent(s.hostname)}`;
        return {
          url: `${SITE}/${locale}${path}`,
          lastModified: s.lastScannedAt ? new Date(s.lastScannedAt) : CONTENT_UPDATED,
          changeFrequency: "weekly" as const,
          priority: 0.6,
          alternates: {
            languages: {
              ...Object.fromEntries(LOCALES.map((l) => [l, `${SITE}/${l}${path}`])),
              "x-default": `${SITE}/ko${path}`,
            },
          },
        };
      }),
    );
  } catch {
    // 디렉터리 조회 실패는 sitemap 전체를 죽이지 않는다
  }

  return [...staticEntries, ...siteEntries];
}
