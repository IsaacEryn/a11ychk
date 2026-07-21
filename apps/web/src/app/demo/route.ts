import { NextResponse } from "next/server";
import crypto from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { negotiateLocale } from "@/lib/negotiateLocale";

export const runtime = "nodejs";


/**
 * 랜딩의 "실제 예시 보고서" — 자체 검사(a11ychk.com) 데모를 **비로그인 사용자도** 볼 수 있게
 * 공유 링크(읽기 전용)로 연결한다. NEXT_PUBLIC_DEMO_REPORT_URL에서 scan id를 뽑아 공유 토큰을
 * 보장(없으면 즉시 발급)하고 보고서로 302 리다이렉트한다.
 *
 * 왜 라우트로 우회하나: 직접 토큰 URL 하드 네비게이션은 프리페치/네비게이션 맥락에서 로그인으로
 * 튕기는 경우가 있으나, 서버 302로 도착하면(=/site 흐름과 동일) 익명 사용자에게 안정적으로 열린다.
 * 또한 하드코딩 토큰의 만료·불일치 위험을 없앤다(항상 DB의 유효 토큰 사용).
 */
export async function GET(req: Request) {
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.a11ychk.com";
  const locale = negotiateLocale(req);
  const home = `${siteUrl}/${locale}`;

  const demoUrl = process.env.NEXT_PUBLIC_DEMO_REPORT_URL ?? "";
  const scanId = demoUrl.match(/scans\/([0-9a-f-]{36})/i)?.[1];
  if (!scanId) return NextResponse.redirect(home, { status: 302 });

  const admin = createAdminClient();
  const { data: scan } = await admin
    .from("scans")
    .select("id, share_token, status")
    .eq("id", scanId)
    .maybeSingle();
  if (!scan || scan.status !== "done") return NextResponse.redirect(home, { status: 302 });

  let token = scan.share_token as string | null;
  if (!token) {
    token = crypto.randomBytes(32).toString("hex");
    await admin.from("scans").update({ share_token: token }).eq("id", scan.id);
  }

  return NextResponse.redirect(`${siteUrl}/${locale}/scans/${scan.id}/report?token=${token}`, { status: 302 });
}
