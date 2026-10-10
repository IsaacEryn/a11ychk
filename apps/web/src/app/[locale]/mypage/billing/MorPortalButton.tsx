"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { BTN_OUTLINE, BTN_SOLID } from "@/components/buttonStyles";
import { PendingStatus } from "@/components/PendingStatus";
import { openMorPortal, type OpenMorPortalError } from "@/lib/actions/billing";
import { navigateToPolar } from "@/lib/billing/polarRedirect";

interface PortalState {
  error?: OpenMorPortalError;
  /** 몇 번째 결과인지 — 같은 오류가 다시 와도 오류 문구로 포커스를 옮긴다 */
  seq: number;
}

/**
 * 해외 결제(판매 대행 Polar) 구독의 "결제 관리(Polar)" — 해지·해지 취소·결제 수단 변경·영수증은 Polar 고객 포털이 맡는다.
 * 누르면 서버가 고객 세션을 만들어 포털 주소를 돌려주고(openMorPortal), 그 주소가 polar.sh 허용 목록(navigateToPolar)을 통과할 때만
 * window.location.assign으로 이동한다 — 서버 액션 redirect로 외부에 보내지 않는다(CSP form-action을 넓히지 않는다). 통과하지
 * 못하면 이동하지 않고 실패로 안내한다. 미납 구독이면 버튼을 강조한다(emphasize).
 *
 * 처리하는 동안과 이동을 시작한 뒤에는 버튼이 비활성이고, 늘 DOM에 있는 진행 상태 영역(PendingStatus)이 문구만 바꿔 알린다.
 * 뒤로 가기로 이 화면이 되살아나면(bfcache) 다시 누를 수 있다. 오류가 나면 포커스를 오류 문구로 옮긴다 — 포커스로 읽히므로
 * role="alert"를 겹치지 않는다(두 번 읽힘). 버튼은 설명 문단(describedBy)과 오류 문구를 aria-describedby로 가리킨다.
 */
export function MorPortalButton({ describedBy, emphasize }: { describedBy: string; emphasize: boolean }) {
  const t = useTranslations("billing.manage.portal");
  const [leaving, setLeaving] = useState(false);
  const [state, formAction, pending] = useActionState<PortalState, FormData>(async (prev) => {
    const res = await openMorPortal();
    if (!res.ok || !res.url) return { error: res.error ?? "failed", seq: prev.seq + 1 };
    if (!navigateToPolar(res.url)) return { error: "failed", seq: prev.seq + 1 };
    setLeaving(true);
    return { seq: prev.seq + 1 };
  }, { seq: 0 });

  const errorRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (state.error) errorRef.current?.focus();
  }, [state]);

  useEffect(() => {
    const onShow = (e: PageTransitionEvent) => {
      if (e.persisted) setLeaving(false);
    };
    window.addEventListener("pageshow", onShow);
    return () => window.removeEventListener("pageshow", onShow);
  }, []);

  const errorId = `${describedBy}-error`;
  const busy = pending || leaving;

  return (
    <form action={formAction} className="mt-4">
      <button
        type="submit"
        disabled={busy}
        aria-describedby={state.error ? `${describedBy} ${errorId}` : describedBy}
        className={emphasize ? BTN_SOLID : BTN_OUTLINE}
      >
        {t("button")}
      </button>
      <PendingStatus message={pending ? t("pending") : leaving ? t("leaving") : null} />
      {state.error && (
        <p ref={errorRef} id={errorId} tabIndex={-1} className="mt-1 text-sm font-medium text-[var(--color-crit)]">
          {t(`errors.${state.error}`)}
        </p>
      )}
    </form>
  );
}
