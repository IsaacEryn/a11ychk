"use client";

import { useState } from "react";
import { useRouter } from "@/i18n/navigation";

export function ScanForm({
  locale,
  labels,
}: {
  locale: string;
  labels: {
    label: string;
    placeholder: string;
    submit: string;
    submitting: string;
    advanced: string;
    target: string;
    targetHint: string;
    notes: string;
    notesPlaceholder: string;
  };
}) {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [target, setTarget] = useState<"A" | "AA" | "AAA">("AA");
  const [notes, setNotes] = useState("");
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
        body: JSON.stringify({
          url,
          scope: { conformanceTarget: target, notes: notes.trim() || undefined },
        }),
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

      {/* WCAG-EM Step 1 — 평가 범위 (고급, 접기형) */}
      <details className="mt-3 border-[1.5px] border-dashed border-[var(--color-line)] p-3">
        <summary className="cursor-pointer text-sm font-semibold">{labels.advanced}</summary>
        <div className="mt-3 space-y-3">
          <div>
            <label htmlFor="scan-target" className="mb-1 block text-sm font-semibold">
              {labels.target}
            </label>
            <select
              id="scan-target"
              value={target}
              onChange={(e) => setTarget(e.target.value as "A" | "AA" | "AAA")}
              className="rounded border-[1.5px] border-[var(--color-ink)] bg-[var(--color-paper)] px-3 py-2 text-sm"
            >
              <option value="A">WCAG 2.2 A</option>
              <option value="AA">WCAG 2.2 AA</option>
              <option value="AAA">WCAG 2.2 AAA</option>
            </select>
            <p className="mt-1 text-xs text-[var(--color-ink-faint)]">{labels.targetHint}</p>
          </div>
          <div>
            <label htmlFor="scan-notes" className="mb-1 block text-sm font-semibold">
              {labels.notes}
            </label>
            <textarea
              id="scan-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              maxLength={2000}
              placeholder={labels.notesPlaceholder}
              className="w-full rounded border-[1.5px] border-[var(--color-line)] bg-[var(--color-paper)] px-3 py-2 text-sm"
            />
          </div>
        </div>
      </details>

      {/* 로케일은 라우터가 관리 — prop은 향후 확장용 */}
      <input type="hidden" name="locale" value={locale} />
    </form>
  );
}
