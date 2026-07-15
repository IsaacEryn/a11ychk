"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Link, usePathname } from "@/i18n/navigation";

export interface NavMenuItem {
  href: string;
  label: string;
}

/**
 * 접근 가능한 디스클로저 내비게이션 메뉴 (WAI-ARIA Disclosure Navigation 패턴).
 * - 버튼 클릭/Enter/Space로 열고 닫음 (aria-expanded)
 * - Escape로 닫고 버튼으로 초점 복귀
 * - 바깥 클릭·다른 곳으로 초점 이동 시 닫힘
 * - 링크 클릭(이동) 시 닫힘, 현재 페이지는 aria-current
 */
export function NavMenu({ label, items }: { label: string; items: NavMenuItem[] }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const listId = useId();
  const pathname = usePathname();

  // 바깥 클릭 시 닫기
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  // 라우트가 바뀌면 닫기 — effect 대신 렌더 중 상태 조정 패턴(React 권장)
  const [prevPathname, setPrevPathname] = useState(pathname);
  if (prevPathname !== pathname) {
    setPrevPathname(pathname);
    if (open) setOpen(false);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape" && open) {
      e.stopPropagation();
      setOpen(false);
      buttonRef.current?.focus();
    }
  }

  // 메뉴 내 링크가 현재 페이지면 상위 버튼도 강조
  const isCurrentSection = items.some((i) => pathname === i.href || pathname.startsWith(`${i.href}/`));

  return (
    <div ref={rootRef} className="relative" onKeyDown={onKeyDown}>
      <button
        ref={buttonRef}
        type="button"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen((v) => !v)}
        className={`flex items-center gap-1 rounded px-2 py-1 text-[0.95rem] font-medium hover:text-[var(--color-ink)] hover:underline underline-offset-4 ${
          isCurrentSection ? "font-bold text-[var(--color-ink)]" : "text-[var(--color-ink-soft)]"
        }`}
      >
        {label}
        <svg
          aria-hidden="true"
          width="10"
          height="10"
          viewBox="0 0 10 10"
          className={`transition-transform ${open ? "rotate-180" : ""}`}
        >
          <path d="M1 3l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      </button>
      <ul
        id={listId}
        hidden={!open}
        className="absolute left-0 top-full z-50 mt-1 min-w-44 border-[1.5px] border-[var(--color-ink)] bg-[var(--color-paper)] py-1 shadow-[4px_4px_0_0_var(--color-line)]"
      >
        {items.map((item) => {
          const current = pathname === item.href;
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={current ? "page" : undefined}
                onClick={() => setOpen(false)}
                className={`block px-3.5 py-2 text-sm hover:bg-[var(--color-paper-warm)] hover:underline underline-offset-4 ${
                  current ? "font-bold text-[var(--color-seal)]" : "font-medium text-[var(--color-ink)]"
                }`}
              >
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
