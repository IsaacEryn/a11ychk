import type { MetadataRoute } from "next";

const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.a11ychk.com";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        // 개인 데이터·인증 흐름·API는 색인 제외
        disallow: ["/api/", "/ko/dashboard", "/en/dashboard", "/ko/scans/", "/en/scans/", "/ko/admin", "/en/admin", "/ko/mypage", "/en/mypage", "/auth/"],
      },
    ],
    sitemap: `${SITE}/sitemap.xml`,
  };
}
