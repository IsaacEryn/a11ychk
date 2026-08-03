"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "@/i18n/navigation";

/**
 * 사용자 상세 드로어 — URL(?user=)이 열림 상태의 단일 출처인 서버 렌더 상세를
 * 네이티브 <dialog>로 감싼다. showModal()이 포커스 트랩·배경 비활성(inert)·Esc를
 * 브라우저 표준으로 제공하므로 직접 구현하지 않는다 (WCAG 2.2 AA).
 * 닫힘(Esc의 cancel→close, 닫기 버튼의 method="dialog" 공통)에서 트리거 링크로
 * 포커스를 되돌린 뒤 URL에서 user 파라미터를 제거한다.
 */
export function UserDrawer({
  closeHref,
  userId,
  title,
  closeLabel,
  children,
}: {
  /** user 파라미터를 뺀 현재 목록 경로 (슬러그 반영, 로케일 무접두) */
  closeHref: string;
  userId: string;
  title: string;
  closeLabel: string;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const router = useRouter();

  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
  }, []);

  function handleClose() {
    // 같은 라우트의 쿼리만 바뀌므로 목록 DOM이 유지된다 — 트리거로 포커스 복귀 가능
    document.querySelector<HTMLElement>(`[data-user-trigger="${userId}"]`)?.focus();
    router.replace(closeHref, { scroll: false });
  }

  return (
    <dialog
      ref={ref}
      onClose={handleClose}
      aria-labelledby="user-drawer-title"
      className="admin-drawer m-0 ml-auto h-dvh max-h-none w-full max-w-xl overflow-y-auto border-l-[1.5px] border-[var(--color-ink)] bg-[var(--color-paper)] p-6 text-[var(--color-ink)]"
    >
      <div className="flex items-start justify-between gap-4">
        <h3 id="user-drawer-title" className="font-display text-xl font-bold">
          {title}
        </h3>
        <form method="dialog">
          <button
            type="submit"
            className="rounded border-[1.5px] border-[var(--color-ink)] px-3 py-1.5 text-sm font-bold hover:bg-[var(--color-paper-warm)]"
          >
            {closeLabel}
          </button>
        </form>
      </div>
      {children}
    </dialog>
  );
}
