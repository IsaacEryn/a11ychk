import { useId } from "react";
import { useTranslations } from "next-intl";
import { BTN_OUTLINE } from "@/components/buttonStyles";

/**
 * 해지 취소(재개) — 해지 예약 상태에서만 보인다. 결과 안내·포커스는 감싼 CancelSection이 맡는다: 재개에 성공하면
 * 화면이 다시 그려지며 이 폼이 사라지므로, 결과를 이 컴포넌트의 상태로 두면 함께 사라진다.
 * 입력이 없는 폼이라 React 19의 폼 자동 reset이 지울 값이 없다.
 */
export function ResumeForm({ action, pending, nextCharge }: { action: (formData: FormData) => void; pending: boolean; nextCharge: string }) {
  const t = useTranslations("billing.manage.cancel");
  const hintId = useId();
  return (
    <form action={action}>
      <p id={hintId} className="text-sm text-[var(--color-ink-soft)]">
        {t("resumeHint", { date: nextCharge })}
      </p>
      <button type="submit" name="intent" value="resume" disabled={pending} aria-describedby={hintId} className={`${BTN_OUTLINE} mt-3`}>
        {t("resume")}
      </button>
    </form>
  );
}
