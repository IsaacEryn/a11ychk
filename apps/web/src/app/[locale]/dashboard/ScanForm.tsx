"use client";

import { useState } from "react";
import { useRouter } from "@/i18n/navigation";

export function ScanForm({
  locale,
  labels,
}: {
  locale: string;
  labels: { label: string; placeholder: string; submit: string; submitting: string };
}) {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/scans", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const data = (await res.json()) as { id?: string; error?: string };
      if (!res.ok || !data.id) {
        setError(data.error ?? "요청에 실패했습니다.");
        setSubmitting(false);
        return;
      }
      router.push(`/scans/${data.id}`);
    } catch {
      setError("네트워크 오류가 발생했습니다.");
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="mt-4">
      <label htmlFor="scan-url" className="mb-1 block text-sm font-semibold">
        {labels.label}
      </label>
      <div className="flex flex-wrap gap-2">
        <input
          id="scan-url"
          type="url"
          required
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder={labels.placeholder}
          autoComplete="url"
          aria-describedby={error ? "scan-url-error" : undefined}
          className="min-w-60 flex-1 rounded border-[1.5px] border-[var(--color-ink)] bg-[var(--color-paper)] px-3 py-2.5"
        />
        <button
          type="submit"
          disabled={submitting}
          className="rounded border-[1.5px] border-[var(--color-seal)] bg-[var(--color-seal)] px-5 py-2.5 font-bold text-[var(--color-paper)] hover:bg-[var(--color-seal-deep)] disabled:opacity-60"
        >
          {submitting ? labels.submitting : labels.submit}
        </button>
      </div>
      {error && (
        <p id="scan-url-error" role="alert" className="mt-2 text-sm font-medium text-[var(--color-crit)]">
          {error}
        </p>
      )}
      {/* 로케일은 라우터가 관리 — prop은 향후 확장용 */}
      <input type="hidden" name="locale" value={locale} />
    </form>
  );
}
