import { NextResponse } from "next/server";
import { requireExtensionUser } from "@/lib/apiAuth";
import { apiError, resolveApiLocale } from "@/lib/apiError";
import { getEarnedPlan, getExtUsage, getExtDailyLimit } from "@/lib/quota";

/**
 * 크롬 확장 검사 사용량 조회 (로그인 사용자 전용).
 * 사용량 소비는 결과 저장 시점(POST /api/extension/scan)에 서버가 원자적으로
 * 수행한다 — 이 엔드포인트는 잔여량 표시용 조회 전용이다.
 * (구버전 확장이 검사 직전 POST하던 호환성을 위해 GET/POST 모두 조회로 응답)
 */
async function handle(request: Request) {
  const auth = await requireExtensionUser(request);
  if (auth instanceof NextResponse) return auth;
  const { admin, user, profile } = auth;

  const limit = getExtDailyLimit(profile.scan_limit_override, getEarnedPlan(profile.earned_plan));
  const usage = await getExtUsage(admin, user.id, limit);
  if (!usage.ok) {
    return apiError(resolveApiLocale(request), "extQuotaExceeded", 429, {
      params: { limit: usage.limit },
      extra: { used: usage.used, limit: usage.limit },
    });
  }
  return NextResponse.json({ ok: true, used: usage.used, limit: usage.limit });
}

export async function GET(request: Request) {
  return handle(request);
}

export async function POST(request: Request) {
  return handle(request);
}
