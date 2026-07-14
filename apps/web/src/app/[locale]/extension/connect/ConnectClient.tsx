"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

/**
 * 확장 연결 페이지 클라이언트.
 * 로그인된 사용자의 Supabase 세션(액세스 토큰·만료시각)을 #a11ychk-ext-payload에
 * JSON으로 렌더한다. 확장의 콘텐츠 스크립트가 이 값을 읽어 저장한다.
 * (이 페이지에서만 노출되며, 사용자 본인의 토큰이다.)
 */
export function ConnectClient({
  email,
  labels,
}: {
  email: string;
  labels: { waiting: string; connected: string; notInstalled: string; account: string };
}) {
  const [payload, setPayload] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getSession().then(({ data }) => {
      const s = data.session;
      if (s) {
        setPayload(
          JSON.stringify({
            accessToken: s.access_token,
            expiresAt: (s.expires_at ?? 0) * 1000,
            email,
          }),
        );
      }
    });

    const onConnected = () => setConnected(true);
    document.addEventListener("a11ychk-ext-connected", onConnected);
    return () => document.removeEventListener("a11ychk-ext-connected", onConnected);
  }, [email]);

  // 페이로드가 준비되면 확장 콘텐츠 스크립트에 알림 (콘텐츠 스크립트는 이 이벤트를 듣고 토큰을 읽어감)
  useEffect(() => {
    if (payload) document.dispatchEvent(new CustomEvent("a11ychk-ext-payload-ready"));
  }, [payload]);

  return (
    <div className="mt-8">
      {/* 콘텐츠 스크립트가 읽는 페이로드 (숨김 · 클라이언트에서만 채워짐, SSR HTML엔 없음) */}
      <div id="a11ychk-ext-payload" hidden suppressHydrationWarning>
        {payload ?? ""}
      </div>
      <span id="a11ychk-ext-status" hidden />

      <div
        className={`doc-card flex items-center gap-3 p-5 ${connected ? "border-[var(--color-seal)]" : ""}`}
        aria-live="polite"
      >
        <span
          className={`inline-block h-3 w-3 rounded-full ${connected ? "bg-[var(--color-seal)]" : "bg-[var(--color-line)]"}`}
          aria-hidden="true"
        />
        <div>
          <p className="font-bold">{connected ? labels.connected : labels.waiting}</p>
          <p className="text-sm text-[var(--color-ink-faint)]">
            {labels.account}: {email}
          </p>
        </div>
      </div>
      {!connected && <p className="mt-3 text-sm text-[var(--color-ink-faint)]">{labels.notInstalled}</p>}
    </div>
  );
}
