"use client";

import { useEffect, useState } from "react";
import { THEME_STORAGE_KEY } from "@/lib/inlineScripts";

type Theme = "system" | "light" | "dark" | "contrast";
const THEMES: Theme[] = ["system", "light", "dark", "contrast"];
// 첫 페인트 전 적용은 레이아웃의 boot 스크립트(lib/inlineScripts.ts)가 같은 키로 한다
const STORAGE_KEY = THEME_STORAGE_KEY;

function applyTheme(theme: Theme) {
  const root = document.documentElement;
  if (theme === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", theme);
  try {
    if (theme === "system") localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // localStorage 사용 불가 환경 무시
  }
}

export function ThemeToggle({ label, labels }: { label: string; labels: Record<Theme, string> }) {
  const [theme, setTheme] = useState<Theme>("system");

  // 마운트 후 저장된 값과 동기화 (SSR/hydration은 "system"으로 시작해 불일치를 피하고,
  // 클라이언트에서 실제 저장값으로 보정한다 — localStorage는 외부 저장소이므로 정당한 패턴)
  useEffect(() => {
    const current = (localStorage.getItem(STORAGE_KEY) as Theme | null) ?? "system";
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTheme(THEMES.includes(current) ? current : "system");
  }, []);

  return (
    <label className="flex items-center gap-1.5 text-sm">
      <span className="sr-only">{label}</span>
      <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
      </svg>
      <select
        value={theme}
        onChange={(e) => {
          const next = e.target.value as Theme;
          setTheme(next);
          applyTheme(next);
        }}
        className="rounded border-[1.5px] border-[var(--color-line)] bg-[var(--color-paper)] px-1.5 py-1 text-sm"
      >
        {THEMES.map((th) => (
          <option key={th} value={th}>
            {labels[th]}
          </option>
        ))}
      </select>
    </label>
  );
}
