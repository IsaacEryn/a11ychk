"use client";

import { Link, usePathname } from "@/i18n/navigation";

interface AdminNavLabels {
  label: string;
  dashboard: string;
  users: string;
  scans: string;
  inquiries: string;
  settings: string;
  logs: string;
}

/** 관리자 하위 내비게이션 — 현재 페이지는 aria-current="page"로 표시 */
export function AdminNav({ labels }: { labels: AdminNavLabels }) {
  const pathname = usePathname();

  const items: { href: string; label: string }[] = [
    { href: "/admin", label: labels.dashboard },
    { href: "/admin/users", label: labels.users },
    { href: "/admin/scans", label: labels.scans },
    { href: "/admin/inquiries", label: labels.inquiries },
    { href: "/admin/settings", label: labels.settings },
    { href: "/admin/logs", label: labels.logs },
  ];

  return (
    <nav aria-label={labels.label} className="mt-6 border-b-[1.5px] border-[var(--color-ink)]">
      <ul className="flex flex-wrap gap-1">
        {items.map((item) => {
          // 대시보드는 정확 일치, 하위 페이지는 접두 일치
          const current = item.href === "/admin" ? pathname === "/admin" : pathname.startsWith(item.href);
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={current ? "page" : undefined}
                className={`block border-b-[3px] px-3 py-2 text-sm font-bold ${
                  current
                    ? "border-[var(--color-seal)] text-[var(--color-seal)]"
                    : "border-transparent text-[var(--color-ink-soft)] hover:border-[var(--color-line)] hover:text-[var(--color-ink)]"
                }`}
              >
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
