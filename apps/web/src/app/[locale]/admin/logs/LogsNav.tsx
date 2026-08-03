"use client";

import { Link, usePathname } from "@/i18n/navigation";

interface LogsNavLabels {
  label: string;
  scans: string;
  logins: string;
  audit: string;
  errors: string;
}

/**
 * 로그 보조 탭 — 검사/로그인/감사/오류. AdminNav와 같은 관용구(aria-current,
 * 슬러그 반영 basePath는 서버가 계산해 prop으로 전달).
 */
export function LogsNav({ labels, basePath }: { labels: LogsNavLabels; basePath: string }) {
  const pathname = usePathname();

  const items: { href: string; label: string }[] = [
    { href: `${basePath}/scans`, label: labels.scans },
    { href: `${basePath}/logins`, label: labels.logins },
    { href: `${basePath}/audit`, label: labels.audit },
    { href: `${basePath}/errors`, label: labels.errors },
  ];

  return (
    <nav aria-label={labels.label} className="mt-4 border-b border-[var(--color-line)]">
      <ul className="flex flex-wrap gap-1">
        {items.map((item) => {
          const current = pathname.startsWith(item.href);
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={current ? "page" : undefined}
                className={`block border-b-[3px] px-3 py-1.5 text-sm font-bold ${
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
