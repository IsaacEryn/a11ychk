"use client";

import { useTranslations } from "next-intl";
import { setPublicReport } from "@/lib/actions";

export interface PublicReportOption {
  id: string;
  date: string; // ISO
  rate: number;
  title: string | null;
}

/**
 * 공개 보고서 지정 — 단일 드롭다운으로 공개 여부·디렉터리 등재·배지가 가리킬 보고서를 함께 정한다.
 * "공개 안 함 / 최신 검사(자동) / [특정 보고서]". 선택 즉시 저장(onChange 제출), JS 미사용 시 '적용' 폴백.
 */
export function PublicReportControl({
  domainId,
  publicListed,
  publicScanId,
  reports,
  locale,
}: {
  domainId: string;
  publicListed: boolean;
  publicScanId: string | null;
  reports: PublicReportOption[];
  locale: string;
}) {
  const t = useTranslations("dashboard.domains");
  const selectId = `pub-${domainId}`;
  const current = !publicListed ? "off" : (publicScanId ?? "latest");

  const fmtDate = (iso: string) => {
    try {
      return new Date(iso).toLocaleDateString(locale === "en" ? "en-US" : "ko-KR", { dateStyle: "medium" });
    } catch {
      return iso.slice(0, 10);
    }
  };

  return (
    <div className="mb-3">
      <form action={setPublicReport} className="flex flex-wrap items-center gap-2">
        <input type="hidden" name="id" value={domainId} />
        <label htmlFor={selectId} className="text-sm font-semibold">
          {t("publicLabel")}
        </label>
        <select
          id={selectId}
          name="value"
          defaultValue={current}
          onChange={(e) => e.currentTarget.form?.requestSubmit()}
          className="max-w-full rounded border-[1.5px] border-[var(--color-ink)] bg-[var(--color-paper)] px-2 py-1.5 text-sm"
        >
          <option value="off">{t("publicOff")}</option>
          <option value="latest">{t("publicLatest")}</option>
          {reports.length > 0 && (
            <optgroup label={t("publicPickReport")}>
              {reports.map((r) => (
                <option key={r.id} value={r.id}>
                  {fmtDate(r.date)} · {r.rate}%{r.title ? ` · ${r.title}` : ""}
                </option>
              ))}
            </optgroup>
          )}
        </select>
        <noscript>
          <button
            type="submit"
            className="rounded border-[1.5px] border-[var(--color-seal)] px-3 py-1.5 text-sm font-semibold text-[var(--color-seal)]"
          >
            {t("scheduleApply")}
          </button>
        </noscript>
      </form>
      <p className="mt-1 text-xs text-[var(--color-ink-faint)]">
        {publicListed ? t("publicHintOn") : t("publicHintOff")}
      </p>
    </div>
  );
}
