"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { appFetch } from "@/lib/serviceStatus";

/**
 * PDF 다운로드 — 서버가 헤드리스 브라우저로 렌더하느라 수십 초 걸릴 수 있어
 * 단순 <a>로는 "죽은 링크"처럼 보였다(재클릭 → 브라우저 중복 구동). fetch+blob으로
 * 진행 상태를 보여주고, 실패는 JSON 오류 화면으로 이동하는 대신 인라인으로 알린다.
 */
export function PdfButton({ href, filename }: { href: string; filename: string }) {
  const t = useTranslations("report.pdf");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function download() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await appFetch(href);
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(data?.error ?? t("failed"));
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      setError(t("failed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        onClick={download}
        disabled={busy}
        aria-busy={busy}
        className="rounded border-[1.5px] border-[var(--color-seal)] bg-[var(--color-seal)] px-4 py-2 font-semibold text-[var(--color-paper)] hover:bg-[var(--color-seal-deep)] disabled:opacity-60"
      >
        {busy ? t("generating") : t("download")}
      </button>
      {/* 생성 중 안내 — SR에도 상태 전달 */}
      <span aria-live="polite" className="text-xs text-[var(--color-ink-faint)]">
        {busy ? t("generatingHint") : ""}
      </span>
      {error && (
        <span role="alert" className="text-xs font-semibold text-[var(--color-crit)]">
          {error}
        </span>
      )}
    </span>
  );
}
