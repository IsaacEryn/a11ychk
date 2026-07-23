"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { Turnstile, CAPTCHA_ENABLED, resetTurnstile } from "@/components/Turnstile";
import { appFetch } from "@/lib/serviceStatus";

/** /api/teaser-scan 응답(서버에서 로컬라이즈·트리밍 완료 — 규칙당 위치 1개만 옴) */
interface TeaserRule {
  ruleId: string;
  title: string;
  impact: "critical" | "serious" | "moderate" | "minor";
  wcag: string[];
  kwcag: string[];
  guideFirst: string;
  nodeCount: number;
  sample: { selector: string; html: string } | null;
}
interface TeaserResult {
  rate: number;
  byImpact: Record<TeaserRule["impact"], number>;
  ruleCount: number;
  totalNodes: number;
  rules: TeaserRule[];
  cached: boolean;
}

const IMPACTS = ["critical", "serious", "moderate", "minor"] as const;
const IMPACT_COLOR: Record<TeaserRule["impact"], string> = {
  critical: "var(--color-crit)",
  serious: "var(--color-crit)",
  moderate: "var(--color-ink-soft)",
  minor: "var(--color-ink-soft)",
};

/**
 * 비로그인 맛보기 검사 — URL 1개를 즉석 검사해 같은 자리에서 결과를 보여준다.
 * 결과는 저장되지 않으며(고지), 위반 위치는 규칙당 1개만 표시된다(나머지는 가입 후).
 */
export function TeaserScanForm() {
  const t = useTranslations("landing.teaser");
  const locale = useLocale() === "en" ? "en" : "ko";
  const [url, setUrl] = useState("");
  const [token, setToken] = useState<string | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [errorCode, setErrorCode] = useState<string>("");
  const [result, setResult] = useState<TeaserResult | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (status === "loading") return;
    setStatus("loading");
    setErrorCode("");
    setResult(null);
    try {
      const res = await appFetch("/api/teaser-scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: url.trim(), token: token ?? undefined, locale }),
      });
      const data = (await res.json()) as (TeaserResult & { code?: never }) | { code: string };
      if (!res.ok || "code" in data) {
        setErrorCode(("code" in data && data.code) || "scanFailed");
        setStatus("error");
      } else {
        setResult(data);
        setStatus("done");
      }
    } catch {
      setErrorCode("network");
      setStatus("error");
    } finally {
      // Turnstile 토큰은 1회용 — 성공·실패 무관 재발급
      if (CAPTCHA_ENABLED) {
        setToken(null);
        resetTurnstile();
      }
    }
  }

  const errorKeys = ["invalidUrl", "captcha", "ipLimit", "globalCap", "robots", "scanFailed", "unavailable", "network"];
  const errorKey = errorKeys.includes(errorCode) ? errorCode : "scanFailed";

  return (
    <section aria-labelledby="teaser-heading" className="py-10">
      <div className="doc-card p-6 sm:p-8">
        <h2 id="teaser-heading" className="font-display text-2xl font-bold">
          {t("title")}
        </h2>
        <p className="mt-2 text-[var(--color-ink-soft)]">{t("desc")}</p>

        <form onSubmit={onSubmit} className="mt-5">
          <div className="flex flex-wrap gap-3">
            <label htmlFor="teaser-url" className="sr-only">
              {t("urlLabel")}
            </label>
            <input
              id="teaser-url"
              type="url"
              required
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder={t("urlPlaceholder")}
              className="min-w-0 flex-1 rounded border-[1.5px] border-[var(--color-ink)] bg-[var(--color-paper)] px-4 py-3 text-base"
            />
            <button
              type="submit"
              disabled={status === "loading" || (CAPTCHA_ENABLED && !token)}
              className="rounded border-[1.5px] border-[var(--color-seal)] bg-[var(--color-seal)] px-6 py-3 text-base font-bold text-[var(--color-paper)] shadow-[4px_4px_0_0_var(--color-line)] hover:bg-[var(--color-seal-deep)] disabled:opacity-60"
            >
              {status === "loading" ? t("loading") : t("submit")}
            </button>
          </div>
          <Turnstile onVerify={setToken} onExpire={() => setToken(null)} />
          <p className="mt-2 text-xs text-[var(--color-ink-faint)]">{t("notSaved")}</p>
        </form>

        {/* 진행·오류 안내 (SR 포함) */}
        <p role="status" aria-live="polite" className="mt-3 text-sm font-semibold">
          {status === "loading" && t("loadingNote")}
          {status === "error" && <span className="text-[var(--color-crit)]">{t(`errors.${errorKey}`)}</span>}
          {(errorCode === "ipLimit" || errorCode === "globalCap") && (
            <Link href="/login" className="ml-2 font-bold text-[var(--color-seal)] underline underline-offset-4">
              {t("signupCta")}
            </Link>
          )}
        </p>

        {/* 결과 */}
        {status === "done" && result && (
          <div className="mt-6 border-t-[1.5px] border-[var(--color-ink)] pt-6">
            {result.cached && <p className="text-xs text-[var(--color-ink-faint)]">{t("cachedNote")}</p>}
            <div className="flex flex-wrap items-end gap-x-8 gap-y-4">
              <div>
                <span className="font-display text-6xl font-extrabold text-[var(--color-seal)]">{result.rate}</span>
                <span className="text-xl font-bold text-[var(--color-seal)]">%</span>
                <span className="ml-2 text-sm text-[var(--color-ink-faint)]">{t("rateLabel")}</span>
              </div>
              <ul className="flex flex-wrap gap-x-5 gap-y-1 text-sm">
                {IMPACTS.map((k) => (
                  <li key={k}>
                    <span>{t(`impact.${k}`)}</span>{" "}
                    <span className="font-bold tabular-nums" style={{ color: IMPACT_COLOR[k] }}>
                      {result.byImpact[k]}
                    </span>
                  </li>
                ))}
              </ul>
            </div>

            {result.rules.length === 0 ? (
              <p className="mt-5 font-semibold text-[var(--color-seal)]">{t("noViolations")}</p>
            ) : (
              <ul className="mt-5 space-y-3">
                {result.rules.map((r) => (
                  <li key={r.ruleId} className="border-[1.5px] border-[var(--color-line)] p-4">
                    <p className="font-semibold">
                      <span
                        className="mr-2 rounded-full px-2 py-0.5 text-xs font-bold text-[var(--color-paper)]"
                        style={{ background: IMPACT_COLOR[r.impact] }}
                      >
                        {t(`impact.${r.impact}`)}
                      </span>
                      {r.title}
                    </p>
                    <p className="mt-1 text-xs text-[var(--color-ink-faint)]">
                      {t("nodeCount", { count: r.nodeCount })}
                      {r.wcag.length > 0 && ` · WCAG ${r.wcag.join(", ")}`}
                      {r.kwcag.length > 0 && ` · KWCAG ${r.kwcag.join(", ")}`}
                    </p>
                    {r.sample && (
                      <div className="mt-2 text-xs">
                        {/* 위반 코드 스니펫은 반드시 텍스트 노드로만 렌더 (XSS 방지) */}
                        <code className="block truncate rounded bg-[var(--color-paper-warm)] px-2 py-1">{r.sample.selector}</code>
                        <code className="mt-1 block truncate rounded bg-[var(--color-paper-warm)] px-2 py-1">{r.sample.html}</code>
                        {r.nodeCount > 1 && (
                          <p className="mt-1 font-semibold text-[var(--color-ink-soft)]">
                            {t("moreNodes", { count: r.nodeCount - 1 })}
                          </p>
                        )}
                      </div>
                    )}
                    {r.guideFirst && (
                      <details className="mt-2 text-sm">
                        <summary className="cursor-pointer font-semibold text-[var(--color-seal)]">{t("guideToggle")}</summary>
                        <p className="mt-1 text-[var(--color-ink-soft)]">{r.guideFirst}</p>
                      </details>
                    )}
                  </li>
                ))}
              </ul>
            )}

            {/* 가입 유도 — 잠긴 기능 안내 */}
            <div className="mt-6 border-l-[3px] border-[var(--color-seal)] bg-[var(--color-seal-tint)] px-4 py-3">
              <p className="font-semibold">{t("lockedTitle")}</p>
              <p className="mt-1 text-sm text-[var(--color-ink-soft)]">{t("lockedFeatures")}</p>
              <Link
                href="/login"
                className="mt-3 inline-block rounded border-[1.5px] border-[var(--color-seal)] bg-[var(--color-seal)] px-5 py-2 font-bold text-[var(--color-paper)] hover:bg-[var(--color-seal-deep)]"
              >
                {t("signupCta")}
              </Link>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
