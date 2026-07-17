import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * 오류 알림 파이프라인 점검 — 관리자가 호출하면 의도적으로 미처리 오류를 던져
 * app_errors 기록·ADMIN_ALERT_EMAIL 이메일 발송까지 실제 경로로 검증한다.
 * ?tag= 값이 메시지에 포함되므로 같은 tag 재호출로 24시간 중복 억제도 확인 가능.
 */
export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { data: me } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  if (me?.role !== "admin") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const tag = new URL(request.url).searchParams.get("tag") ?? "manual";
  // 의도적 미처리 오류 — instrumentation.onRequestError가 기록·알림한다
  throw new Error(`[점검] 서버 오류 알림 테스트 (${tag.slice(0, 50)})`);
}
