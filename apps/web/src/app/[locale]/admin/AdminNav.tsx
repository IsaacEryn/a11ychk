"use client";

import { Link, usePathname } from "@/i18n/navigation";

interface AdminNavLabels {
  label: string;
  dashboard: string;
  users: string;
  referrals: string;
  teaser: string;
  scans: string;
  inquiries: string;
  settings: string;
  logs: string;
}

/**
 * 관리자 하위 내비게이션 — 현재 페이지는 aria-current="page"로 표시.
 * basePath는 서버(layout)가 슬러그를 반영해 계산한 기준 경로("/admin" 또는 "/{slug}") —
 * usePathname(next-intl)은 브라우저의 외부 경로를 로케일만 벗겨 반환하므로 슬러그와 일치한다.
 */
export function AdminNav({ labels, basePath }: { labels: AdminNavLabels; basePath: string }) {
  const pathname = usePathname();

  const items: { href: string; label: string }[] = [
    { href: basePath, label: labels.dashboard },
    { href: `${basePath}/users`, label: labels.users },
    { href: `${basePath}/referrals`, label: labels.referrals },
    { href: `${basePath}/teaser`, label: labels.teaser },
    { href: `${basePath}/scans`, label: labels.scans },
    { href: `${basePath}/inquiries`, label: labels.inquiries },
    { href: `${basePath}/settings`, label: labels.settings },
    { href: `${basePath}/logs`, label: labels.logs },
  ];

  return (
    <nav aria-label={labels.label} className="mt-6 border-b-[1.5px] border-[var(--color-ink)]">
      <ul className="flex flex-wrap gap-1">
        {items.map((item) => {
          // 대시보드는 정확 일치, 하위 페이지는 접두 일치
          const current = item.href === basePath ? pathname === basePath : pathname.startsWith(item.href);
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
