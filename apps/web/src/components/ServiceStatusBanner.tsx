"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { useTranslations } from "next-intl";
import { SERVICE_DEGRADED_EVENT } from "@/lib/serviceStatus";

/** 장애 중 자동 복구 확인 주기(ms). 정상 상태에서는 아무 폴링도 하지 않는다. */
const RECOVERY_INTERVAL_MS = 12_000;

/** 브라우저 온라인 상태 구독 — useSyncExternalStore로 setState-in-effect 없이 안전하게 반영 */
function subscribeOnline(callback: () => void): () => void {
  window.addEventListener("online", callback);
  window.addEventListener("offline", callback);
  return () => {
    window.removeEventListener("online", callback);
    window.removeEventListener("offline", callback);
  };
}
const getOnlineSnapshot = () => navigator.onLine;
const getOnlineServerSnapshot = () => true; // 서버에서는 온라인으로 가정(하이드레이션 일치)

/**
 * 전역 서비스 상태 배너 — 상단에 붙어 장애 상황을 친절히 안내한다.
 *
 * - **오프라인**: 브라우저 online/offline 상태 구독(네트워크 비용 0).
 * - **서비스 장애(degraded)**: 앱 어딘가의 API 호출이 5xx/네트워크 실패로 무너지면
 *   `notifyServiceDegraded()`가 쏘는 이벤트를 받아 배너를 띄운다.
 * - **자동 복구**: 배너가 떠 있는 동안에만 /api/health를 주기적으로 확인해 복구되면 스스로 사라진다.
 *
 * 정상 상태에서는 이벤트 구독만 있고 요청을 보내지 않는다 → 상시 부하 0.
 */
export function ServiceStatusBanner() {
  const t = useTranslations("serviceStatus");
  const isOnline = useSyncExternalStore(subscribeOnline, getOnlineSnapshot, getOnlineServerSnapshot);
  const [degraded, setDegraded] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [checking, setChecking] = useState(false);

  // 오프라인이 더 근본 원인 → offline 우선, 그다음 degraded
  const mode: "offline" | "degraded" | null = !isOnline ? "offline" : degraded ? "degraded" : null;

  // 헬스 확인 — 정상이면 degraded 해제. 실패해도 조용히 유지(다음 주기/이벤트가 재시도).
  const checkHealth = useCallback(async (): Promise<boolean> => {
    try {
      const res = await fetch("/api/health", { cache: "no-store" });
      if (res.ok) {
        setDegraded(false);
        return true;
      }
    } catch {
      // 여전히 장애 — 유지
    }
    return false;
  }, []);

  // 서비스 장애 신호 구독 (마운트 1회)
  useEffect(() => {
    const onDegraded = () => {
      setDismissed(false);
      setDegraded(true);
    };
    window.addEventListener(SERVICE_DEGRADED_EVENT, onDegraded);
    return () => window.removeEventListener(SERVICE_DEGRADED_EVENT, onDegraded);
  }, []);

  // degraded 배너가 떠 있는 동안에만 자동 복구 폴링. 오프라인은 online 복귀 시 store가
  // 자동으로 배너를 걷어내므로(mode→null) 폴링하지 않는다. 복구되면 스스로 사라진다.
  useEffect(() => {
    if (mode !== "degraded") return;
    const id = setInterval(() => void checkHealth(), RECOVERY_INTERVAL_MS);
    return () => clearInterval(id);
  }, [mode, checkHealth]);

  const onRetry = useCallback(async () => {
    setChecking(true);
    await checkHealth();
    setChecking(false);
  }, [checkHealth]);

  if (mode === null || dismissed) return null;

  const isOffline = mode === "offline";

  return (
    // status/polite — assertive는 진행 중인 낭독을 강제 중단한다. 오프라인·장애 안내는
    // 긴급하지만 사용자가 이미 체감 중인 상황이라 polite로 충분하다(WCAG 모범 관행).
    <div
      role="status"
      aria-live="polite"
      className="border-b-[1.5px] border-[var(--color-crit)] bg-[var(--color-crit-tint)] text-[var(--color-ink)]"
    >
      <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-2.5 sm:px-6">
        <span
          aria-hidden="true"
          className="font-display flex h-5 w-5 flex-none items-center justify-center rounded-full border-[1.5px] border-[var(--color-crit)] text-xs font-extrabold text-[var(--color-crit)]"
        >
          !
        </span>
        <p className="min-w-0 flex-1 text-sm">
          <span className="font-bold">{isOffline ? t("offlineTitle") : t("degradedTitle")}</span>
          <span className="text-[var(--color-ink-soft)]"> — {isOffline ? t("offlineDesc") : t("degradedDesc")}</span>
        </p>
        <div className="flex flex-none items-center gap-2">
          <button
            type="button"
            onClick={onRetry}
            disabled={checking}
            className="rounded border-[1.5px] border-[var(--color-ink)] px-3 py-1 text-xs font-bold hover:bg-[var(--color-paper)] disabled:opacity-60"
          >
            {checking ? t("checking") : t("retry")}
          </button>
          <button
            type="button"
            onClick={() => setDismissed(true)}
            aria-label={t("dismiss")}
            className="rounded border-[1.5px] border-transparent px-2 py-1 text-sm font-bold text-[var(--color-ink-soft)] hover:border-[var(--color-line)]"
          >
            ✕
          </button>
        </div>
      </div>
    </div>
  );
}
