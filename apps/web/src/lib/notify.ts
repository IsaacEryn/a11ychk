import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAppError } from "@/lib/logs";

/**
 * 정기 스캔 결과 알림 이메일 (Resend).
 * 준수율 하락 또는 새 위반 규칙 발견 시에만 발송 — 잡음 없는 회귀 알림.
 * RESEND_API_KEY 미설정 시 no-op (best-effort).
 */
export interface ScanAlert {
  to: string;
  hostname: string;
  prevRate: number;
  newRate: number;
  newRules: string[]; // 이번에 새로 위반된 규칙 제목(사람이 읽는 문자열)
  reportUrl: string;
}

export async function sendScanAlert(alert: ScanAlert): Promise<boolean> {
  const key = process.env.RESEND_API_KEY;
  if (!key) return false;

  const delta = Math.round((alert.newRate - alert.prevRate) * 10) / 10;
  const subject = `[A11y Check] ${alert.hostname} 접근성 점검 변화 알림 (${alert.newRate}%, ${delta >= 0 ? "+" : ""}${delta}p)`;

  const newRulesHtml =
    alert.newRules.length > 0
      ? `<p style="margin:12px 0 4px;font-weight:700">새로 발견된 위반</p><ul style="margin:0;padding-left:20px">${alert.newRules
          .slice(0, 5)
          .map((r) => `<li style="margin:2px 0">${escapeHtml(r)}</li>`)
          .join("")}${alert.newRules.length > 5 ? `<li>외 ${alert.newRules.length - 5}건</li>` : ""}</ul>`
      : "";

  const html = `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f3ee;padding:24px 0">
  <tr><td align="center">
    <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="background:#fff;border:1px solid #e5e1d8;border-radius:12px;font-family:'Apple SD Gothic Neo','Malgun Gothic',sans-serif;color:#1c2422">
      <tr><td style="padding:28px 32px 8px"><img src="https://www.a11ychk.com/email-lockup.png" width="162" height="38" alt="A11y Check" style="display:block;border:0" /></td></tr>
      <tr><td style="padding:8px 32px">
        <p style="margin:0;font-size:16px;font-weight:700">${escapeHtml(alert.hostname)} 정기 검사 결과에 변화가 있습니다</p>
        <p style="margin:12px 0 0;font-size:14px;line-height:1.6">
          준수율: <b>${alert.prevRate}%</b> → <b style="color:${delta < 0 ? "#a4243b" : "#0b5d54"}">${alert.newRate}%</b>
          (${delta >= 0 ? "+" : ""}${delta}p)
        </p>
        ${newRulesHtml}
      </td></tr>
      <tr><td style="padding:20px 32px 28px">
        <a href="${alert.reportUrl}" style="display:inline-block;background:#0b5d54;color:#fff;text-decoration:none;font-weight:700;font-size:15px;padding:12px 22px;border-radius:8px">보고서 보기</a>
        <p style="margin:16px 0 0;font-size:12px;color:#5d6a66">이 알림은 정기 자동 검사 도메인에 대해 발송됩니다. 대시보드에서 도메인별로 끌 수 있습니다.</p>
      </td></tr>
    </table>
  </td></tr>
</table>`;

  const ok = await sendEmail({ to: alert.to, subject, html });
  if (!ok) {
    // 회귀 알림 유실은 운영자가 인지해야 함 — app_errors에 흔적 (수신자 노출 없이 호스트만)
    await logAppError(createAdminClient(), `scan alert send failed: ${alert.hostname}`, {
      path: "notify.sendScanAlert",
    });
  }
  return ok;
}

/**
 * 신규 문의 관리자 알림 — 사용자가 문의를 남기면 ADMIN_ALERT_EMAIL로 즉시 통지한다.
 * (기존엔 관리자 패널을 열어야만 새 문의를 인지할 수 있었음.) best-effort.
 */
export async function sendAdminInquiryAlert(title: string, nickname: string | null): Promise<boolean> {
  const to = process.env.ADMIN_ALERT_EMAIL;
  if (!to) return false;
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.a11ychk.com";
  const html = `
<p style="font-family:sans-serif;font-size:14px;line-height:1.6">
  새 문의가 접수되었습니다.<br/>
  <b>${escapeHtml(title)}</b>${nickname ? ` — ${escapeHtml(nickname)}` : ""}<br/>
  <a href="${siteUrl}/ko/admin/inquiries">관리자에서 확인</a>
</p>`;
  const ok = await sendEmail({ to, subject: `[A11y Check] 새 문의: ${title.slice(0, 60)}`, html });
  if (!ok) {
    await logAppError(createAdminClient(), "admin inquiry alert send failed", { path: "notify.sendAdminInquiryAlert" });
  }
  return ok;
}

/** Resend 발송 공통부 — 키 미설정 시 false(no-op) */
async function sendEmail(msg: { to: string; subject: string; html: string }): Promise<boolean> {
  const key = process.env.RESEND_API_KEY;
  if (!key) return false;
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({ from: "A11y Check <noreply@a11ychk.com>", to: msg.to, subject: msg.subject, html: msg.html }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

function escapeHtml(s: string): string {
  return s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}
