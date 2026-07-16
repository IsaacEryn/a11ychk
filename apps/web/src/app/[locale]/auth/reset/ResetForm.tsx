"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

export interface ResetLabels {
  passwordLabel: string;
  passwordConfirmLabel: string;
  passwordPlaceholder: string;
  submit: string;
  working: string;
  done: string;
  goDashboard: string;
  noSession: string;
  errShort: string;
  errMismatch: string;
  errGeneric: string;
}

/**
 * 비밀번호 재설정 — 복구 링크(/auth/confirm?type=recovery)가 세션을 만든 뒤 이 페이지로 온다.
 * 세션이 있으면 updateUser로 새 비밀번호를 설정한다.
 */
export function ResetForm({ locale, labels }: { locale: string; labels: ResetLabels }) {
  const [ready, setReady] = useState<"checking" | "ok" | "nosession">("checking");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getSession().then(({ data }) => setReady(data.session ? "ok" : "nosession"));
  }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (password.length < 8) return setMsg({ kind: "err", text: labels.errShort });
    if (password !== confirm) return setMsg({ kind: "err", text: labels.errMismatch });
    setBusy(true);
    setMsg(null);
    const supabase = createClient();
    const { error } = await supabase.auth.updateUser({ password });
    setBusy(false);
    if (error) return setMsg({ kind: "err", text: labels.errGeneric });
    setMsg({ kind: "ok", text: labels.done });
    setTimeout(() => window.location.assign(`/${locale}/dashboard`), 1200);
  }

  if (ready === "checking") return null;
  if (ready === "nosession") {
    return <p className="text-sm text-[var(--color-crit)]">{labels.noSession}</p>;
  }

  const inputCls = "w-full rounded border-[1.5px] border-[var(--color-ink)] bg-[var(--color-paper)] px-3 py-2.5";
  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <div>
        <label htmlFor="new-password" className="mb-1 block text-sm font-semibold">
          {labels.passwordLabel}
        </label>
        <input
          id="new-password"
          type="password"
          required
          minLength={8}
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder={labels.passwordPlaceholder}
          className={inputCls}
        />
      </div>
      <div>
        <label htmlFor="new-confirm" className="mb-1 block text-sm font-semibold">
          {labels.passwordConfirmLabel}
        </label>
        <input
          id="new-confirm"
          type="password"
          required
          minLength={8}
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          className={inputCls}
        />
      </div>
      <button
        type="submit"
        disabled={busy}
        className="w-full rounded border-[1.5px] border-[var(--color-seal)] bg-[var(--color-seal)] px-4 py-2.5 font-bold text-[var(--color-paper)] hover:bg-[var(--color-seal-deep)] disabled:opacity-60"
      >
        {busy ? labels.working : labels.submit}
      </button>
      {msg && (
        <p
          role={msg.kind === "err" ? "alert" : "status"}
          aria-live="polite"
          className={`text-sm font-medium ${msg.kind === "err" ? "text-[var(--color-crit)]" : "text-[var(--color-seal)]"}`}
        >
          {msg.text}
        </p>
      )}
    </form>
  );
}
