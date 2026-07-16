import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getExtUsage, getExtDailyLimit } from "@/lib/quota";

/**
 * 크롬 확장 검사 사용량 조회 (로그인 사용자 전용).
 * 사용량 소비는 결과 저장 시점(POST /api/extension/scan)에 서버가 원자적으로
 * 수행한다 — 이 엔드포인트는 잔여량 표시용 조회 전용이다.
 * (구버전 확장이 검사 직전 POST하던 호환성을 위해 GET/POST 모두 조회로 응답)
 */
async function handle(request: Request) {
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
  const usage = await getExtUsage(admin, userData.user.id, limit);
  if (!usage.ok) {
    return NextResponse.json(
      { error: `오늘의 확장 검사 한도(${usage.limit}회)를 모두 사용했습니다.`, used: usage.used, limit: usage.limit },
      { status: 429 },
    );
  }
  return NextResponse.json({ ok: true, used: usage.used, limit: usage.limit });
}

export async function GET(request: Request) {
  return handle(request);
}

export async function POST(request: Request) {
  return handle(request);
}
