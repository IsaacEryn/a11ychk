"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter, Link } from "@/i18n/navigation";
import { createClient } from "@/lib/supabase/client";
import { appFetch, notifyServiceDegraded } from "@/lib/serviceStatus";
import { classifyScanError } from "@/lib/scanError";
import { StatusBadge } from "@/components/StatusBadge";
import { RerunScanButton } from "./report/RescanButtons";

interface PageRow {
  id: string;
  url: string;
  status: string;
  violation_counts: Record<string, number> | null;
}

interface Labels {
  statusLive: string;
  pagesTitle: string;
  viewReport: string;
  failedTitle: string;
  backToDashboard: string;
  runningDesc: string;
  status: Record<"queued" | "running" | "done" | "failed", string>;
}

interface QueueInfo {
  ahead: number;
  estMinutes: number;
}

// 폴링 백오프 — 대기가 길어질수록 간격을 늘려 DB 폴링 부하를 낮춘다(장애 상황의 양의 피드백 차단).
const POLL_MIN_MS = 2500;
const POLL_MAX_MS = 12_000;
const POLL_FACTOR = 1.3;

export function ScanProgress({
  scanId,
  initialStatus,
  initialError,
  labels,
}: {
  scanId: string;
  initialStatus: string;
  initialError: string | null;
  labels: Labels;
}) {
  const router = useRouter();
  const tq = useTranslations("scan.queued");
  const tp = useTranslations("scan.progress");
  const tReason = useTranslations("report.failedPages.reasons");
  const [status, setStatus] = useState(initialStatus);
  const [error, setError] = useState(initialError);
  const [pages, setPages] = useState<PageRow[]>([]);
  const [queue, setQueue] = useState<QueueInfo | null>(null);
  // 경과 시간 — "멈춘 건가?"를 판단할 근거. 화면에 들어온 시점부터 잰다
  const [elapsedSec, setElapsedSec] = useState(0);

  const startedRef = useRef<number | null>(null);
  useEffect(() => {
    if (status === "done" || status === "failed") return;
    // 상태 전환(queued→running)에도 리셋되지 않게 최초 진입 시각을 고정
    startedRef.current ??= Date.now();
    const timer = setInterval(
      () => setElapsedSec(Math.floor((Date.now() - startedRef.current!) / 1000)),
      1000,
    );
    return () => clearInterval(timer);
  }, [status]);

  useEffect(() => {
    if (status === "done" || status === "failed") return;
    const supabase = createClient();
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let delay = POLL_MIN_MS; // 상태(effect dep)가 바뀌면 effect가 재실행돼 간격이 리셋된다

    const tick = async () => {
      // 어떤 실패에도 폴링은 반드시 재예약된다 — 조회가 throw하면(네트워크 단절 등)
      // 재예약이 끊겨 사용자가 무한 로딩에 갇히는 문제를 막는다. 실패 시 전역 장애
      // 배너 신호를 보내고, 다음 tick(백오프 상한 12s)이 자동 재시도한다.
      try {
        const [{ data: scan }, { data: pageRows }] = await Promise.all([
          supabase.from("scans").select("status, error").eq("id", scanId).maybeSingle(),
          supabase.from("scan_pages").select("id, url, status, violation_counts").eq("scan_id", scanId).order("url"),
        ]);
        if (cancelled) return;
        if (pageRows) setPages(pageRows as PageRow[]);
        if (scan) {
          setStatus(scan.status);
          setError(scan.error);
          if (scan.status === "done") {
            router.push(`/scans/${scanId}/report`);
            return;
          }
        }
        // queued면 대기열 현황(앞선 대기 수·예상 시간) 조회 — 소유자 게이트 엔드포인트
        if ((scan?.status ?? status) === "queued") {
          try {
            const res = await appFetch(`/api/scans/${scanId}/queue`, { cache: "no-store" });
            if (!cancelled && res.ok) {
              const q = (await res.json()) as { status?: string; ahead?: number; estMinutes?: number };
              setQueue(q.status === "queued" ? { ahead: q.ahead ?? 0, estMinutes: q.estMinutes ?? 0 } : null);
            }
          } catch {
            // 대기열 조회 실패는 무시 — 다음 tick에서 재시도 (장애 신호는 appFetch가 발사)
          }
        } else if (!cancelled) {
          setQueue(null);
        }
      } catch {
        notifyServiceDegraded();
      }
      if (cancelled) return;
      delay = Math.min(Math.round(delay * POLL_FACTOR), POLL_MAX_MS);
      timer = setTimeout(tick, delay);
    };

    tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [scanId, status, router]);

  const statusLabel = labels.status[status as keyof Labels["status"]] ?? status;
  const isQueued = status === "queued";
  const isRunning = status === "running";
  const aheadText = queue ? (queue.ahead > 0 ? tq("ahead", { n: queue.ahead }) : tq("aheadNone")) : null;
  const etaText = queue && queue.ahead > 0 ? tq("eta", { min: queue.estMinutes }) : null;
  const doneCount = pages.filter((p) => p.status === "done" || p.status === "failed").length;
  const elapsedText =
    elapsedSec >= 60 ? tp("elapsedMin", { min: Math.floor(elapsedSec / 60), sec: elapsedSec % 60 }) : tp("elapsedSec", { sec: elapsedSec });

  return (
    <div className="mt-8">
      {/* 스크린 리더에 상태 변화 알림 */}
      <div aria-live="polite" className="doc-card flex flex-wrap items-center gap-3 p-5">
        <StatusBadge status={status} label={statusLabel} />
        <span className="text-sm text-[var(--color-ink-soft)]">
          {status === "failed"
            ? labels.failedTitle
            : isQueued
              ? tq("desc")
              : pages.length === 0
                ? tp("collecting")
                : labels.runningDesc}
        </span>
        {(isQueued || isRunning) && (
          <span className="ml-auto text-xs tabular-nums text-[var(--color-ink-faint)]">{elapsedText}</span>
        )}
      </div>

      {/* 진행률 — 페이지가 잡히면 N/M과 막대로 (배지를 세지 않아도 되게) */}
      {isRunning && pages.length > 0 && (
        <div className="mt-4">
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-sm font-bold">{tp("bar")}</span>
            <span className="text-sm tabular-nums text-[var(--color-ink-soft)]">
              {tp("count", { done: doneCount, total: pages.length })}
            </span>
          </div>
          <div
            role="progressbar"
            aria-valuenow={doneCount}
            aria-valuemin={0}
            aria-valuemax={pages.length}
            aria-label={tp("bar")}
            className="mt-1.5 h-2.5 overflow-hidden rounded-full border border-[var(--color-line)] bg-[var(--color-paper-warm)]"
          >
            <div
              className="h-full bg-[var(--color-seal)] transition-[width]"
              style={{ width: `${Math.round((doneCount / pages.length) * 100)}%` }}
            />
          </div>
        </div>
      )}

      {/* 대기열 현황 — queued일 때만: 앞선 대기 수·예상 시간을 정직하게 안내 */}
      {isQueued && (
        <div className="mt-4 border-[1.5px] border-[var(--color-line)] bg-[var(--color-paper-warm)] p-4" aria-live="polite">
          <p className="font-bold">{tq("title")}</p>
          {aheadText ? (
            <p className="mt-1 text-sm text-[var(--color-ink-soft)]">
              {aheadText}
              {etaText && <span> · {etaText}</span>}
            </p>
          ) : (
            <p className="mt-1 text-sm text-[var(--color-ink-soft)]">{tq("starting")}</p>
          )}
        </div>
      )}

      {status === "failed" && (
        <div role="alert" className="mt-4 border-[1.5px] border-[var(--color-crit)] bg-[var(--color-crit-tint)] p-4">
          <p className="font-bold text-[var(--color-crit)]">{labels.failedTitle}</p>
          {/* 원문 에러 대신 분류된 친화 문구 — 원문은 관리자 로그에만 (페이지 단위 실패와 동일 기준) */}
          {error && <p className="mt-1 text-sm text-[var(--color-ink-soft)]">{tReason(classifyScanError(error))}</p>}
          {classifyScanError(error) === "blocked" && (
            <p className="mt-1 text-sm">
              <Link href="/access-check" className="font-semibold underline underline-offset-4">
                {tp("accessCheckLink")}
              </Link>
            </p>
          )}
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <RerunScanButton scanId={scanId} />
            <Link href="/dashboard" className="font-semibold underline underline-offset-4">
              {labels.backToDashboard}
            </Link>
          </div>
        </div>
      )}

      {pages.length > 0 && (
        <section className="mt-6" aria-label={labels.pagesTitle}>
          <h2 className="font-display text-lg font-bold">{labels.pagesTitle}</h2>
          <ul className="mt-3 divide-y divide-[var(--color-line)] border-y-[1.5px] border-[var(--color-ink)]">
            {pages.map((p) => {
              const total = p.violation_counts
                ? Object.values(p.violation_counts).reduce((a, b) => a + b, 0)
                : null;
              return (
                <li key={p.id} className="flex items-center gap-3 py-2.5">
                  <StatusBadge status={p.status} label={labels.status[p.status as keyof Labels["status"]] ?? p.status} />
                  <span className="min-w-0 flex-1 truncate text-sm">{p.url}</span>
                  {total !== null && p.status === "done" && (
                    <span className="text-sm font-bold tabular-nums text-[var(--color-ink-soft)]">{total}</span>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {status === "done" && (
        <Link
          href={`/scans/${scanId}/report`}
          className="mt-6 inline-block rounded border-[1.5px] border-[var(--color-seal)] bg-[var(--color-seal)] px-5 py-2.5 font-bold text-[var(--color-paper)]"
        >
          {labels.viewReport}
        </Link>
      )}
    </div>
  );
}
