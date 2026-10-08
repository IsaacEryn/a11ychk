"use client";

import { useActionState, useEffect, useId, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { BTN_OUTLINE } from "@/components/buttonStyles";
import { PendingStatus } from "@/components/PendingStatus";
import { cancelSubscriptionAction, resumeSubscriptionAction, type ManageSubscriptionState } from "@/lib/actions/billing";
import { ResumeForm } from "./ResumeForm";

/** 이 모드에서 사용자가 관리할 수 있는 진행 중 토스 구독 — 날짜는 서버가 서식을 맞춘 표시 문자열 */
export interface CancelTarget {
  status: "active" | "past_due";
  /** 해지 예약됨(active일 때만) */
  scheduled: boolean;
  /** 이용 기간 끝 */
  endsAt: string;
  /** 다음 결제일(재개하면 결제될 날) */
  nextCharge: string;
}

interface State extends ManageSubscriptionState {
  /** 몇 번째 결과인지 — 같은 결과가 다시 와도 안내로 포커스를 옮긴다 */
  seq: number;
}

/**
 * 구독 해지 영역 — "구독 해지"를 누르면 같은 자리에 확인 단계가 열린다. 확인 단계에는 무엇이 일어나는지(active: 기간 끝까지
 * 이용하고 그 뒤 결제 없음, 미납: 지금 바로 끝남)와 같은 크기·같은 모양의 두 버튼만 둔다(붙잡는 문구·할인 제안 없음).
 * 해지가 예약된 상태면 해지 취소(ResumeForm)를 보인다.
 *
 * 포커스: 확인 단계가 열리면 그 안내 문구로, "돌아가기"면 "구독 해지" 버튼으로, 결과가 오면 결과 안내로 옮긴다.
 * 성공하면 서버가 화면을 다시 그려 누른 버튼이 사라지기 때문이다. 그래서 이 컴포넌트는 구독이 끝난 뒤에도(sub = null)
 * 자리를 지켜 결과 안내를 남긴다 — 페이지는 결제 모드가 켜져 있으면 늘 이 컴포넌트를 같은 자리에 둔다.
 * 결과 안내는 포커스로 읽히게 하고 live 영역을 겹치지 않는다(두 번 읽힘). 처리 중 표시는 PendingStatus(live)가 맡는다.
 */
export function CancelSection({ sub }: { sub: CancelTarget | null }) {
  const t = useTranslations("billing.manage.cancel");
  const confirmId = useId();
  const [state, formAction, pending] = useActionState<State, FormData>(
    async (prev, fd) => {
      const res = fd.get("intent") === "resume" ? await resumeSubscriptionAction() : await cancelSubscriptionAction();
      return { ...res, seq: prev.seq + 1 };
    },
    { seq: 0 },
  );

  // 확인 단계를 연 시점의 결과 차례 — 그 뒤 성공 결과가 오면 닫히고, 실패면 열린 채로 둔다
  const [confirmAt, setConfirmAt] = useState<number | null>(null);
  const confirming = confirmAt !== null && (state.seq === confirmAt || !state.ok);

  const triggerRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLParagraphElement>(null);
  const messageRef = useRef<HTMLParagraphElement>(null);
  const focusNext = useRef<"confirm" | "trigger" | null>(null);

  useEffect(() => {
    const target = focusNext.current;
    focusNext.current = null;
    if (target === "confirm") confirmRef.current?.focus();
    else if (target === "trigger") triggerRef.current?.focus();
  }, [confirmAt]);

  useEffect(() => {
    if (state.seq > 0) messageRef.current?.focus();
  }, [state]);

  const open = () => {
    focusNext.current = "confirm";
    setConfirmAt(state.seq);
  };
  const back = () => {
    focusNext.current = "trigger";
    setConfirmAt(null);
  };

  const message = state.ok && state.done ? t(`done.${state.done}`) : state.error ? t(`errors.${state.error}`) : "";
  // 이미 예약됨·결제 확인 중은 실패가 아니라 안내다
  const tone = state.ok
    ? "text-[var(--color-seal)]"
    : state.error === "already" || state.error === "busy"
      ? "text-[var(--color-ink-soft)]"
      : "text-[var(--color-crit)]";
  const pastDue = sub?.status === "past_due";
  // 관리할 구독도, 남길 결과도 없으면 빈 자리를 차지하지 않는다(상태는 그대로 둔다)
  if (!sub && state.seq === 0) return null;

  return (
    <div className={sub ? "mt-6 border-t border-[var(--color-line)] pt-5" : "mt-4"}>
      {sub &&
        (sub.scheduled ? (
          <ResumeForm action={formAction} pending={pending} nextCharge={sub.nextCharge} />
        ) : confirming ? (
          <div role="group" aria-labelledby={confirmId}>
            <p id={confirmId} ref={confirmRef} tabIndex={-1} className="text-sm font-semibold">
              {pastDue ? t("confirmPastDue") : t("confirmActive", { date: sub.endsAt })}
            </p>
            <form action={formAction} className="mt-3 flex flex-wrap gap-2">
              <button type="submit" name="intent" value="cancel" disabled={pending} className={BTN_OUTLINE}>
                {pastDue ? t("submitPastDue") : t("submitActive")}
              </button>
              <button type="button" onClick={back} disabled={pending} className={BTN_OUTLINE}>
                {t("back")}
              </button>
            </form>
          </div>
        ) : (
          <button ref={triggerRef} type="button" onClick={open} className={BTN_OUTLINE}>
            {t("open")}
          </button>
        ))}
      {sub && <PendingStatus message={pending ? t("pending") : null} />}
      <p ref={messageRef} tabIndex={-1} className={`mt-1 min-h-5 text-sm font-medium ${tone}`}>
        {message}
      </p>
    </div>
  );
}
