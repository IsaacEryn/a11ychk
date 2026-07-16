import type { MetadataRoute } from "next";

const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.a11ychk.com";

/** 공개(비로그인) 페이지만 노출 — 대시보드·보고서·관리자는 robots에서 차단 */
const PUBLIC_PATHS = ["", "/about", "/guide", "/impact", "/scan", "/accessibility", "/terms", "/privacy", "/login"];
const LOCALES = ["ko", "en"] as const;

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  return LOCALES.flatMap((locale) =>
    PUBLIC_PATHS.map((path) => ({
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
