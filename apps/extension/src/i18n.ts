/**
 * 확장 다국어 헬퍼 — 언어 설정(자동/한국어/영어)을 지원하는 자체 메시지 로더.
 *
 * chrome.i18n은 브라우저 UI 언어를 따르고 런타임 변경이 불가능하므로, 환경설정의
 * 수동 언어 선택을 지원하기 위해 패키지 내 _locales/<lang>/messages.json을 직접
 * fetch해 사전으로 사용한다. initI18n()이 완료된 뒤에 msg()를 호출해야 하며
 * (sidepanel init에서 가장 먼저 await), 로드 실패 시 chrome.i18n으로 폴백한다.
 */

type LangSetting = "auto" | "ko" | "en";

let dict: Record<string, { message: string }> | null = null;
let resolved: "ko" | "en" = "ko";

/** 저장된 언어 설정 조회 (기본 auto) */
export async function getLangSetting(): Promise<LangSetting> {
  try {
    const { a11ychk_lang } = await chrome.storage.local.get("a11ychk_lang");
    if (a11ychk_lang === "ko" || a11ychk_lang === "en" || a11ychk_lang === "auto") return a11ychk_lang;
  } catch {
    /* 확장 외부(테스트 하니스) */
  }
  return "auto";
}

/** 언어 설정 저장 — 적용은 패널 리로드로 (호출부에서 location.reload()) */
export async function setLangSetting(lang: LangSetting): Promise<void> {
  await chrome.storage.local.set({ a11ychk_lang: lang });
}

/** 메시지 사전 로드 + 언어 확정. msg()·localizeHtml() 사용 전에 1회 await 필수. */
export async function initI18n(): Promise<void> {
  const setting = await getLangSetting();
  resolved =
    setting === "auto"
      ? typeof chrome !== "undefined" && chrome.i18n && chrome.i18n.getUILanguage().toLowerCase().startsWith("en")
        ? "en"
        : "ko"
      : setting;
  try {
    const res = await fetch(chrome.runtime.getURL(`_locales/${resolved}/messages.json`));
    dict = (await res.json()) as Record<string, { message: string }>;
  } catch {
    dict = null; // chrome.i18n 폴백 (브라우저 언어 기준)
  }
  document.documentElement.lang = resolved;
}

/** 메시지 조회 (누락 시 키를 그대로 반환해 빈 화면 방지) */
export function msg(key: string, subs?: (string | number)[]): string {
  const s = subs?.map(String);
  const m = dict?.[key]?.message;
  if (m) return m.replace(/\$(\d)/g, (_, n: string) => s?.[Number(n) - 1] ?? "");
  if (typeof chrome === "undefined" || !chrome.i18n) return key;
  return chrome.i18n.getMessage(key, s) || key;
}

/** 카탈로그의 {ko, en?} 텍스트에서 현재 언어에 맞는 값 선택 */
export function pick(text: { ko: string; en?: string }): string {
  return isEnglish() && text.en ? text.en : text.ko;
}

export function isEnglish(): boolean {
  return resolved === "en";
}

/**
 * 정적 HTML 로컬라이즈 — data-i18n(텍스트)·data-i18n-placeholder·
 * data-i18n-aria-label 속성이 붙은 요소를 메시지로 채운다. init에서 1회 호출.
 */
export function localizeHtml(root: ParentNode = document): void {
  root.querySelectorAll<HTMLElement>("[data-i18n]").forEach((el) => {
    el.textContent = msg(el.dataset.i18n!);
  });
  root.querySelectorAll<HTMLElement>("[data-i18n-placeholder]").forEach((el) => {
    el.setAttribute("placeholder", msg(el.dataset.i18nPlaceholder!));
  });
  root.querySelectorAll<HTMLElement>("[data-i18n-aria-label]").forEach((el) => {
    el.setAttribute("aria-label", msg(el.dataset.i18nAriaLabel!));
  });
}
