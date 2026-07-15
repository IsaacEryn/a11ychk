"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";

/** 실패한 단일 페이지 재검사 — 완료되면 보고서를 새로고침해 재집계 결과 반영 */
export function RescanPageButton({ scanId, pageId }: { scanId: string; pageId: string }) {
  const t = useTranslations("report.rescan");
  const router = useRouter();
  const [state, setState] = useState<"idle" | "pending" | "error">("idle");
  const [message, setMessage] = useState<string | null>(null);

  async function onClick() {
    setState("pending");
    setMessage(null);
    try {
      const res = await fetch(`/api/scans/${scanId}/rescan-page`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pageId }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) {
        setState("error");
        setMessage(data.error ?? t("failed"));
        return;
      }
      router.refresh();
      setState("idle");
    } catch {
      setState("error");
      setMessage(t("failed"));
    }
  }

  return (
    <span className="no-print">
      <button
        type="button"
        onClick={onClick}
        disabled={state === "pending"}
        className="rounded border-[1.5px] border-[var(--color-seal)] px-2.5 py-1 text-xs font-bold text-[var(--color-seal)] hover:bg-[var(--color-seal-tint)] disabled:opacity-60"
      >
        {state === "pending" ? t("pagePending") : t("pageButton")}
      </button>
      {message && (
        <span role="alert" className="ml-2 text-xs font-semibold text-[var(--color-crit)]">
          {message}
        </span>
      )}
    </span>
  );
}

/** 동일 조건 전체 재검사 — 새 검사를 만들어 진행 페이지로 이동 */
export function RerunScanButton({ scanId }: { scanId: string }) {
  const t = useTranslations("report.rescan");
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function onClick() {
    setPending(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/scans/${scanId}/rerun`, { method: "POST" });
      const data = (await res.json()) as { id?: string; error?: string };
      if (!res.ok || !data.id) {
        setMessage(data.error ?? t("failed"));
        setPending(false);
        return;
      }
      router.push(`/scans/${data.id}`);
    } catch {
      setMessage(t("failed"));
      setPending(false);
    }
  }

  return (
    <span className="flex items-center gap-2">
      <button
        type="button"
        onClick={onClick}
        disabled={pending}
        className="rounded border-[1.5px] border-[var(--color-ink)] px-4 py-2 font-semibold hover:bg-[var(--color-paper-warm)] disabled:opacity-60"
      >
        {pending ? t("rerunPending") : t("rerunButton")}
      </button>
      {message && (
        <span role="alert" className="text-xs font-semibold text-[var(--color-crit)]">
          {message}
        </span>
      )}
    </span>
  );
}
