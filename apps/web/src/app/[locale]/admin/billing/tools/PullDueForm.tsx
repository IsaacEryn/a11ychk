"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { pullDueDate, type PullState } from "@/lib/actions";
import { FormFeedback } from "@/components/FormFeedback";
import { useAdminAction } from "../../useAdminAction";
import { BTN_PRIMARY } from "../contractForm";

/** pullDueDate가 돌려주는 오류 코드 전부 */
const ERROR_CODES = ["invalid", "notFound", "notTest", "ended", "graceOver", "cancelScheduled", "migrationMissing", "failed"] as const;

/**
 * 테스트 구독의 결제일 당기기 — 표의 행마다 하나. 같은 문구의 버튼이 여러 개라 화면 낭독기용으로 누구 것인지 덧붙인다.
 * - 진행 중(active): 버튼 둘 — 결제 시점(기간 끝을 1분 뒤로) / 안내 시점(2일 뒤로). 눌린 버튼의 target 값이 함께 제출된다.
 *   해지 예약 구독이면 결제 시점은 종료 시험(end)이 되고, 안내 시점은 서버가 막는다(cancelScheduled).
 * - 미납(past_due): 버튼 하나 — 다음 재시도 시점만 지금으로(target 없음, 서버가 기간 끝을 건드리지 않는다).
 * 성공하면 refresh로 행이 새 값으로 바뀌고, 이 폼은 그대로 남아 성공 안내를 유지한다.
 */
export function PullDueForm({ subscriptionId, label, pastDue }: { subscriptionId: string; label: string; pastDue: boolean }) {
  const t = useTranslations("admin.billing.tools");
  const [state, formAction, pending] = useAdminAction<PullState, FormData>(pullDueDate, {});
  // 어느 버튼을 눌렀는지 — 처리 중 문구를 그 버튼에만 보인다
  const [pressed, setPressed] = useState<string>("");
  const errors = Object.fromEntries(ERROR_CODES.map((c) => [c, t(`errors.${c}`)])) as Record<string, string>;
  const busy = (target: string) => pending && pressed === target;

  return (
    <form action={formAction} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="subscriptionId" value={subscriptionId} />
      {pastDue ? (
        <button type="submit" disabled={pending} onClick={() => setPressed("retry")} className={BTN_PRIMARY}>
          {busy("retry") ? t("pulling") : t("pullRetry")}
          <span className="sr-only"> ({label})</span>
        </button>
      ) : (
        <>
          <button type="submit" name="target" value="charge" disabled={pending} onClick={() => setPressed("charge")} className={BTN_PRIMARY}>
            {busy("charge") ? t("pulling") : t("pullCharge")}
            <span className="sr-only"> ({label})</span>
          </button>
          <button type="submit" name="target" value="remind" disabled={pending} onClick={() => setPressed("remind")} className={BTN_PRIMARY}>
            {busy("remind") ? t("pulling") : t("pullRemind")}
            <span className="sr-only"> ({label})</span>
          </button>
        </>
      )}
      <FormFeedback state={state} okLabel={state.kind ? t(`pulled.${state.kind}`) : ""} errors={errors} fallback={errors.failed} />
    </form>
  );
}
