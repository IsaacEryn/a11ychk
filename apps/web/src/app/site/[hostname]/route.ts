import { NextResponse } from "next/server";
import crypto from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

/**
 * 공개 배지·디렉터리에서 진입하는 도메인별 공개 보고서 리졸버.
 * 소유확인(verified) + 공개등재(public_listed) 도메인의 최신 완료 검사로 이동한다.
 * 최신 검사에 공유 토큰이 없으면 발급해(배지 링크가 항상 유효하도록) 보고서로 302.
 * 등재되지 않았거나 없으면 디렉터리로 보낸다.
 */
/** 배지·디렉터리 링크는 로케일이 없으므로 방문자의 Accept-Language로 ko/en을 협상한다. */
function negotiateLocale(req: Request): "ko" | "en" {
  const header = req.headers.get("accept-language") ?? "";
  const first = header.split(",")[0]?.trim().toLowerCase() ?? "";
  return first.startsWith("en") ? "en" : "ko";
}

export async function GET(req: Request, { params }: { params: Promise<{ hostname: string }> }) {
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.a11ychk.com";
  const locale = negotiateLocale(req);
  const { hostname: raw } = await params;
  const hostname = decodeURIComponent(raw).toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");

  const admin = createAdminClient();
  // 공개 등재 + 소유확인된 도메인만 (0018 미적용이면 public_listed 컬럼 부재 → 안전하게 미노출)
  const { data: domain } = await admin
    .from("domains")
    .select("id, verified, public_listed")
    .eq("hostname", hostname)
    .eq("verified", true)
    .eq("public_listed", true)
    .maybeSingle()
    .then((r) => r, () => ({ data: null }));

  if (!domain) {
    return NextResponse.redirect(`${siteUrl}/${locale}/directory`, { status: 302 });
  }

  const { data: scan } = await admin
    .from("scans")
    .select("id, share_token")
    .eq("domain_id", domain.id)
    .eq("status", "done")
    .order("finished_at", { ascending: false })
    .limit(1)
    .maybeSingle();

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
