import { NextResponse } from "next/server";
import crypto from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { negotiateLocale } from "@/lib/negotiateLocale";
import { getDomainPublicScan } from "@/lib/host";
import { unstable_cache } from "next/cache";
import { getListedSiteDetail } from "@/lib/directory";

export const runtime = "nodejs";

// 디렉터리 상세 페이지와 같은 캐시 키 — 같은 호스트면 같은 항목을 함께 쓴다
const getDetail = unstable_cache(getListedSiteDetail, ["directory-site-detail"], { revalidate: 60 });

/**
 * 공개 배지·디렉터리에서 진입하는 도메인별 공개 보고서 리졸버.
 * 소유확인(verified) + 공개등재(public_listed) 도메인의 최신 완료 검사로 이동한다.
 * 최신 검사에 공유 토큰이 없으면 발급해(배지 링크가 항상 유효하도록) 보고서로 302.
 * 등재되지 않았거나 없으면 디렉터리로 보낸다.
 *
 * 디렉터리 상세(/directory/{host}) 기준을 넘는 사이트는 보고서 대신 그 요약 페이지로 보낸다.
 * 배지는 고객 사이트에 박힌 외부 링크라, 색인되지 않는 보고서로 보내면 그 링크가 검색에 아무
 * 쓸모가 없다. 요약 페이지에 전체 보고서 링크(?view=report)가 있어 사람은 한 번 더 누르면 된다.
 */

export async function GET(req: Request, { params }: { params: Promise<{ hostname: string }> }) {
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.a11ychk.com";
  const locale = negotiateLocale(req);
  const { hostname: raw } = await params;
  const hostname = decodeURIComponent(raw).toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");

  if (new URL(req.url).searchParams.get("view") !== "report") {
    const listed = await getDetail(hostname).catch(() => null);
    if (listed) {
      return NextResponse.redirect(`${siteUrl}/${locale}/directory/${encodeURIComponent(listed.hostname)}`, {
        status: 302,
      });
    }
  }

  const admin = createAdminClient();
  // 공개 등재 + 소유확인된 도메인만 (0018 미적용이면 public_listed 컬럼 부재 → 안전하게 미노출)
  const { data: domain } = await admin
    .from("domains")
    .select("id, user_id, verified, public_listed, public_scan_id")
    .eq("hostname", hostname)
    .eq("verified", true)
    .eq("public_listed", true)
    .maybeSingle()
    .then((r) => r, () => ({ data: null }));

  if (!domain) {
    return NextResponse.redirect(`${siteUrl}/${locale}/directory`, { status: 302 });
  }

  // 공개 지정 검사(있으면) 또는 www/apex 무관 최신 완료 검사
  const scan = await getDomainPublicScan<{ id: string; share_token: string | null; root_url: string | null }>(
    admin,
    { user_id: domain.user_id as string, hostname, public_scan_id: domain.public_scan_id as string | null },
    "id, share_token, root_url",
  );

  if (!scan) {
    return NextResponse.redirect(`${siteUrl}/${locale}/directory`, { status: 302 });
  }

  let token = scan.share_token as string | null;
  if (!token) {
    token = crypto.randomBytes(32).toString("hex");
    await admin.from("scans").update({ share_token: token }).eq("id", scan.id);
  }

  return NextResponse.redirect(
    `${siteUrl}/${locale}/scans/${scan.id}/report?token=${token}`,
    { status: 302 },
  );
}
