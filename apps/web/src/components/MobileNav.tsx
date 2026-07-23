"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Link, usePathname } from "@/i18n/navigation";
import { ThemeToggle } from "./ThemeToggle";
import { LocaleSwitcher } from "./LocaleSwitcher";
import { signOut } from "@/lib/actions";

type Theme = "system" | "light" | "dark" | "contrast";

export interface MobileNavLabels {
  openMenu: string;
  closeMenu: string;
  about: string;
  guide: string;
  directory: string;
  auditGroup: string;
  scan: string;
  accessCheck: string;
  extension: string;
  myGroup: string;
  dashboard: string;
  mypage: string;
  inquiries: string;
  admin: string;
  login: string;
  logout: string;
}

/**
 * 모바일 전용 내비게이션 (md 미만). 햄버거 → 헤더 바로 아래 전폭 드롭다운 패널.
 * NavMenu의 접근성 패턴 이식: aria-expanded/controls, Escape로 닫고 버튼 포커스 복귀,
 * 바깥 pointerdown·라우트 변경 시 닫힘. 모달 아님(disclosure)이라 포커스 트랩 불필요.
 * 데스크톱 우측 컨트롤(테마·언어·로그인/아웃)을 패널 하단으로 옮겨 담는다.
 */
export function MobileNav({
  isLoggedIn,
  isAdmin,
  adminHref = "/admin",
  labels,
  themeLabel,
  themeLabels,
  localeLabel,
  className = "",
}: {
  isLoggedIn: boolean;
  isAdmin: boolean;
  /** 관리자 링크 경로 — 서버가 슬러그 반영해 계산 (기본 /admin) */
  adminHref?: string;
  labels: MobileNavLabels;
  themeLabel: string;
  themeLabels: Record<Theme, string>;
  localeLabel: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();
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

  // 라우트 변경 시 닫기 (렌더 중 상태 조정 — React 권장)
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

  const publicLinks = [
    { href: "/about", label: labels.about },
    { href: "/guide", label: labels.guide },
    { href: "/directory", label: labels.directory },
  ];
  const auditLinks = [
    { href: "/scan", label: labels.scan },
    { href: "/access-check", label: labels.accessCheck },
    { href: "/extension/connect", label: labels.extension },
  ];
  const myLinks = [
    { href: "/dashboard", label: labels.dashboard },
    { href: "/mypage", label: labels.mypage },
    { href: "/inquiries", label: labels.inquiries },
  ];

  const linkClass = (href: string) =>
    `flex min-h-[44px] items-center rounded px-3 text-[0.95rem] hover:bg-[var(--color-paper-warm)] hover:underline underline-offset-4 ${
      pathname === href ? "font-bold text-[var(--color-seal)]" : "font-medium text-[var(--color-ink)]"
    }`;

  const renderLinks = (items: { href: string; label: string }[]) =>
    items.map((item) => (
      <li key={item.href}>
        <Link
          href={item.href}
          aria-current={pathname === item.href ? "page" : undefined}
          onClick={() => setOpen(false)}
          className={linkClass(item.href)}
        >
          {item.label}
        </Link>
      </li>
    ));

  const groupHeading = "px-3 pt-3 pb-1 text-xs font-bold uppercase tracking-wide text-[var(--color-ink-faint)]";

  return (
    <div ref={rootRef} className={className} onKeyDown={onKeyDown}>
      <button
        ref={buttonRef}
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={open ? labels.closeMenu : labels.openMenu}
        onClick={() => setOpen((v) => !v)}
        className="flex h-11 w-11 items-center justify-center rounded border-[1.5px] border-[var(--color-ink)] text-[var(--color-ink)] hover:bg-[var(--color-paper-warm)]"
      >
        <svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          {open ? <path d="M5 5l14 14M19 5L5 19" /> : <path d="M4 7h16M4 12h16M4 17h16" />}
        </svg>
      </button>

      <div
        id={panelId}
        hidden={!open}
        className="absolute left-0 right-0 top-full z-40 max-h-[calc(100dvh-var(--header-h))] overflow-y-auto border-b-[1.5px] border-[var(--color-ink)] bg-[var(--color-paper)] px-3 pt-2 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-[0_8px_16px_-8px_rgba(0,0,0,0.3)]"
      >
        <nav aria-label={labels.openMenu}>
          <ul className="flex flex-col gap-0.5">
            {renderLinks(publicLinks)}
            {isLoggedIn && (
              <>
                <li className={groupHeading} aria-hidden="true">{labels.auditGroup}</li>
                {renderLinks(auditLinks)}
                <li className={groupHeading} aria-hidden="true">{labels.myGroup}</li>
                {renderLinks(myLinks)}
                {isAdmin && renderLinks([{ href: adminHref, label: labels.admin }])}
              </>
            )}
          </ul>
        </nav>

        <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-[var(--color-line)] pt-3">
          <ThemeToggle label={themeLabel} labels={themeLabels} />
          <LocaleSwitcher label={localeLabel} />
        </div>
        <div className="mt-3">
          {isLoggedIn ? (
            <form action={signOut}>
              <button
                type="submit"
                className="flex min-h-[44px] w-full items-center justify-center rounded border-[1.5px] border-[var(--color-ink)] px-3 font-semibold hover:bg-[var(--color-paper-warm)]"
              >
                {labels.logout}
              </button>
            </form>
          ) : (
            <Link
              href="/login"
              onClick={() => setOpen(false)}
              className="flex min-h-[44px] w-full items-center justify-center rounded border-[1.5px] border-[var(--color-seal)] bg-[var(--color-seal)] px-3 font-semibold text-[var(--color-paper)] hover:bg-[var(--color-seal-deep)]"
            >
              {labels.login}
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}
