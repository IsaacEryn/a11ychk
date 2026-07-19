"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

/**
 * 확장 연결 페이지 클라이언트.
 * 로그인된 사용자의 Supabase 세션(액세스 토큰·만료시각)을 확장 콘텐츠 스크립트에
 * window.postMessage로 전달한다. DOM에 토큰을 남기지 않아(과거 방식) 같은 페이지에
 * 주입된 다른 확장이 잔류물을 스크랩하는 표면을 없앤다. 사용자 본인의 토큰이며,
 * 콘텐츠 스크립트가 저장을 확인(saved)하면 즉시 메모리에서도 지운다.
 */
export function ConnectClient({
  email,
  labels,
}: {
  email: string;
  labels: { waiting: string; connected: string; notInstalled: string; account: string };
}) {
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    const origin = window.location.origin;
    let token: { accessToken: string; expiresAt: number; email: string } | null = null;
    let extReady = false;

    const post = () => {
      if (token && extReady) {
        window.postMessage({ __a11ychk: "token", payload: token }, origin);
      }
    };

    const onMessage = (e: MessageEvent) => {
      // 우리 오리진·우리 window에서 온 확장 메시지만 신뢰
      if (e.origin !== origin || e.source !== window) return;
      const data = e.data as { __a11ychk?: string } | null;
      if (data?.__a11ychk === "ext-ready") {
        extReady = true;
        post();
      } else if (data?.__a11ychk === "saved") {
        token = null; // 전달 완료 — 메모리에서 제거
        setConnected(true);
      }
    };
    window.addEventListener("message", onMessage);

    const supabase = createClient();
    supabase.auth.getSession().then(({ data }) => {
      const s = data.session;
      if (s) {
        token = { accessToken: s.access_token, expiresAt: (s.expires_at ?? 0) * 1000, email };
        post();
      }
    });

    return () => window.removeEventListener("message", onMessage);
  }, [email]);

  return (
    <div className="mt-8">
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
