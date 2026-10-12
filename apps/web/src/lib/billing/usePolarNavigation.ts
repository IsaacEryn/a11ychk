import { useActionState, useEffect, useRef, useState } from "react";
import { navigateToPolar } from "@/lib/billing/polarRedirect";

/**
 * Polar가 호스팅하는 페이지(결제창·고객 포털)로 보내는 폼의 공통 상태 — 해외 결제 확인 화면(MorCheckoutForm)과 결제 관리의 고객 포털
 * 버튼(MorPortalButton)이 함께 쓴다. 브라우저에서만 부른다("use client" 모듈이 아니라 클라이언트 컴포넌트가 가져다 쓴다 —
 * openBillingAuth.ts와 같은 규칙).
 * - run이 서버 액션을 부르고, 받은 주소를 go(url)에 넘긴다. go는 polar.sh 허용 목록(navigateToPolar)을 통과할 때만
 *   window.location.assign으로 이동하고 leaving을 켠다(통과하지 못하면 false — run이 실패로 안내한다). 서버 액션 redirect로 외부에
 *   보내지 않는다(CSP form-action을 넓히지 않는다).
 * - busy: 처리 중이거나 이동을 시작했다(버튼을 막는다). 뒤로 가기로 화면이 되살아나면(bfcache pageshow) leaving을 끈다.
 * - 결과에 오류가 있으면 오류 문구(errorRef)로 포커스를 옮긴다 — 결과마다 새 상태라 같은 오류가 다시 와도 옮긴다. 제출 중 버튼이
 *   비활성이 되며 포커스를 잃기 쉽다. 오류 문구에는 live 역할을 겹치지 않는다(포커스로 읽힌다 — 두 번 읽힘 방지).
 */
export function usePolarNavigation<S extends { error?: unknown }>(
  run: (prev: S, formData: FormData, go: (url: unknown) => boolean) => Promise<S>,
  initial: S,
) {
  const [leaving, setLeaving] = useState(false);
  // 상태는 평범한 객체라 Awaited<S>는 S와 같다 — 제네릭이라 타입 검사기가 보이지 못해 한 번 단언한다
  const [state, formAction, pending] = useActionState<S, FormData>(
    (prev, formData) =>
      run(prev as S, formData, (url) => {
        if (!navigateToPolar(url)) return false;
        setLeaving(true);
        return true;
      }),
    initial as Awaited<S>,
  );

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

  return { state, formAction, pending, leaving, busy: pending || leaving, errorRef };
}
