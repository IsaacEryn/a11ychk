"use client";

import { useEffect, useState } from "react";
import { useRouter, Link } from "@/i18n/navigation";
import { createClient } from "@/lib/supabase/client";
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

const POLL_MS = 2500;

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
  const [status, setStatus] = useState(initialStatus);
  const [error, setError] = useState(initialError);
  const [pages, setPages] = useState<PageRow[]>([]);

  useEffect(() => {
    if (status === "done" || status === "failed") return;
    const supabase = createClient();
    let cancelled = false;

    const tick = async () => {
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
        }
      }
    };

    tick();
    const timer = setInterval(tick, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [scanId, status, router]);

  const statusLabel = labels.status[status as keyof Labels["status"]] ?? status;

  return (
    <div className="mt-8">
      {/* 스크린 리더에 상태 변화 알림 */}
      <div aria-live="polite" className="doc-card flex items-center gap-3 p-5">
        <StatusBadge status={status} label={statusLabel} />
        <span className="text-sm text-[var(--color-ink-soft)]">
          {status === "failed" ? labels.failedTitle : labels.runningDesc}
        </span>
      </div>

      {status === "failed" && (
        <div role="alert" className="mt-4 border-[1.5px] border-[var(--color-crit)] bg-[var(--color-crit-tint)] p-4">
          <p className="font-bold text-[var(--color-crit)]">{labels.failedTitle}</p>
          {error && <p className="mt-1 text-sm text-[var(--color-ink-soft)]">{error}</p>}
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
