/**
 * 자체 에러 모니터링 — 처리되지 않은 서버 오류를 app_errors 테이블에 기록한다
 * (migration 0008). 기록 실패가 원래 요청 처리에 영향을 주지 않도록 best-effort.
 * 관리자 콘솔 /admin/logs에서 확인.
 */
import type { Instrumentation } from "next";

export const onRequestError: Instrumentation.onRequestError = async (error, request) => {
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) return;

    const err = error as { message?: string; stack?: string; digest?: string };
    // supabase-js 클라이언트 생성 없이 REST로 직접 insert (인스트루먼테이션 경량 유지)
    await fetch(`${url}/rest/v1/app_errors`, {
      method: "POST",
      headers: {
        apikey: key,
        authorization: `Bearer ${key}`,
        "content-type": "application/json",
        prefer: "return=minimal",
      },
      body: JSON.stringify({
        digest: err.digest ?? null,
        message: String(err.message ?? error).slice(0, 2000),
        stack: err.stack ? String(err.stack).slice(0, 8000) : null,
        path: request.path.slice(0, 500),
        method: request.method,
      }),
    });
  } catch {
    // 에러 기록 실패 — 무시 (원 요청에 영향 금지)
  }
};
