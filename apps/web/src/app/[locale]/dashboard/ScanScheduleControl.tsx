"use client";

import { useTranslations } from "next-intl";
import { setScanFrequency } from "@/lib/actions";

/**
 * 정기 검사 주기 설정 + 실행 시점 안내. auto_scan이 켜진 도메인에만 노출된다.
 * 주기 선택 시 즉시 저장(select onChange 제출). JS 미사용 시 '적용' 버튼으로 폴백.
 */
export function ScanScheduleControl({ domainId, frequency }: { domainId: string; frequency: string }) {
  const t = useTranslations("dashboard.domains");
  const selectId = `freq-${domainId}`;
  return (
    <div className="mt-3 rounded border-[1.5px] border-[var(--color-line)] bg-[var(--color-paper-warm)] p-3">
      <form action={setScanFrequency} className="flex flex-wrap items-center gap-2">
        <input type="hidden" name="id" value={domainId} />
        <label htmlFor={selectId} className="text-sm font-semibold">
          {t("scheduleFreqLabel")}
        </label>
        <select
          id={selectId}
          name="frequency"
          defaultValue={frequency}
          onChange={(e) => e.currentTarget.form?.requestSubmit()}
          className="rounded border-[1.5px] border-[var(--color-ink)] bg-[var(--color-paper)] px-2 py-1.5 text-sm"
        >
          <option value="daily">{t("scheduleDaily")}</option>
          <option value="weekly">{t("scheduleWeekly")}</option>
          <option value="monthly">{t("scheduleMonthly")}</option>
        </select>
        {/* JS 비활성 폴백 — onChange 제출이 안 될 때 수동 적용 */}
        <noscript>
          <button
            type="submit"
            className="rounded border-[1.5px] border-[var(--color-seal)] px-3 py-1.5 text-sm font-semibold text-[var(--color-seal)]"
          >
            {t("scheduleApply")}
          </button>
        </noscript>
      </form>
      <p className="mt-2 text-xs text-[var(--color-ink-soft)]">{t("scheduleExplain")}</p>
    </div>
  );
}
