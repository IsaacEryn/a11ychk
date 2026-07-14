"use client";

import { useLocale } from "next-intl";
import { usePathname, useRouter } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";

const LOCALE_LABEL: Record<string, string> = { ko: "한국어", en: "English" };

export function LocaleSwitcher({ label }: { label: string }) {
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();

  return (
    <label className="flex items-center gap-1.5 text-sm">
      <span className="sr-only">{label}</span>
      <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="12" cy="12" r="10" />
        <path d="M2 12h20M12 2a15 15 0 0 1 0 20 15 15 0 0 1 0-20" />
      </svg>
      <select
        value={locale}
        onChange={(e) => router.replace(pathname, { locale: e.target.value as (typeof routing.locales)[number] })}
        className="rounded border-[1.5px] border-[var(--color-line)] bg-[var(--color-paper)] px-1.5 py-1 text-sm"
      >
        {routing.locales.map((l) => (
          <option key={l} value={l}>
            {LOCALE_LABEL[l] ?? l}
          </option>
        ))}
      </select>
    </label>
  );
}
