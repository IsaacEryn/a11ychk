import type { MetadataRoute } from "next";
import { createAdminClient } from "@/lib/supabase/admin";

const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.a11ychk.com";

/** 공개(비로그인) 페이지만 노출 — 대시보드·보고서·관리자는 robots에서 차단 */
const PUBLIC_PATHS = ["", "/about", "/guide", "/pricing", "/impact", "/directory", "/scan", "/accessibility", "/terms", "/privacy", "/login"];
const LOCALES = ["ko", "en"] as const;

/** 공개 등재된 도메인의 사이트 리졸버(`/site/{hostname}`)를 sitemap에 포함 — 롱테일 유입면. */
async function listedSitePaths(): Promise<string[]> {
  try {
    const admin = createAdminClient();
    const { data } = await admin
      .from("domains")
      .select("hostname")
      .eq("verified", true)
      .eq("public_listed", true)
      .then((r) => r, () => ({ data: null }));
    return (data ?? []).map((d: { hostname: string }) => d.hostname);
  } catch {
    return [];
  }
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date();
  const localized = LOCALES.flatMap((locale) =>
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

  // 로케일 무관 사이트 리졸버 — 방문자 언어로 302하므로 언어별 alternates 없이 1건씩.
  const sites = (await listedSitePaths()).map((hostname) => ({
    url: `${SITE}/site/${encodeURIComponent(hostname)}`,
    lastModified: now,
    changeFrequency: "weekly" as const,
    priority: 0.6,
  }));

  return [...localized, ...sites];
}
