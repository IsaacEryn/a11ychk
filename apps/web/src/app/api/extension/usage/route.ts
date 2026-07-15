import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkExtUsage, getExtDailyLimit } from "@/lib/quota";

/**
 * 크롬 확장 검사 사용량 소비 (로그인 사용자 전용).
 * 확장이 검사 실행 직전에 호출한다 — 웹 검사 한도와 완전히 분리된 일일 한도.
 */
export async function POST(request: Request) {
  const authz = request.headers.get("authorization") ?? "";
  const token = authz.startsWith("Bearer ") ? authz.slice(7) : "";
  if (!token) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });

  const admin = createAdminClient();
  const { data: userData, error: userErr } = await admin.auth.getUser(token);
  if (userErr || !userData.user) {
    return NextResponse.json({ error: "세션이 만료되었습니다. 웹에서 다시 연결해 주세요." }, { status: 401 });
  }

  const { data: profile } = await admin
    .from("profiles")
    .select("blocked, scan_limit_override")
    .eq("id", userData.user.id)
    .single();
  if (!profile || profile.blocked) {
    return NextResponse.json({ error: "검사를 실행할 수 없는 계정입니다." }, { status: 403 });
  }

  const limit = getExtDailyLimit(profile.scan_limit_override);
  const usage = await checkExtUsage(admin, userData.user.id, limit, true);
  if (!usage.ok) {
    return NextResponse.json(
      { error: `오늘의 확장 검사 한도(${usage.limit}회)를 모두 사용했습니다.`, used: usage.used, limit: usage.limit },
      { status: 429 },
    );
  }
  return NextResponse.json({ ok: true, used: usage.used, limit: usage.limit });
}
