"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

export function OAuthButtons({
  locale,
  next,
  googleLabel,
  githubLabel,
}: {
  locale: string;
  /** 로그인 후 돌아갈 내부 경로 (서버에서 sanitize됨) */
  next?: string;
  googleLabel: string;
  githubLabel: string;
}) {
  const [pending, setPending] = useState<"google" | "github" | null>(null);

  async function signIn(provider: "google" | "github") {
    setPending(provider);
    const supabase = createClient();
    await supabase.auth.signInWithOAuth({
      provider,
      options: {
        redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next ?? `/${locale}/dashboard`)}`,
      },
    });
  }

  const btnCls =
    "flex w-full items-center justify-center gap-2.5 rounded border-[1.5px] border-[var(--color-ink)] px-4 py-3 font-semibold hover:bg-[var(--color-paper-warm)] disabled:opacity-60";

  return (
    <div className="mt-7 space-y-3">
      <button type="button" onClick={() => signIn("google")} disabled={pending !== null} className={btnCls}>
        <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24">
          <path
            fill="currentColor"
            d="M21.35 11.1H12v2.9h5.35c-.5 2.5-2.6 4.3-5.35 4.3a5.8 5.8 0 1 1 0-11.6c1.45 0 2.75.5 3.8 1.35l2.15-2.15A8.9 8.9 0 0 0 12 3.1a8.9 8.9 0 1 0 0 17.8c5.15 0 8.85-3.6 8.85-8.7 0-.4-.05-.75-.1-1.1z"
          />
        </svg>
        {pending === "google" ? "…" : googleLabel}
      </button>
      <button type="button" onClick={() => signIn("github")} disabled={pending !== null} className={btnCls}>
        <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24">
          <path
            fill="currentColor"
            d="M12 2a10 10 0 0 0-3.16 19.49c.5.09.68-.22.68-.48v-1.7c-2.78.6-3.37-1.34-3.37-1.34-.45-1.16-1.11-1.47-1.11-1.47-.9-.62.07-.6.07-.6 1 .07 1.53 1.03 1.53 1.03.9 1.52 2.34 1.08 2.91.83.09-.65.35-1.09.63-1.34-2.22-.25-4.55-1.11-4.55-4.94 0-1.09.39-1.98 1.03-2.68-.1-.25-.45-1.27.1-2.64 0 0 .84-.27 2.75 1.02a9.58 9.58 0 0 1 5 0c1.91-1.3 2.75-1.02 2.75-1.02.55 1.37.2 2.39.1 2.64.64.7 1.03 1.59 1.03 2.68 0 3.84-2.34 4.68-4.57 4.93.36.31.68.92.68 1.85V21c0 .27.18.58.69.48A10 10 0 0 0 12 2z"
          />
        </svg>
        {pending === "github" ? "…" : githubLabel}
      </button>
    </div>
  );
}
