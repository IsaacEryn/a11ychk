"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { setScanFrequency } from "@/lib/actions";
import type { SaveState } from "@/lib/actions";

/**
 * 정기 검사 주기 설정 + 실행 시점 안내. auto_scan이 켜진 도메인에만 노출된다.
 *
 * select 변경만으로 제출하지 않는다 — 키보드 사용자가 화살표로 옵션을 탐색하는 동안
 * change가 연속 발생해 의도치 않은 저장이 반복된다(WCAG 3.2.2 입력 시 실행).
 * 명시적 "적용" 버튼 + 저장 결과 안내(role=status)로 처리한다.
 */
export function ScanScheduleControl({ domainId, frequency }: { domainId: string; frequency: string }) {
  const t = useTranslations("dashboard.domains");
  const selectId = `freq-${domainId}`;
  const [state, formAction, pending] = useActionState<SaveState, FormData>(setScanFrequency, {});

  return (
    <div className="mt-3 rounded border-[1.5px] border-[var(--color-line)] bg-[var(--color-paper-warm)] p-3">
      <form action={formAction} className="flex flex-wrap items-center gap-2">
        <input type="hidden" name="id" value={domainId} />
        <label htmlFor={selectId} className="text-sm font-semibold">
          {t("scheduleFreqLabel")}
        </label>
        <select
          id={selectId}
          name="frequency"
          defaultValue={frequency}
          className="rounded border-[1.5px] border-[var(--color-ink)] bg-[var(--color-paper)] px-2 py-1.5 text-sm"
        >
          <option value="daily">{t("scheduleDaily")}</option>
          <option value="weekly">{t("scheduleWeekly")}</option>
          <option value="monthly">{t("scheduleMonthly")}</option>
        </select>
        <button
          type="submit"
          disabled={pending}
          className="rounded border-[1.5px] border-[var(--color-seal)] px-3 py-1.5 text-sm font-semibold text-[var(--color-seal)] hover:bg-[var(--color-seal-tint)] disabled:opacity-60"
        >
          {t("scheduleApply")}
        </button>
        <span role="status" className="text-xs text-[var(--color-ink-faint)]">
          {state.ok ? t("settingSaved") : state.error ? t("settingFailed") : ""}
        </span>
      </form>
      <p className="mt-2 text-xs text-[var(--color-ink-soft)]">{t("scheduleExplain")}</p>
    </div>
  );
}
