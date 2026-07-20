import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

// 항상 실시간 상태 — 캐시 금지
export const dynamic = "force-dynamic";

/** 헬스 체크 타임아웃(ms) — DB가 느리게 죽어갈 때 무한 대기 방지 */
const HEALTH_TIMEOUT_MS = 4000;

/**
 * 서비스 헬스 체크 — 장애 배너(ServiceStatusBanner)가 오프라인/장애 복구를 확인하는 데 쓴다.
 * DB(Supabase) 도달성만 가볍게 검사한다(app_settings HEAD 카운트, 인덱스만 탐). 인증 불필요.
 * 정상=200 {ok:true}, DB 이상=503 {ok:false}. 어떤 경우에도 스택·내부정보를 노출하지 않는다.
 */
export async function GET() {
  try {
    const admin = createAdminClient();
    const probe = admin.from("app_settings").select("key", { count: "exact", head: true });
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("health timeout")), HEALTH_TIMEOUT_MS),
    );
    const { error } = (await Promise.race([probe, timeout])) as { error: unknown };
    if (error) {
      return NextResponse.json({ ok: false }, { status: 503 });
    }
    return NextResponse.json({ ok: true }, { status: 200 });
  } catch {
    // 설정 누락·타임아웃·네트워크 등 모든 실패를 degraded로 보고(세부정보 비노출)
    return NextResponse.json({ ok: false }, { status: 503 });
  }
}
