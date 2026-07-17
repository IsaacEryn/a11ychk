/**
 * 자체 에러 모니터링 — 처리되지 않은 서버 오류를 app_errors 테이블에 기록한다
 * (migration 0008). 기록 실패가 원래 요청 처리에 영향을 주지 않도록 best-effort.
 * 관리자 콘솔 /admin/logs에서 확인. 24시간 내 처음 보는 메시지는 관리자에게
 * 이메일 알림 (ADMIN_ALERT_EMAIL + RESEND_API_KEY 설정 시).
 */
import type { Instrumentation } from "next";

export const onRequestError: Instrumentation.onRequestError = async (error, request) => {
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) return;

    const err = error as { message?: string; stack?: string; digest?: string };
    const message = String(err.message ?? error).slice(0, 2000);
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
        message,
        stack: err.stack ? String(err.stack).slice(0, 8000) : null,
        path: request.path.slice(0, 500),
        method: request.method,
      }),
    });

    await maybeAlertAdmin(url, key, message, request.method, request.path);
  } catch {
    // 에러 기록 실패 — 무시 (원 요청에 영향 금지)
  }
};

/**
 * 새 오류 이메일 알림 — 같은 메시지가 최근 24시간 안에 없었을 때만 발송한다
 * (반복 오류로 인한 메일 폭주 방지). 미설정·실패 시 조용히 건너뜀.
 */
async function maybeAlertAdmin(
  supabaseUrl: string,
  serviceKey: string,
  message: string,
  method: string,
  path: string,
): Promise<void> {
  try {
    const to = process.env.ADMIN_ALERT_EMAIL;
    const resendKey = process.env.RESEND_API_KEY;
    if (!to || !resendKey) return;

    // 방금 넣은 행 포함 24시간 내 같은 메시지 수 — 2건 이상이면 이미 알린 오류
    const since = new Date(Date.now() - 24 * 3600_000).toISOString();
    const dupRes = await fetch(
      `${supabaseUrl}/rest/v1/app_errors?select=id&limit=2&message=eq.${encodeURIComponent(message)}&created_at=gt.${encodeURIComponent(since)}`,
      { headers: { apikey: serviceKey, authorization: `Bearer ${serviceKey}` } },
    );
    if (!dupRes.ok) return;
    const dup = (await dupRes.json()) as unknown[];
    if (dup.length > 1) return;

    const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.a11ychk.com";
    const subject = `[A11Y Check] 새 서버 오류: ${message.slice(0, 80)}`;
    const html = `
<div style="font-family:'Apple SD Gothic Neo','Malgun Gothic',sans-serif;color:#1c2422;font-size:14px;line-height:1.6">
  <p style="font-weight:700;margin:0 0 12px">처리되지 않은 서버 오류가 새로 발생했습니다.</p>
  <p style="margin:0"><b>경로</b>: <code>${esc(method)} ${esc(path.slice(0, 300))}</code></p>
  <p style="margin:8px 0 0"><b>메시지</b>:</p>
  <pre style="margin:4px 0 0;padding:10px;background:#f5f3ee;border-radius:6px;white-space:pre-wrap;word-break:break-all">${esc(message.slice(0, 600))}</pre>
  <p style="margin:16px 0 0"><a href="${siteUrl}/ko/admin/logs" style="color:#0b5d54;font-weight:700">관리자 콘솔에서 확인 →</a></p>
  <p style="margin:12px 0 0;font-size:12px;color:#5d6a66">같은 메시지는 24시간에 한 번만 알립니다.</p>
</div>`;
    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${resendKey}`, "content-type": "application/json" },
      body: JSON.stringify({ from: "A11Y Check <noreply@a11ychk.com>", to, subject, html }),
    });
  } catch {
    // 알림 실패 — 무시
  }
}
