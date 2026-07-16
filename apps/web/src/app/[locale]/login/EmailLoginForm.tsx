"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

export interface EmailAuthLabels {
  tabSignIn: string;
  tabSignUp: string;
  emailLabel: string;
  emailPlaceholder: string;
  passwordLabel: string;
  passwordPlaceholder: string;
  passwordConfirmLabel: string;
  signIn: string;
  signUp: string;
  forgot: string;
  forgotTitle: string;
  forgotDesc: string;
  sendReset: string;
  backToSignIn: string;
  working: string;
  // 메시지
  signUpSent: string; // 가입 확인 메일 발송
  resetSent: string; // 재설정 메일 발송
  errPasswordMismatch: string;
  errPasswordShort: string;
  errInvalidCredentials: string;
  errNotConfirmed: string;
  errExists: string;
  errGeneric: string;
}

type Mode = "signin" | "signup" | "forgot";

export function EmailLoginForm({ locale, labels }: { locale: string; labels: EmailAuthLabels }) {
  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const origin = typeof window !== "undefined" ? window.location.origin : "";

  async function handleSignIn() {
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    if (error) {
      const m = /confirm/i.test(error.message)
        ? labels.errNotConfirmed
        : /invalid/i.test(error.message)
          ? labels.errInvalidCredentials
          : labels.errGeneric;
      setMsg({ kind: "err", text: m });
      return;
    }
    // 세션 쿠키 반영을 위해 전체 이동
    window.location.assign(`/${locale}/dashboard`);
  }

  async function handleSignUp() {
    if (password.length < 8) return setMsg({ kind: "err", text: labels.errPasswordShort });
    if (password !== confirm) return setMsg({ kind: "err", text: labels.errPasswordMismatch });
    const supabase = createClient();
    const { data, error } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: {
        emailRedirectTo: `${origin}/auth/confirm?next=/${locale}/dashboard`,
        data: { locale },
      },
    });
    if (error) {
      setMsg({ kind: "err", text: /registered|exists/i.test(error.message) ? labels.errExists : labels.errGeneric });
      return;
    }
    // 이미 가입된 이메일이면 Supabase는 error 없이 빈 identities를 반환
    if (data.user && data.user.identities && data.user.identities.length === 0) {
      setMsg({ kind: "err", text: labels.errExists });
      return;
    }
    setMsg({ kind: "ok", text: labels.signUpSent });
  }

  async function handleForgot() {
    const supabase = createClient();
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${origin}/${locale}/auth/reset`,
    });
    // 계정 존재 여부 노출 방지 — 오류여도 동일 안내
    setMsg({ kind: "ok", text: labels.resetSent });
    void error;
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      if (mode === "signin") await handleSignIn();
      else if (mode === "signup") await handleSignUp();
      else await handleForgot();
    } catch {
      setMsg({ kind: "err", text: labels.errGeneric });
    } finally {
      setBusy(false);
    }
  }

  const inputCls =
    "w-full rounded border-[1.5px] border-[var(--color-ink)] bg-[var(--color-paper)] px-3 py-2.5";

  if (mode === "forgot") {
    return (
      <form onSubmit={onSubmit} className="mt-3">
        <h2 className="text-sm font-bold">{labels.forgotTitle}</h2>
        <p className="mb-2 mt-0.5 text-xs text-[var(--color-ink-soft)]">{labels.forgotDesc}</p>
        <label htmlFor="fp-email" className="mb-1 block text-sm font-semibold">
          {labels.emailLabel}
        </label>
        <input
          id="fp-email"
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder={labels.emailPlaceholder}
          className={inputCls}
        />
        <button
          type="submit"
          disabled={busy}
          className="mt-3 w-full rounded border-[1.5px] border-[var(--color-ink)] px-4 py-2.5 font-semibold hover:bg-[var(--color-paper-warm)] disabled:opacity-60"
        >
          {busy ? labels.working : labels.sendReset}
        </button>
        <StatusMsg msg={msg} />
        <button
          type="button"
          onClick={() => { setMode("signin"); setMsg(null); }}
          className="mt-3 text-sm font-semibold text-[var(--color-seal)] underline underline-offset-2"
        >
          {labels.backToSignIn}
        </button>
      </form>
    );
  }

  return (
    <div className="mt-3">
      <div role="tablist" aria-label={labels.tabSignIn} className="mb-3 flex gap-1 border-b-[1.5px] border-[var(--color-line)]">
        {(["signin", "signup"] as const).map((m) => (
          <button
            key={m}
            role="tab"
            type="button"
            aria-selected={mode === m}
            onClick={() => { setMode(m); setMsg(null); }}
            className={`border-b-[3px] px-3 py-2 text-sm font-bold ${
              mode === m
                ? "border-[var(--color-seal)] text-[var(--color-seal)]"
                : "border-transparent text-[var(--color-ink-soft)]"
            }`}
          >
            {m === "signin" ? labels.tabSignIn : labels.tabSignUp}
          </button>
        ))}
      </div>

      <form onSubmit={onSubmit} className="space-y-3">
        <div>
          <label htmlFor="auth-email" className="mb-1 block text-sm font-semibold">
            {labels.emailLabel}
          </label>
          <input
            id="auth-email"
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder={labels.emailPlaceholder}
            className={inputCls}
          />
        </div>
        <div>
          <label htmlFor="auth-password" className="mb-1 block text-sm font-semibold">
            {labels.passwordLabel}
          </label>
          <input
            id="auth-password"
            type="password"
            required
            minLength={8}
            autoComplete={mode === "signup" ? "new-password" : "current-password"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={labels.passwordPlaceholder}
            className={inputCls}
          />
        </div>
        {mode === "signup" && (
          <div>
            <label htmlFor="auth-confirm" className="mb-1 block text-sm font-semibold">
              {labels.passwordConfirmLabel}
            </label>
            <input
              id="auth-confirm"
              type="password"
              required
              minLength={8}
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              className={inputCls}
            />
          </div>
        )}

        <button
          type="submit"
          disabled={busy}
          className="w-full rounded border-[1.5px] border-[var(--color-seal)] bg-[var(--color-seal)] px-4 py-2.5 font-bold text-[var(--color-paper)] hover:bg-[var(--color-seal-deep)] disabled:opacity-60"
        >
          {busy ? labels.working : mode === "signin" ? labels.signIn : labels.signUp}
        </button>
      </form>

      <StatusMsg msg={msg} />

      {mode === "signin" && (
        <button
          type="button"
          onClick={() => { setMode("forgot"); setMsg(null); }}
          className="mt-3 text-sm font-semibold text-[var(--color-seal)] underline underline-offset-2"
        >
          {labels.forgot}
        </button>
      )}
    </div>
  );
}

function StatusMsg({ msg }: { msg: { kind: "ok" | "err"; text: string } | null }) {
  if (!msg) return <p role="status" aria-live="polite" className="sr-only" />;
  return (
    <p
      role={msg.kind === "err" ? "alert" : "status"}
      aria-live="polite"
      className={`mt-2 text-sm font-medium ${msg.kind === "err" ? "text-[var(--color-crit)]" : "text-[var(--color-seal)]"}`}
    >
      {msg.text}
    </p>
  );
}
