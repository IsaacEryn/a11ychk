"use client";

import { useMemo, useState } from "react";
import { useRouter } from "@/i18n/navigation";

export interface ScanFormLabels {
  label: string;
  placeholder: string;
  submit: string;
  submitting: string;
  advanced: string;
  target: string;
  targetHint: string;
  notes: string;
  notesPlaceholder: string;
  modeLegend: string;
  modeAuto: string;
  modeAutoDesc: string;
  modeManual: string;
  modeManualDesc: string;
  manualLabel: string;
  manualPlaceholder: string;
  manualCount: string; // "{count} / {max}"
  manualOriginHint: string;
  manualOverLimit: string; // "{max}"
  manualVerifyHint: string; // "{verified}"
  manualHostMismatch: string; // "{host}"
  /** 서버 에러 코드 → 번역 템플릿 ({limit} {count} {url} 플레이스홀더) */
  errors: Record<string, string>;
}

/** 메시지 템플릿의 {key} 플레이스홀더를 모두 치환 (replace는 첫 항목만 바꿔 버그가 됐었음) */
function fill(template: string, vars: Record<string, string | number>): string {
  return Object.entries(vars).reduce((s, [k, v]) => s.replaceAll(`{${k}}`, String(v)), template);
}

export function ScanForm({
  verifiedSize,
  unverifiedSize,
  verifiedHostnames,
  labels,
}: {
  verifiedSize: number;
  unverifiedSize: number;
  verifiedHostnames: string[];
  labels: ScanFormLabels;
}) {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [mode, setMode] = useState<"auto" | "manual">("auto");
  const [pagesText, setPagesText] = useState("");
  const [target, setTarget] = useState<"A" | "AA" | "AAA">("AA");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const manualPages = useMemo(
    () =>
      pagesText
        .split(/\r?\n/)
        .map((s) => s.trim())
        .filter(Boolean),
    [pagesText],
  );

  // 검사 주소의 호스트 (미입력·잘못된 URL이면 null)
  const rootHost = useMemo(() => {
    try {
      return new URL(url).hostname.toLowerCase();
    } catch {
      return null;
    }
  }, [url]);

  // 입력한 URL의 도메인이 소유 확인된 도메인이면 더 큰 한도 적용
  const maxPages = useMemo(
    () => (rootHost && verifiedHostnames.includes(rootHost) ? verifiedSize : unverifiedSize),
    [rootHost, verifiedHostnames, verifiedSize, unverifiedSize],
  );

  // 직접 입력 페이지 중 검사 주소와 호스트가 다르거나 URL이 아닌 줄 (서버도 거부하므로 폼에서 미리 알림)
  const invalidLines = useMemo(() => {
    if (mode !== "manual" || !rootHost) return [];
    return manualPages.filter((line) => {
      try {
        return new URL(line).hostname.toLowerCase() !== rootHost;
      } catch {
        return true;
      }
    });
  }, [mode, manualPages, rootHost]);

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
          pages: mode === "manual" ? manualPages.slice(0, maxPages) : undefined,
          scope: { conformanceTarget: target, notes: notes.trim() || undefined },
        }),
      });
      const data = (await res.json()) as {
        id?: string;
        error?: string;
        code?: string;
        params?: Record<string, string | number>;
      };
      if (!res.ok || !data.id) {
        // 코드가 있으면 로케일 번역 템플릿 사용, 없으면 서버 문자열 폴백
        const template = data.code ? labels.errors[data.code] : undefined;
        setError(template ? fill(template, data.params ?? {}) : (data.error ?? labels.errors.generic));
        setSubmitting(false);
        return;
      }
      router.push(`/scans/${data.id}`);
    } catch {
      setError(labels.errors.network);
      setSubmitting(false);
    }
  }

  const overLimit = mode === "manual" && manualPages.length > maxPages;

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
          disabled={submitting || (mode === "manual" && (manualPages.length === 0 || overLimit || invalidLines.length > 0))}
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

      {/* 표본 수집 방식 */}
      <fieldset className="mt-4">
        <legend className="mb-2 text-sm font-semibold">{labels.modeLegend}</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {(
            [
              { id: "auto", label: labels.modeAuto, desc: labels.modeAutoDesc },
              { id: "manual", label: labels.modeManual, desc: labels.modeManualDesc },
            ] as const
          ).map((opt) => (
            <label
              key={opt.id}
              className={`flex cursor-pointer items-start gap-2.5 rounded border-[1.5px] p-3 ${
                mode === opt.id ? "border-[var(--color-seal)] bg-[var(--color-seal-tint)]" : "border-[var(--color-line)]"
              }`}
            >
              <input
                type="radio"
                name="sample-mode"
                value={opt.id}
                checked={mode === opt.id}
                onChange={() => setMode(opt.id)}
                className="mt-1 h-4 w-4 accent-[var(--color-seal)]"
              />
              <span>
                <span className="block text-sm font-bold">{opt.label}</span>
                <span className="block text-xs text-[var(--color-ink-soft)]">{opt.desc}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      {mode === "manual" && (
        <div className="mt-3">
          <div className="mb-1 flex items-baseline justify-between">
            <label htmlFor="manual-pages" className="text-sm font-semibold">
              {labels.manualLabel}
            </label>
            <span
              className={`text-xs font-bold tabular-nums ${overLimit ? "text-[var(--color-crit)]" : "text-[var(--color-ink-faint)]"}`}
              aria-live="polite"
            >
              {fill(labels.manualCount, { count: manualPages.length, max: maxPages })}
            </span>
          </div>
          <textarea
            id="manual-pages"
            value={pagesText}
            onChange={(e) => setPagesText(e.target.value)}
            rows={6}
            placeholder={labels.manualPlaceholder}
            aria-describedby={`manual-pages-hint${invalidLines.length > 0 ? " manual-pages-host-error" : ""}`}
            className={`w-full rounded border-[1.5px] bg-[var(--color-paper)] px-3 py-2 font-mono text-sm ${
              overLimit || invalidLines.length > 0 ? "border-[var(--color-crit)]" : "border-[var(--color-ink)]"
            }`}
          />
          <p id="manual-pages-hint" className="mt-1 text-xs text-[var(--color-ink-faint)]">
            {labels.manualOriginHint}
          </p>
          {invalidLines.length > 0 && (
            <div
              id="manual-pages-host-error"
              role="alert"
              aria-live="polite"
              className="mt-1.5 text-xs font-semibold text-[var(--color-crit)]"
            >
              <p>{fill(labels.manualHostMismatch, { host: rootHost ?? "" })}</p>
              <ul className="mt-1 list-disc pl-5 font-mono font-normal">
                {invalidLines.map((line) => (
                  <li key={line} className="break-all">
                    {line}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {overLimit && (
            <p role="alert" className="mt-1.5 text-xs font-semibold text-[var(--color-crit)]">
              {fill(labels.manualOverLimit, { max: maxPages })}
              {maxPages < verifiedSize && ` ${fill(labels.manualVerifyHint, { verified: verifiedSize })}`}
            </p>
          )}
        </div>
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
    </form>
  );
}
