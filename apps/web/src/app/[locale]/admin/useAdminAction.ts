"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "@/i18n/navigation";

/**
 * 관리자 폼 전용 useActionState — 성공하면 클라이언트에서 화면을 갱신한다.
 *
 * 관리자 액션은 서버에서 `revalidatePath`를 쓰지 않는다(이유는
 * `lib/actions/shared.ts`의 revalidateLocalized 주석 참조 — 경로 rewrite 때문에
 * 라우터가 갱신 대상을 찾지 못해 pending이 풀리지 않았다). 대신 성공 후
 * `router.refresh()`로 서버 컴포넌트를 다시 받아온다. refresh는 브라우저에 보이는
 * URL을 기준으로 동작하므로 슬러그 경로에서도 정확하다.
 *
 * 갱신은 pending 밖에서 일어난다 — 버튼은 액션이 끝나는 즉시 원래대로 돌아오고
 * 성공 표시가 뜨며, 목록 데이터는 곧이어 조용히 새 값으로 바뀐다.
 */
export function useAdminAction<State extends { ok?: boolean }, Payload>(
  action: (prev: Awaited<State>, payload: Payload) => State | Promise<State>,
  initial: Awaited<State>,
) {
  const [state, formAction, pending] = useActionState<State, Payload>(action, initial);
  const router = useRouter();

  useEffect(() => {
    // useActionState는 제출마다 새 state 객체를 주므로 성공 1회당 한 번만 돈다
    if (state.ok) router.refresh();
  }, [state, router]);

  return [state, formAction, pending] as const;
}
