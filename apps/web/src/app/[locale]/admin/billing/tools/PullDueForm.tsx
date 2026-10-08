"use client";

import { useTranslations } from "next-intl";
import { pullDueDate, type SaveState } from "@/lib/actions";
import { FormFeedback } from "@/components/FormFeedback";
import { useAdminAction } from "../../useAdminAction";
import { BTN_PRIMARY } from "../contractForm";

/** pullDueDate가 돌려주는 오류 코드 전부 */
const ERROR_CODES = ["invalid", "notFound", "notTest", "ended", "migrationMissing", "failed"] as const;

/**
 * 테스트 구독의 결제일 당기기 — 표의 행마다 하나. 같은 문구의 버튼이 여러 개라 화면 낭독기용으로 누구 것인지 덧붙인다.
 * 성공하면 refresh로 행의 기간 끝이 새 값(지금 + 1분)으로 바뀌고, 이 폼은 그대로 남아 성공 안내를 유지한다.
 */
export function PullDueForm({ subscriptionId, label }: { subscriptionId: string; label: string }) {
  const t = useTranslations("admin.billing.tools");
  const [state, formAction, pending] = useAdminAction<SaveState, FormData>(pullDueDate, {});
  const errors = Object.fromEntries(ERROR_CODES.map((c) => [c, t(`errors.${c}`)])) as Record<string, string>;

  return (
    <form action={formAction} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="subscriptionId" value={subscriptionId} />
      <button type="submit" disabled={pending} className={BTN_PRIMARY}>
        {pending ? t("pulling") : t("pull")}
        <span className="sr-only"> ({label})</span>
      </button>
      <FormFeedback state={state} okLabel={t("pulled")} errors={errors} fallback={errors.failed} />
    </form>
  );
}
