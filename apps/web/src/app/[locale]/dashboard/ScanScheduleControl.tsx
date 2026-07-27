"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { setScanFrequency } from "@/lib/actions";
import type { SaveState } from "@/lib/actions";
import { FormFeedback } from "@/components/FormFeedback";
import { BTN_OUTLINE } from "@/components/buttonStyles";

/**
 * 정기 검사 주기 설정 + 실행 시점 안내. auto_scan이 켜진 도메인에만 노출된다.
 *
 * 대시보드 설정 컨트롤은 select 변경만으로 저장하지 않고 명시적 "적용" 버튼을 쓴다 —
 * 키보드로 옵션을 훑는 동안 change가 연달아 나 의도치 않게 반복 저장되는 걸 막기 위함이다
 * (WCAG 3.2.2 입력 시 실행). 같은 이유가 이 폴더의 다른 설정 컨트롤에도 똑같이 적용된다.
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
        <button type="submit" disabled={pending} className={BTN_OUTLINE}>
          {t("scheduleApply")}
        </button>
        <FormFeedback state={state} okLabel={t("settingSaved")} fallback={t("settingFailed")} />
      </form>
      <p className="mt-2 text-xs text-[var(--color-ink-soft)]">{t("scheduleExplain")}</p>
    </div>
  );
}
