import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { adminBase } from "@/lib/adminSlug";

export const dynamic = "force-dynamic";

/**
 * 헤더의 관리자 메뉴 주소 — 관리자에게만 낸다(AdminNavLink가 로그인 힌트가 켜졌을 때 묻는다).
 *
 * 헤더가 정적 HTML이 되면서 관리자 여부를 서버 렌더로 정할 수 없게 됐다. 관리자 경로 슬러그는 비밀이라
 * 정적 HTML·번들에 넣을 수 없으므로, 예전에 헤더가 하던 판정(세션 사용자의 profiles.role)을 여기서 그대로 한다.
 * 관리자가 아니거나 로그인하지 않았으면 null — 비관리자에게는 슬러그가 나가지 않는다.
 */
export async function GET() {
  let href: string | null = null;
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (user) {
      const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
      if (profile?.role === "admin") href = adminBase();
    }
  } catch {
    // 세션·DB 오류 — 메뉴를 숨긴다(관리자 화면 자체의 가드는 requireAdmin이 따로 한다)
  }
  return NextResponse.json({ adminHref: href }, { headers: { "Cache-Control": "private, no-store" } });
}
