import { NextResponse } from "next/server";
import crypto from "node:crypto";

/**
 * Supabase "Send Email" Auth Hook — 인증 메일을 로케일에 맞춰 직접 발송한다.
 * Supabase가 기본 SMTP로 영문 템플릿을 보내는 대신, 이 훅으로 위임하면
 * 사용자의 현재 언어(ko/en)로 제목·본문을 렌더해 Resend API로 보낸다.
 *
 * 설정(사용자):
 * - Supabase → Authentication → Hooks → Send Email → Enable, URL = {SITE}/api/auth/send-email
 * - Vercel 환경변수: SEND_EMAIL_HOOK_SECRET(훅 등록 시 발급된 v1,whsec_… 시크릿),
 *   RESEND_API_KEY, NEXT_PUBLIC_SITE_URL
 *
 * 서명 검증: Standard Webhooks (webhook-id/timestamp/signature 헤더).
 */

interface HookPayload {
  user: { email: string; user_metadata?: { locale?: string } };
  email_data: {
    token_hash: string;
    redirect_to: string;
    email_action_type: string;
  };
}

/** Standard Webhooks 서명 검증 */
function verify(body: string, headers: Headers, secret: string): boolean {
  const id = headers.get("webhook-id");
  const timestamp = headers.get("webhook-timestamp");
  const sigHeader = headers.get("webhook-signature");
  if (!id || !timestamp || !sigHeader) return false;

  // 시크릿은 "v1,whsec_<base64>" 또는 "whsec_<base64>" 형태 — base64 부분만 사용
  const base64Secret = secret.replace(/^v1,/, "").replace(/^whsec_/, "");
  let key: Buffer;
  try {
    key = Buffer.from(base64Secret, "base64");
  } catch {
    return false;
  }
  const signed = `${id}.${timestamp}.${body}`;
  const expected = crypto.createHmac("sha256", key).update(signed).digest("base64");
  // 헤더는 "v1,<sig> v1,<sig2>" 공백 구분 — 하나라도 일치하면 통과
  return sigHeader.split(" ").some((part) => {
    const sig = part.split(",")[1] ?? part;
    try {
      return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
    } catch {
      return false;
    }
  });
}

type Lang = "ko" | "en";

function pickLocale(payload: HookPayload): Lang {
  try {
    const seg = new URL(payload.email_data.redirect_to).pathname.split("/")[1];
    if (seg === "en") return "en";
    if (seg === "ko") return "ko";
  } catch {
    /* 무시 */
  }
  return payload.user.user_metadata?.locale === "en" ? "en" : "ko";
}

interface MailContent {
  subject: string;
  heading: string;
  body: string;
  button: string;
  footer: string;
}

function content(lang: Lang, action: string): MailContent {
  const ko: Record<string, MailContent> = {
    signup: {
      subject: "[A11Y Check] 이메일 인증을 완료해 주세요",
      heading: "이메일 인증",
      body: "A11Y Check 가입을 환영합니다. 아래 버튼을 눌러 이메일 인증을 완료하면 로그인할 수 있습니다.",
      button: "이메일 인증하기",
      footer: "본인이 요청하지 않았다면 이 메일을 무시하셔도 됩니다.",
    },
    recovery: {
      subject: "[A11Y Check] 비밀번호 재설정",
      heading: "비밀번호 재설정",
      body: "비밀번호 재설정을 요청하셨습니다. 아래 버튼을 눌러 새 비밀번호를 설정하세요. 링크는 잠시 후 만료됩니다.",
      button: "비밀번호 재설정하기",
      footer: "본인이 요청하지 않았다면 비밀번호는 변경되지 않으니 이 메일을 무시하셔도 됩니다.",
    },
    email_change: {
      subject: "[A11Y Check] 이메일 변경 확인",
      heading: "이메일 변경 확인",
      body: "이메일 주소 변경을 확인하려면 아래 버튼을 눌러 주세요.",
      button: "이메일 변경 확인",
      footer: "본인이 요청하지 않았다면 이 메일을 무시하셔도 됩니다.",
    },
  };
  const en: Record<string, MailContent> = {
    signup: {
      subject: "[A11Y Check] Confirm your email",
      heading: "Confirm your email",
      body: "Welcome to A11Y Check. Click the button below to confirm your email and finish signing up.",
      button: "Confirm email",
      footer: "If you didn't request this, you can safely ignore this email.",
    },
    recovery: {
      subject: "[A11Y Check] Reset your password",
      heading: "Reset your password",
      body: "You requested a password reset. Click the button below to set a new password. This link expires soon.",
      button: "Reset password",
      footer: "If you didn't request this, your password won't change — ignore this email.",
    },
    email_change: {
      subject: "[A11Y Check] Confirm email change",
      heading: "Confirm email change",
      body: "Click the button below to confirm your new email address.",
      button: "Confirm email change",
      footer: "If you didn't request this, you can safely ignore this email.",
    },
  };
  const table = lang === "en" ? en : ko;
  return table[action] ?? table.signup!;
}

function renderHtml(c: MailContent, link: string): string {
  return `<!doctype html><html><body style="margin:0;background:#f5f3ee;padding:32px 0;font-family:-apple-system,Segoe UI,Roboto,'Apple SD Gothic Neo',sans-serif;color:#1a1a1a">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
    <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;overflow:hidden;border:1px solid #e5e1d8">
      <tr><td style="padding:28px 32px 8px"><span style="font-weight:800;font-size:18px;color:#0b6b5e">A11Y Check</span></td></tr>
      <tr><td style="padding:8px 32px 4px"><h1 style="margin:0;font-size:20px">${c.heading}</h1></td></tr>
      <tr><td style="padding:8px 32px 20px;font-size:14px;line-height:1.6;color:#444">${c.body}</td></tr>
      <tr><td style="padding:0 32px 28px"><a href="${link}" style="display:inline-block;background:#0b6b5e;color:#fff;text-decoration:none;font-weight:700;font-size:15px;padding:12px 22px;border-radius:8px">${c.button}</a></td></tr>
      <tr><td style="padding:0 32px 28px;font-size:12px;line-height:1.6;color:#8a8a8a;border-top:1px solid #eee;padding-top:16px">${c.footer}<br>a11ychk.com</td></tr>
    </table>
  </td></tr></table>
</body></html>`;
}

export async function POST(request: Request) {
  const secret = process.env.SEND_EMAIL_HOOK_SECRET;
  const resendKey = process.env.RESEND_API_KEY;
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.a11ychk.com";
  if (!secret || !resendKey) {
    return NextResponse.json({ error: "not configured" }, { status: 500 });
  }

  const body = await request.text();
  if (!verify(body, request.headers, secret)) {
    return NextResponse.json({ error: "invalid signature" }, { status: 401 });
  }

  let payload: HookPayload;
  try {
    payload = JSON.parse(body) as HookPayload;
  } catch {
    return NextResponse.json({ error: "bad payload" }, { status: 400 });
  }

  const { token_hash, redirect_to, email_action_type } = payload.email_data;
  const lang = pickLocale(payload);
  let nextPath = `/${lang}/dashboard`;
  try {
    nextPath = new URL(redirect_to).pathname || nextPath;
  } catch {
    /* 무시 */
  }
  const link = `${siteUrl}/auth/confirm?token_hash=${encodeURIComponent(token_hash)}&type=${encodeURIComponent(
    email_action_type,
  )}&next=${encodeURIComponent(nextPath)}`;

  const c = content(lang, email_action_type);
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${resendKey}`, "content-type": "application/json" },
      body: JSON.stringify({
        from: "A11Y Check <noreply@a11ychk.com>",
        to: payload.user.email,
        subject: c.subject,
        html: renderHtml(c, link),
      }),
    });
    if (!res.ok) {
      const detail = await res.text();
      return NextResponse.json({ error: "send failed", detail: detail.slice(0, 200) }, { status: 502 });
    }
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }

  // 성공 시 200 + JSON 본문 (Supabase 훅은 application/json 응답을 요구 — 빈 본문/헤더 누락 시 거부)
  return NextResponse.json({}, { status: 200 });
}
