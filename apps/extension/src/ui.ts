/** 패널 셸 UI — 상단 탭(ARIA Tabs 패턴)과 테마 전환 */
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

// ─── 상단 탭 전환 ───
export function wireTabs() {
  const tabs = [...document.querySelectorAll<HTMLButtonElement>(".tab")];
  const panels: Record<string, HTMLElement> = {
    scan: $("tab-scan"),
    tools: $("tab-tools"),
    settings: $("tab-settings"),
  };
  const select = (tab: HTMLButtonElement, focus = false) => {
    const name = tab.dataset.tab!;
    for (const t of tabs) {
      t.setAttribute("aria-selected", String(t === tab));
      // roving tabindex — Tab 키로는 선택된 탭만 거치고, 탭 간 이동은 화살표로
      t.tabIndex = t === tab ? 0 : -1;
    }
    for (const [k, el] of Object.entries(panels)) el.hidden = k !== name;
    // 대상 URL은 검사·도구 탭에서만 의미 있음
    $("target").style.display = name === "settings" ? "none" : "";
    if (focus) tab.focus();
  };
  tabs.forEach((tab, i) => {
    tab.tabIndex = tab.getAttribute("aria-selected") === "true" ? 0 : -1;
    tab.addEventListener("click", () => select(tab));
    // ARIA Tabs 키보드 패턴: ←/→ 순환, Home/End 처음/끝
    tab.addEventListener("keydown", (e) => {
      let next = -1;
      if (e.key === "ArrowRight") next = (i + 1) % tabs.length;
      else if (e.key === "ArrowLeft") next = (i - 1 + tabs.length) % tabs.length;
      else if (e.key === "Home") next = 0;
      else if (e.key === "End") next = tabs.length - 1;
      if (next >= 0) {
        e.preventDefault();
        select(tabs[next]!, true);
      }
    });
  });
}

// ─── 테마 (라이트/다크/고대비/시스템) ───
type ThemeMode = "system" | "light" | "dark" | "contrast";
export function applyTheme(mode: ThemeMode) {
  if (mode === "system") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = mode;
  document.querySelectorAll<HTMLButtonElement>("[data-theme]").forEach((b) => {
    b.setAttribute("aria-pressed", String(b.dataset.theme === mode));
  });
}
export async function wireTheme() {
  const { a11ychk_theme } = await chrome.storage.local.get("a11ychk_theme");
  const saved = (a11ychk_theme as ThemeMode | undefined) ?? "system";
  applyTheme(saved);
  document.querySelectorAll<HTMLButtonElement>("[data-theme]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const mode = btn.dataset.theme as ThemeMode;
      applyTheme(mode);
      void chrome.storage.local.set({ a11ychk_theme: mode });
    });
  });
}
