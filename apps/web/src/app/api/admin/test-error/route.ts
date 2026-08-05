import { NextResponse } from "next/server";
import { checkAdmin } from "@/lib/adminGuard";

/**
 * 오류 알림 파이프라인 점검 — 관리자가 호출하면 의도적으로 미처리 오류를 던져
 * app_errors 기록·ADMIN_ALERT_EMAIL 이메일 발송까지 실제 경로로 검증한다.
 *
 * 오류 메시지는 고정한다 — instrumentation의 24시간 중복 억제가 메시지 완전 일치로
 * 판정하므로, tag를 메시지에 넣으면 매 호출이 "최초 발생"이 되어 알림이 무제한 발송된다.
 */
export async function GET(request: Request) {
  // 관리자 판정은 페이지 가드와 같은 사슬(2단계 인증·무활동 포함)을 쓴다
  const check = await checkAdmin();
  if (!check.ok) {
    const status = check.reason === "unauthenticated" ? 401 : 403;
    return NextResponse.json({ error: check.reason }, { status });
  }

  const tag = (new URL(request.url).searchParams.get("tag") ?? "manual").slice(0, 50);
  // 의도적 미처리 오류 — instrumentation.onRequestError가 기록·알림한다.
  // tag는 스택 아닌 곳에 남겨 중복 억제 키(메시지)를 오염시키지 않는다.
  const err = new Error("[점검] 서버 오류 알림 테스트");
  err.cause = { tag };
  throw err;
}
