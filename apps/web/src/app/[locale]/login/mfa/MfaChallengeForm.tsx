"use client";

import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { appFetch } from "@/lib/serviceStatus";

export interface MfaChallengeLabels {
  codeLabel: string;
  verify: string;
  working: string;
  reissue: string;
  errInvalidCode: string;
  errGeneric: string;
}

/** TOTP 챌린지 — factor 조회 → challenge 발급 → 6자리 verify → AAL2 → post-login 훅 → next */
export function MfaChallengeForm({ next, labels }: { next: string; labels: MfaChallengeLabels }) {
  const [factorId, setFactorId] = useState<string | null>(null);
  const [challengeId, setChallengeId] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 주의: effect 본문에서 동기 setState 금지 (react-hooks/set-state-in-effect) —
  // 모든 setState는 await 이후(비동기 콜백)에서만 일어난다.
  async function issueChallenge() {
    const supabase = createClient();
    const { data: factors, error: listErr } = await supabase.auth.mfa.listFactors();
    const totp = factors?.totp?.[0];
    if (listErr || !totp) {
      setError(labels.errGeneric);
      return;
    }
    setFactorId(totp.id);
    const { data: challenge, error: chErr } = await supabase.auth.mfa.challenge({ factorId: totp.id });
    if (chErr || !challenge) {
      setError(labels.errGeneric);
      return;
    }
    setChallengeId(challenge.id);
  }

  const started = useRef(false);
  useEffect(() => {
    if (started.current) return; // StrictMode 이중 실행 방지 — 챌린지 중복 발급 금지
    started.current = true;
    void issueChallenge();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!factorId || !challengeId || busy) return;
    setBusy(true);
    setError(null);
    try {
      const supabase = createClient();
      const { error: vErr } = await supabase.auth.mfa.verify({ factorId, challengeId, code: code.trim() });
      if (vErr) {
        // 실패 기록 — 비밀번호는 통과한 시도라 누적되면 계정 탈취 신호 (best-effort)
        try {
          await appFetch("/api/auth/post-login", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ stage: "mfaFailed" }),
          });
        } catch {
          // 기록 실패가 재시도를 막지 않는다
        }
        // 챌린지 만료 가능성 — 다음 시도를 위해 재발급
        setError(labels.errInvalidCode);
        setCode("");
        await issueChallenge();
        return;
      }
      // AAL2 완성 — 동시 로그인 철회·알림·무활동 타이머 (best-effort)
      try {
        await appFetch("/api/auth/post-login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ stage: "mfa" }),
        });
      } catch {
        // 훅 실패는 접근을 막지 않는다 — requireAdmin이 상태를 재검증
      }
      window.location.assign(next);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="mt-5">
      <label htmlFor="mfa-code" className="mb-1 block text-sm font-semibold">
        {labels.codeLabel}
      </label>
      <input
        id="mfa-code"
        type="text"
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="[0-9]{6}"
        maxLength={6}
        required
        autoFocus
        value={code}
        onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
        className="w-full rounded border-[1.5px] border-[var(--color-ink)] bg-[var(--color-paper)] px-3 py-2.5 text-center text-2xl font-bold tracking-[0.4em]"
      />
      <button
        type="submit"
        disabled={busy || code.length !== 6 || !challengeId}
        className="mt-4 w-full rounded border-[1.5px] border-[var(--color-seal)] bg-[var(--color-seal)] px-4 py-2.5 font-bold text-[var(--color-paper)] hover:bg-[var(--color-seal-deep)] disabled:opacity-60"
      >
        {busy ? labels.working : labels.verify}
      </button>
      {error && (
        <p role="alert" className="mt-3 text-sm font-medium text-[var(--color-crit)]">
          {error}
        </p>
      )}
      <button
        type="button"
        onClick={() => {
          setError(null);
          void issueChallenge();
        }}
        className="mt-3 text-sm font-semibold text-[var(--color-seal)] underline underline-offset-2"
      >
        {labels.reissue}
      </button>
    </form>
  );
}
