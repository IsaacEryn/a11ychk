"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

interface EmailLoginLabels {
  emailLabel: string;
  emailPlaceholder: string;
  sendLink: string;
  sending: string;
  sent: string;
  sendFailed: string;
}

/**
 * 이메일 매직링크 로그인/가입 — 비밀번호 없이 메일의 인증 링크로 로그인.
 * 처음 쓰는 이메일이면 자동으로 가입되고, 이메일 인증이 곧 가입 승인이 된다.
 */
export function EmailLoginForm({ locale, labels }: { locale: string; labels: EmailLoginLabels }) {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setState("sending");
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: {
        // 기본 템플릿(ConfirmationURL) 사용 시 인증 후 되돌아올 경로.
        // token_hash 템플릿으로 바꾼 경우에는 /auth/confirm이 처리한다.
        emailRedirectTo: `${window.location.origin}/auth/callback?next=/${locale}/dashboard`,
      },
    });
    setState(error ? "error" : "sent");
  }

  return (
    <form onSubmit={onSubmit} className="mt-3">
      <label htmlFor="login-email" className="mb-1 block text-sm font-semibold">
        {labels.emailLabel}
      </label>
      <div className="flex flex-wrap gap-2">
        <input
          id="login-email"
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder={labels.emailPlaceholder}
          aria-describedby={state === "sent" || state === "error" ? "email-login-status" : undefined}
          className="min-w-0 flex-1 rounded border-[1.5px] border-[var(--color-ink)] bg-[var(--color-paper)] px-3 py-2.5"
        />
        <button
          type="submit"
          disabled={state === "sending" || state === "sent"}
          className="rounded border-[1.5px] border-[var(--color-ink)] px-4 py-2.5 font-semibold hover:bg-[var(--color-paper-warm)] disabled:opacity-60"
        >
          {state === "sending" ? labels.sending : labels.sendLink}
        </button>
      </div>
      <p id="email-login-status" role="status" aria-live="polite" className="mt-2 text-sm">
        {state === "sent" && <span className="font-medium text-[var(--color-seal)]">{labels.sent}</span>}
        {state === "error" && <span className="font-medium text-[var(--color-crit)]">{labels.sendFailed}</span>}
      </p>
    </form>
  );
}
