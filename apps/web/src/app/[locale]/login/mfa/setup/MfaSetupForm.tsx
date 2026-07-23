"use client";

import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { appFetch } from "@/lib/serviceStatus";

export interface MfaSetupLabels {
  scanQr: string;
  secretLabel: string;
  codeLabel: string;
  verify: string;
  working: string;
  errInvalidCode: string;
  errGeneric: string;
}

/**
 * TOTP 등록 — 미검증 잔류 factor 정리 → enroll → QR(data: SVG)/시크릿 표시 →
 * 인증앱 6자리로 challengeAndVerify → AAL2 → post-login 훅 → next.
 */
export function MfaSetupForm({ next, labels }: { next: string; labels: MfaSetupLabels }) {
  const [factorId, setFactorId] = useState<string | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return; // StrictMode 이중 실행 방지 — enroll 중복 금지
    started.current = true;
    void (async () => {
      const supabase = createClient();
      // 중도 이탈로 남은 미검증 factor 정리 (반복 진입 시 누적·이름 충돌 방지)
      const { data: factors } = await supabase.auth.mfa.listFactors();
      for (const f of factors?.all ?? []) {
        if (f.status === "unverified") await supabase.auth.mfa.unenroll({ factorId: f.id });
      }
      const { data, error: enrollErr } = await supabase.auth.mfa.enroll({
        factorType: "totp",
        friendlyName: `admin-totp-${Date.now()}`,
        // 인증앱 계정 목록에 표시되는 발급자 이름 — 미지정 시 Supabase 프로젝트 URL이 노출됨
        issuer: "A11y Check",
      });
      if (enrollErr || !data) {
        setError(labels.errGeneric);
        return;
      }
      setFactorId(data.id);
      setQr(data.totp.qr_code);
      setSecret(data.totp.secret);
    })();
  }, [labels.errGeneric]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!factorId || busy) return;
    setBusy(true);
    setError(null);
    try {
      const supabase = createClient();
      const { error: vErr } = await supabase.auth.mfa.challengeAndVerify({ factorId, code: code.trim() });
      if (vErr) {
        setError(labels.errInvalidCode);
        setCode("");
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
      <p className="text-sm font-semibold">{labels.scanQr}</p>
      {qr ? (
        // Supabase가 주는 QR은 data:image/svg+xml URI — CSP img-src data: 로 허용됨
        // eslint-disable-next-line @next/next/no-img-element
        <img src={qr} alt="TOTP QR" width={176} height={176} className="mt-3 border-[1.5px] border-[var(--color-line)] bg-white p-2" />
      ) : (
        <p className="mt-3 text-sm text-[var(--color-ink-faint)]">…</p>
      )}
      {secret && (
        <p className="mt-3 text-xs text-[var(--color-ink-soft)]">
          {labels.secretLabel}{" "}
          <code className="select-all rounded bg-[var(--color-paper-warm)] px-1.5 py-0.5 font-bold">{secret}</code>
        </p>
      )}

      <label htmlFor="mfa-setup-code" className="mb-1 mt-5 block text-sm font-semibold">
        {labels.codeLabel}
      </label>
      <input
        id="mfa-setup-code"
        type="text"
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="[0-9]{6}"
        maxLength={6}
        required
        value={code}
        onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
        className="w-full rounded border-[1.5px] border-[var(--color-ink)] bg-[var(--color-paper)] px-3 py-2.5 text-center text-2xl font-bold tracking-[0.4em]"
      />
      <button
        type="submit"
        disabled={busy || code.length !== 6 || !factorId}
        className="mt-4 w-full rounded border-[1.5px] border-[var(--color-seal)] bg-[var(--color-seal)] px-4 py-2.5 font-bold text-[var(--color-paper)] hover:bg-[var(--color-seal-deep)] disabled:opacity-60"
      >
        {busy ? labels.working : labels.verify}
      </button>
      {error && (
        <p role="alert" className="mt-3 text-sm font-medium text-[var(--color-crit)]">
          {error}
        </p>
      )}
    </form>
  );
}
