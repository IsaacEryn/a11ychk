"use client";

import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { appFetch } from "@/lib/serviceStatus";
import { PendingStatus } from "@/components/PendingStatus";

export interface MfaChallengeLabels {
  codeLabel: string;
  verify: string;
  working: string;
  preparing: string;
  redirecting: string;
  reissue: string;
  errInvalidCode: string;
  errGeneric: string;
}

/**
 * 진행 단계. 성공 후 redirecting에 머무는 것이 핵심이다 — window.location.assign은
 * 즉시 반환하고 실제 이동까지 수 초가 걸리는데, 그 사이 버튼을 원래대로 되돌리면
 * 사용자에게는 "눌렀는데 아무 일도 없는" 화면이 된다.
 */
type Phase = "preparing" | "ready" | "verifying" | "redirecting";

/** TOTP 챌린지 — factor 조회 → challenge 발급 → 6자리 verify → AAL2 → post-login 훅 → next */
export function MfaChallengeForm({ next, labels }: { next: string; labels: MfaChallengeLabels }) {
  const [factorId, setFactorId] = useState<string | null>(null);
  const [challengeId, setChallengeId] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [phase, setPhase] = useState<Phase>("preparing");
  const [error, setError] = useState<string | null>(null);

  // 주의: effect 본문에서 동기 setState 금지 (react-hooks/set-state-in-effect) —
  // 모든 setState는 await 이후(비동기 콜백)에서만 일어난다.
  async function issueChallenge() {
    setPhase("preparing");
    const supabase = createClient();
    const { data: factors, error: listErr } = await supabase.auth.mfa.listFactors();
    const totp = factors?.totp?.[0];
    if (listErr || !totp) {
      setError(labels.errGeneric);
      setPhase("ready"); // 재발급 버튼으로 다시 시도할 수 있게 준비 표시를 걷는다
      return;
    }
    setFactorId(totp.id);
    const { data: challenge, error: chErr } = await supabase.auth.mfa.challenge({ factorId: totp.id });
    if (chErr || !challenge) {
      setError(labels.errGeneric);
      setPhase("ready");
      return;
    }
    setChallengeId(challenge.id);
    setPhase("ready");
  }

  const started = useRef(false);
  useEffect(() => {
    if (started.current) return; // StrictMode 이중 실행 방지 — 챌린지 중복 발급 금지
    started.current = true;
    void issueChallenge();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const busy = phase === "verifying" || phase === "redirecting";

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!factorId || !challengeId || busy) return;
    setPhase("verifying");
    setError(null);
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
      setError(labels.errInvalidCode);
      setCode("");
      await issueChallenge(); // 챌린지 만료 가능성 — 다음 시도를 위해 재발급
      return;
    }
    // AAL2 완성 — 동시 로그인 철회·알림·무활동 타이머 (best-effort)
    setPhase("redirecting");
    try {
      await appFetch("/api/auth/post-login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stage: "mfa" }),
      });
    } catch {
      // 훅 실패는 접근을 막지 않는다 — requireAdmin이 상태를 재검증
    }
    // 이동이 끝날 때까지 redirecting을 유지한다 (여기서 상태를 되돌리지 않는 것이 요점)
    window.location.assign(next);
  }

  const statusMessage =
    phase === "preparing" ? labels.preparing : phase === "verifying" ? labels.working : phase === "redirecting" ? labels.redirecting : null;

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
        disabled={busy}
        value={code}
        onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
        className="w-full rounded border-[1.5px] border-[var(--color-ink)] bg-[var(--color-paper)] px-3 py-2.5 text-center text-2xl font-bold tracking-[0.4em] disabled:opacity-60"
      />
      <button
        type="submit"
        disabled={phase !== "ready" || code.length !== 6 || !challengeId}
        className="mt-4 w-full rounded border-[1.5px] border-[var(--color-seal)] bg-[var(--color-seal)] px-4 py-2.5 font-bold text-[var(--color-paper)] hover:bg-[var(--color-seal-deep)] disabled:opacity-60"
      >
        {phase === "verifying" ? labels.working : phase === "redirecting" ? labels.redirecting : labels.verify}
      </button>
      <PendingStatus message={statusMessage} />
      {error && (
        <p role="alert" className="mt-2 text-sm font-medium text-[var(--color-crit)]">
          {error}
        </p>
      )}
      <button
        type="button"
        disabled={busy}
        onClick={() => {
          setError(null);
          void issueChallenge();
        }}
        className="mt-3 text-sm font-semibold text-[var(--color-seal)] underline underline-offset-2 disabled:opacity-60"
      >
        {labels.reissue}
      </button>
    </form>
  );
}
