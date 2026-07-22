import "server-only";
import { NextResponse } from "next/server";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * 확장 API 공통 인증 — Bearer 토큰 검증 → 사용자 → 프로필/차단 확인.
 * 실패 시 바로 반환할 NextResponse를 돌려준다 (라우트에서 instanceof로 분기).
 */
export async function requireExtensionUser(request: Request): Promise<
  | {
      admin: SupabaseClient;
      user: User;
      profile: { blocked: boolean; scan_limit_override: unknown; earned_plan?: unknown; referral_daily_bonus?: unknown };
    }
  | NextResponse
> {
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
    .select("blocked, scan_limit_override, earned_plan, referral_daily_bonus")
    .eq("id", userData.user.id)
    .single();
  if (!profile || profile.blocked) {
    return NextResponse.json({ error: "검사를 실행할 수 없는 계정입니다." }, { status: 403 });
  }

  return { admin, user: userData.user, profile };
}

/**
 * 스캔 소유 확인 — 소유가 아니면 null (호출자는 404/forbidden 처리).
 * RLS에만 의존하지 않고 명시적으로 재확인한다.
 */
export async function requireScanOwner<T extends { user_id: string } = { id: string; user_id: string }>(
  db: SupabaseClient,
  scanId: string,
  userId: string,
  select = "id, user_id",
): Promise<T | null> {
  const { data: scan } = await db.from("scans").select(select).eq("id", scanId).maybeSingle();
  if (!scan || (scan as unknown as T).user_id !== userId) return null;
  return scan as unknown as T;
}
