"use client";

import { useActionState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { toggleShareLink, type ShareState } from "@/lib/actions";
import { useCopyToClipboard } from "@/lib/useCopyToClipboard";

/**
 * 보고서 읽기 전용 공유 링크 토글 — 소유자 전용(화면 전용, 인쇄 제외).
 * 켜면 로그인 없이 볼 수 있는 링크가 발급되고, 끄면 즉시 무효화된다.
 */
export function ShareLinkButton({ scanId, initialToken }: { scanId: string; initialToken: string | null }) {
  const t = useTranslations("report.share");
  const locale = useLocale();
  const [state, formAction, pending] = useActionState<ShareState, FormData>(toggleShareLink, {});
  const { status: copyStatus, copy } = useCopyToClipboard();

  // 액션 결과가 있으면 그것을, 없으면 서버 렌더 초기값을 사용
  const token = state.ok !== undefined ? (state.token ?? null) : initialToken;
  const shareUrl =
    token && typeof window !== "undefined"
      ? `${window.location.origin}/${locale}/scans/${scanId}/report?token=${token}`
      : null;

  return (
    <div className="no-print flex flex-wrap items-center gap-2">
      <form action={formAction}>
        <input type="hidden" name="scanId" value={scanId} />
        <button
          type="submit"
          disabled={pending}
          aria-pressed={!!token}
          className={
            token
              ? "rounded border-[1.5px] border-[var(--color-seal)] bg-[var(--color-seal-tint)] px-4 py-2 font-semibold text-[var(--color-seal)] disabled:opacity-60"
              : "rounded border-[1.5px] border-[var(--color-ink)] px-4 py-2 font-semibold hover:bg-[var(--color-paper-warm)] disabled:opacity-60"
          }
        >
          {pending ? t("working") : token ? t("disable") : t("enable")}
        </button>
      </form>
      {shareUrl && (
        <button
          type="button"
          onClick={() => copy(shareUrl)}
          className="rounded border-[1.5px] border-[var(--color-ink)] px-4 py-2 font-semibold hover:bg-[var(--color-paper-warm)]"
        >
          {copyStatus === "copied" ? t("copied") : copyStatus === "failed" ? t("copyFailed") : t("copy")}
        </button>
      )}
      {/* 토글·복사 결과를 보조기술에도 알림 */}
      <span role="status" className="w-full text-xs text-[var(--color-ink-faint)] sm:w-auto">
        {state.error
          ? t("failed")
          : copyStatus === "copied"
            ? t("copied")
            : copyStatus === "failed"
              ? t("copyFailed")
              : token
                ? t("onDesc")
                : ""}
      </span>
    </div>
  );
}
