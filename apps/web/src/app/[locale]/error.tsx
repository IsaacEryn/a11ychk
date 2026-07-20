"use client";

import { useEffect } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";

/** 로케일 세그먼트 하위 라우트의 런타임 예외 경계 — 헤더·로케일이 유지된 상태로 안내한다. */
export default function LocaleError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useTranslations("errors");

  useEffect(() => {
    // 서버 digest만 콘솔에 남긴다(민감정보 노출 없이 상관관계 추적용).
    if (error.digest) console.error("route error", error.digest);
  }, [error]);

  return (
    <div className="mx-auto max-w-md px-4 py-24 text-center sm:px-6">
      <p className="font-display text-7xl font-extrabold text-[var(--color-line)]" aria-hidden="true">
        !
      </p>
      <h1 className="font-display mt-4 text-2xl font-bold">{t("title")}</h1>
      <p className="mt-2 text-[var(--color-ink-soft)]">{t("desc")}</p>
      <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
        <button
          type="button"
          onClick={reset}
          className="rounded border-[1.5px] border-[var(--color-seal)] bg-[var(--color-seal)] px-5 py-2.5 font-bold text-[var(--color-paper)]"
        >
          {t("retry")}
        </button>
        <Link
          href="/"
          className="rounded border-[1.5px] border-[var(--color-ink)] px-5 py-2.5 font-bold"
        >
          {t("goHome")}
        </Link>
      </div>
      {/* 문제가 계속될 때의 안내 + 지원 문의용 오류 코드(digest) */}
      <p className="mt-6 text-sm text-[var(--color-ink-soft)]">
        {t("persistPrefix")}{" "}
        <Link href="/inquiries" className="font-semibold text-[var(--color-seal)] underline underline-offset-4">
          {t("contact")}
        </Link>
      </p>
      {error.digest && (
        <p className="mt-2 font-mono text-xs text-[var(--color-ink-faint)]">
          {t("digestLabel")}: {error.digest}
        </p>
      )}
    </div>
  );
}
