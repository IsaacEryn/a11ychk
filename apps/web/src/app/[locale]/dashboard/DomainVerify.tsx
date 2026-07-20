"use client";

import { useActionState, useId, useState } from "react";
import { useTranslations } from "next-intl";
import { setupCloudflareDns, verifyDomain } from "@/lib/actions";
import { Notice } from "@/components/Notice";

/**
 * 도메인 소유 확인 인터랙션 — 미확인 도메인 카드에 렌더된다.
 * - "소유 확인" 버튼: useActionState로 확인 중/성공/실패/한도 결과를 즉시 안내
 * - Cloudflare 자동 설정: 토큰으로 TXT 레코드를 자동 생성 후 확인(접기형)
 */
export function DomainVerify({ domainId, atLimit, limit }: { domainId: string; atLimit: boolean; limit: number }) {
  const t = useTranslations("dashboard.domains");
  const [verifyState, verifyAction, verifying] = useActionState(verifyDomain, {} as Awaited<ReturnType<typeof verifyDomain>>);
  const [cfOpen, setCfOpen] = useState(false);

  return (
    <div className="mt-4 border-t border-dashed border-[var(--color-line)] pt-4">
      {/* 소유 확인 버튼 */}
      <form action={verifyAction} className="flex flex-wrap items-center gap-3">
        <input type="hidden" name="id" value={domainId} />
        <button
          type="submit"
          disabled={verifying}
          aria-busy={verifying}
          className="rounded border-[1.5px] border-[var(--color-seal)] bg-[var(--color-seal)] px-4 py-2 text-sm font-bold text-[var(--color-paper)] hover:bg-[var(--color-seal-deep)] disabled:opacity-60"
        >
          {verifying ? t("verifying") : t("verify")}
        </button>
        <span className="text-xs text-[var(--color-ink-faint)]">{t("verifyAfter")}</span>
      </form>

      {/* 확인 결과 */}
      {verifyState.status === "failed" && (
        <Notice variant="warn" className="mt-3" title={t("verifyFailed")}>
          {t("verifyFailedHint")}
        </Notice>
      )}
      {verifyState.status === "limit" && (
        <Notice variant="warn" className="mt-3" title={t("verifyLimitTitle", { limit: verifyState.limit ?? limit })}>
          {t("verifyLimitDesc")}
        </Notice>
      )}
      {verifyState.status === "error" && (
        <Notice variant="error" className="mt-3">
          {t("verifyError")}
        </Notice>
      )}
      {verifyState.status === "verified" && (
        <Notice variant="success" className="mt-3">
          {t("verifySuccess")}
        </Notice>
      )}

      {/* Cloudflare 자동 설정 (접기형) — 한도 초과가 아닐 때만 노출 */}
      {!atLimit && (
        <div className="mt-3">
          <button
            type="button"
            onClick={() => setCfOpen((v) => !v)}
            aria-expanded={cfOpen}
            className="text-sm font-semibold text-[var(--color-seal)] underline underline-offset-4"
          >
            {t("cfToggle")}
          </button>
          {cfOpen && <CloudflareSetup domainId={domainId} />}
        </div>
      )}
    </div>
  );
}

function CloudflareSetup({ domainId }: { domainId: string }) {
  const t = useTranslations("dashboard.domains");
  const tokenId = useId();
  const [state, action, pending] = useActionState(setupCloudflareDns, {} as Awaited<ReturnType<typeof setupCloudflareDns>>);

  const errorKey: Record<string, string> = {
    zone_not_found: "cfZoneNotFound",
    auth_error: "cfAuthError",
    api_error: "cfApiError",
    invalid: "cfInvalid",
    error: "cfApiError",
  };

  return (
    <div className="mt-3 rounded border-[1.5px] border-[var(--color-line)] bg-[var(--color-paper-warm)] p-4">
      <p className="text-sm font-bold text-[var(--color-ink)]">{t("cfTitle")}</p>
      <p className="mt-1 text-sm text-[var(--color-ink-soft)]">{t("cfDesc")}</p>
      <form action={action} className="mt-3">
        <input type="hidden" name="id" value={domainId} />
        <label htmlFor={tokenId} className="mb-1 block text-sm font-semibold">
          {t("cfTokenLabel")}
        </label>
        <input
          id={tokenId}
          name="cfToken"
          type="password"
          required
          autoComplete="off"
          spellCheck={false}
          placeholder={t("cfTokenPlaceholder")}
          className="w-full rounded border-[1.5px] border-[var(--color-ink)] bg-[var(--color-paper)] px-3 py-2 font-mono text-sm"
        />
        <p className="mt-1 text-xs text-[var(--color-ink-faint)]">
          {t("cfTokenHelp")}{" "}
          <a
            href="https://dash.cloudflare.com/profile/api-tokens"
            target="_blank"
            rel="noopener noreferrer"
            className="font-semibold text-[var(--color-seal)] underline underline-offset-2"
          >
            {t("cfTokenCreate")}
          </a>
        </p>
        <button
          type="submit"
          disabled={pending}
          aria-busy={pending}
          className="mt-3 rounded border-[1.5px] border-[var(--color-seal)] px-4 py-2 text-sm font-bold text-[var(--color-seal)] hover:bg-[var(--color-seal-tint)] disabled:opacity-60"
        >
          {pending ? t("cfSubmitting") : t("cfSubmit")}
        </button>
      </form>

      {state.status === "verified" && (
        <Notice variant="success" className="mt-3">
          {t("verifySuccess")}
        </Notice>
      )}
      {state.status === "done" && (
        <Notice variant="info" className="mt-3">
          {t("cfDone")}
        </Notice>
      )}
      {state.status === "limit" && (
        <Notice variant="warn" className="mt-3" title={t("verifyLimitTitle", { limit: state.limit ?? 0 })}>
          {t("verifyLimitDesc")}
        </Notice>
      )}
      {state.status && errorKey[state.status] && (
        <Notice variant="error" className="mt-3">
          {t(errorKey[state.status])}
        </Notice>
      )}
    </div>
  );
}
