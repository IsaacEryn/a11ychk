"use client";

import { useEffect, useRef } from "react";

/**
 * Cloudflare Turnstile CAPTCHA 위젯.
 * NEXT_PUBLIC_TURNSTILE_SITE_KEY가 설정된 경우에만 렌더된다(미설정 시 no-op).
 * 인증 남용(메일 폭탄·계정 열거·무차별 대입) 방지 — Supabase가 서버에서
 * captchaToken을 검증하므로 클라이언트 우회가 불가능하다.
 */

interface TurnstileApi {
  render: (el: HTMLElement, opts: Record<string, unknown>) => string;
  reset: (id?: string) => void;
  remove: (id: string) => void;
}
declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

const SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
export const CAPTCHA_ENABLED = !!SITE_KEY;

let scriptPromise: Promise<void> | null = null;
function loadScript(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  if (window.turnstile) return Promise.resolve();
  if (!scriptPromise) {
    scriptPromise = new Promise<void>((resolve) => {
      const s = document.createElement("script");
      s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
      s.async = true;
      s.defer = true;
      s.onload = () => resolve();
      document.head.appendChild(s);
    });
  }
  return scriptPromise;
}

/** 전역 위젯 리셋 (제출 후 새 토큰 발급용) */
export function resetTurnstile() {
  if (typeof window !== "undefined") window.turnstile?.reset();
}

export function Turnstile({
  onVerify,
  onExpire,
}: {
  onVerify: (token: string) => void;
  onExpire?: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const widgetId = useRef<string | null>(null);

  useEffect(() => {
    if (!SITE_KEY || !ref.current) return;
    let cancelled = false;
    void loadScript().then(() => {
      if (cancelled || !ref.current || !window.turnstile) return;
      widgetId.current = window.turnstile.render(ref.current, {
        sitekey: SITE_KEY,
        callback: (token: string) => onVerify(token),
        "expired-callback": () => onExpire?.(),
        "error-callback": () => onExpire?.(),
      });
    });
    return () => {
      cancelled = true;
      if (widgetId.current && window.turnstile) {
        try {
          window.turnstile.remove(widgetId.current);
        } catch {
          /* 무시 */
        }
      }
    };
    // 위젯은 마운트 시 1회만 렌더 (콜백은 안정적인 setState)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!SITE_KEY) return null;
  // role="group" — 일반 div에는 aria-label을 쓸 수 없음 (aria-prohibited-attr)
  // 위젯은 ~300px 고정폭 → 좁은 카드(소형 모바일)에서 넘치지 않게 가로 스크롤 컨테이너로 감싼다.
  return <div ref={ref} role="group" className="mt-3 max-w-full overflow-x-auto" aria-label="보안 확인" />;
}
