"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useCopyToClipboard } from "@/lib/useCopyToClipboard";

type Fmt = "html" | "markdown";

/**
 * 접근성 배지 임베드 — 미리보기 + HTML/Markdown 코드 + 복사 버튼.
 * 공개 등재(publicListed) 시 배지가 공개 보고서로 링크된다.
 */
export function BadgeEmbed({
  siteUrl,
  hostname,
  publicListed,
  alt,
}: {
  siteUrl: string;
  hostname: string;
  publicListed: boolean;
  alt: string;
}) {
  const t = useTranslations("dashboard.domains");
  const [fmt, setFmt] = useState<Fmt>("html");
  const { status: copyStatus, copy } = useCopyToClipboard();

  const badgeSrc = `${siteUrl}/api/badge/${hostname}`;
  const reportUrl = `${siteUrl}/site/${hostname}`;

  const html = publicListed
    ? `<a href="${reportUrl}"><img src="${badgeSrc}" alt="${alt}"></a>`
    : `<img src="${badgeSrc}" alt="${alt}">`;
  const markdown = publicListed ? `[![${alt}](${badgeSrc})](${reportUrl})` : `![${alt}](${badgeSrc})`;
  const code = fmt === "html" ? html : markdown;

  const onCopy = () => copy(code);
  const copyLabel = copyStatus === "copied" ? t("badgeCopied") : copyStatus === "failed" ? t("copyFailed") : t("badgeCopy");

  return (
    <div>
      {/* 미리보기 — 실제 사이트에 붙였을 때 보이는 모습 */}
      <p className="mb-1.5 text-xs font-semibold text-[var(--color-ink-soft)]">{t("badgePreview")}</p>
      <div className="mb-3 flex items-center gap-2 rounded border-[1.5px] border-dashed border-[var(--color-line)] bg-[var(--color-paper)] p-3">
        {publicListed ? (
          <a href={reportUrl} target="_blank" rel="noopener noreferrer">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={badgeSrc} alt={alt} height={28} />
          </a>
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={badgeSrc} alt={alt} height={28} />
        )}
      </div>

      {/* 형식 토글 + 복사 */}
      <div className="mb-1.5 flex flex-wrap items-center gap-2">
        <div role="group" aria-label={t("badgeFormat")} className="flex gap-1 rounded border-[1.5px] border-[var(--color-ink)] p-0.5">
          {(["html", "markdown"] as const).map((f) => (
            <button
              key={f}
              type="button"
              aria-pressed={fmt === f}
              onClick={() => setFmt(f)}
              className={`rounded-[3px] px-2.5 py-1 text-xs font-bold ${
                fmt === f ? "bg-[var(--color-seal)] text-[var(--color-paper)]" : "text-[var(--color-ink-soft)]"
              }`}
            >
              {f === "html" ? t("badgeFormatHtml") : t("badgeFormatMd")}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={onCopy}
          className="rounded border-[1.5px] border-[var(--color-seal)] bg-[var(--color-seal)] px-3 py-1 text-xs font-bold text-[var(--color-paper)] hover:bg-[var(--color-seal-deep)]"
        >
          {copyLabel}
        </button>
        {/* 복사 결과를 보조기술에도 알림 (버튼 라벨 변화만으로는 SR에 전달되지 않음) */}
        <span role="status" className="sr-only">
          {copyStatus === "copied" ? t("badgeCopied") : copyStatus === "failed" ? t("copyFailed") : ""}
        </span>
      </div>

      <code className="block break-all rounded bg-[var(--color-paper-warm)] px-2 py-1.5 text-[0.8em]">{code}</code>
      <p className="mt-1.5 text-xs text-[var(--color-ink-faint)]">{t("badgeNotice")}</p>
    </div>
  );
}
