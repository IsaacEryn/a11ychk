import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { logAppError } from "@/lib/logs";
import { createAdminClient } from "@/lib/supabase/admin";
import { billingTestUserIds } from "./config";
import { shouldLog } from "./logThrottle";
import { ANONYMOUS_VIEWER, type Viewer } from "./visibility";

/**
 * 결제 공개 범위 판정의 읽기 오류 기록 — 오류 코드만 남긴다(메시지에는 행 값·호스트가 섞일 수 있다). 사용자 세션
 * 클라이언트는 app_errors에 쓸 수 없어 기록만 service role로 한다(entitlements.ts와 같은 방식). 기록 실패는 무시한다.
 * 요금제·결제 화면은 렌더마다 읽으므로, 오류가 이어지는 동안 같은 메시지는 프로세스당 1분에 한 번만 남긴다(logThrottle).
 */
export async function reportBillingReadError(what: string, error: { code?: string }, now: number = Date.now()): Promise<void> {
  const message = `billing ${what} read failed (${error.code ?? "unknown"}); treated as closed`;
  if (!shouldLog(message, now)) return;
  try {
    await logAppError(createAdminClient(), message, { path: "billing" });
  } catch {
    // 관측은 best-effort
  }
}

/**
 * 결제 공개 범위용 시청자 판정 — 관리자 여부는 profiles.role(결제 화면은 관리자 2단계 인증을 요구하지 않는다).
 * 조회가 오류면 화면을 깨뜨리지 않고 닫힌 쪽(익명 — 관리자도 테스터도 아님, 결제 불가)으로 본다: 오류 한 번에 가격·결제가
 * 열리는 것보다 잠깐 닫히는 편이 안전하다. 오류는 코드만 기록한다.
 */
export async function loadViewer(db: SupabaseClient, userId: string | null): Promise<Viewer> {
  if (!userId) return ANONYMOUS_VIEWER;
  const { data, error } = await db.from("profiles").select("role").eq("id", userId).maybeSingle();
  if (error) {
    await reportBillingReadError("viewer", error);
    return ANONYMOUS_VIEWER;
  }
  return { isAdmin: data?.role === "admin", isTester: billingTestUserIds().has(userId) };
}
