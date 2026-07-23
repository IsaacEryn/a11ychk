"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { appFetch } from "@/lib/serviceStatus";
import type { AccessCheckResult, AccessVerdict } from "@a11ychk/core/catalog";

const VERDICT_STYLE: Record<AccessVerdict, string> = {
  ok: "border-[var(--color-seal)] bg-[var(--color-seal-tint)] text-[var(--color-pass)]",
  "robots-blocked": "border-[var(--color-crit)] bg-[var(--color-crit-tint)] text-[var(--color-crit)]",
  "ua-blocked": "border-[var(--color-crit)] bg-[var(--color-crit-tint)] text-[var(--color-crit)]",
  challenge: "border-[var(--color-crit)] bg-[var(--color-crit-tint)] text-[var(--color-crit)]",
  "http-error": "border-[var(--color-line)] bg-[var(--color-warn-tint)] text-[var(--color-ink)]",
  unreachable: "border-[var(--color-line)] bg-[var(--color-warn-tint)] text-[var(--color-ink)]",
};

export function AccessCheckClient() {
  const t = useTranslations("accessCheck");
  const tScan = useTranslations("scanPage");
  const apiErrorLabels = tScan.raw("apiErrors") as Record<string, string>;
  const [url, setUrl] = useState("");
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AccessCheckResult | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setChecking(true);
    setError(null);
    setResult(null);
    try {
      const res = await appFetch("/api/access-check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const data = (await res.json()) as AccessCheckResult & { error?: string; code?: string };
      if (!res.ok) {
        // 서버 code 우선 번역, 서버 문자열 폴백 (ScanForm 패턴)
        setError((data.code && apiErrorLabels[data.code]) || data.error || t("failed"));
      } else {
        setResult(data);
      }
    } catch {
      setError(t("failed"));
    } finally {
      setChecking(false);
    }
  }

  return (
    <div>
      <form onSubmit={onSubmit} className="mt-6">
        <label htmlFor="ac-url" className="mb-1 block text-sm font-semibold">
          {t("urlLabel")}
        </label>
        <div className="flex flex-wrap gap-2">
          <input
            id="ac-url"
            type="url"
            required
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://example.com"
            autoComplete="url"
            className="min-w-60 flex-1 rounded border-[1.5px] border-[var(--color-ink)] bg-[var(--color-paper)] px-3 py-2.5"
          />
          <button
            type="submit"
            disabled={checking}
            className="rounded border-[1.5px] border-[var(--color-seal)] bg-[var(--color-seal)] px-5 py-2.5 font-bold text-[var(--color-paper)] hover:bg-[var(--color-seal-deep)] disabled:opacity-60"
          >
            {checking ? t("checking") : t("check")}
          </button>
        </div>
      </form>

      {error && (
        <p role="alert" className="mt-3 text-sm font-medium text-[var(--color-crit)]">
          {error}
        </p>
      )}

      {result && (
        <section aria-live="polite" className="doc-card mt-6 p-6">
          <span className={`inline-block rounded border-[1.5px] px-3 py-1 font-bold ${VERDICT_STYLE[result.verdict]}`}>
            {t(`verdict.${result.verdict}.label`)}
          </span>
          <p className="mt-3 leading-relaxed">{t(`verdict.${result.verdict}.desc`)}</p>

          <dl className="mt-4 grid gap-x-8 gap-y-1.5 text-sm sm:grid-cols-2">
            <div className="flex gap-2">
              <dt className="font-bold">{t("detail.robots")}</dt>
              <dd className={result.robotsAllowed ? "text-[var(--color-pass)]" : "text-[var(--color-crit)]"}>
                {result.robotsAllowed ? t("detail.allowed") : t("detail.disallowed")}
              </dd>
            </div>
            {result.botStatus !== undefined && (
              <div className="flex gap-2">
                <dt className="font-bold">{t("detail.botStatus")}</dt>
                <dd className="tabular-nums">HTTP {result.botStatus}</dd>
              </div>
            )}
            {result.browserStatus !== undefined && (
              <div className="flex gap-2">
                <dt className="font-bold">{t("detail.browserStatus")}</dt>
                <dd className="tabular-nums">HTTP {result.browserStatus}</dd>
              </div>
            )}
            {result.challengeVendor && (
              <div className="flex gap-2">
                <dt className="font-bold">{t("detail.vendor")}</dt>
                <dd>{result.challengeVendor}</dd>
              </div>
            )}
          </dl>

          <div className="mt-5 border-t border-dashed border-[var(--color-line)] pt-4">
            <h3 className="font-bold">{t("solutionTitle")}</h3>
            <p className="mt-1.5 text-sm leading-relaxed text-[var(--color-ink-soft)]">
              {t(`verdict.${result.verdict}.solution`)}
            </p>
            {result.verdict !== "ok" && (
              <p className="mt-3 text-sm">
                <Link href="/extension/connect" className="font-bold text-[var(--color-seal)] underline underline-offset-4">
                  {t("extensionCta")}
                </Link>
              </p>
            )}
            {result.verdict === "ok" && (
              <p className="mt-3 text-sm">
                <Link href="/scan" className="font-bold text-[var(--color-seal)] underline underline-offset-4">
                  {t("scanCta")}
                </Link>
              </p>
            )}
          </div>
        </section>
      )}
    </div>
  );
}
