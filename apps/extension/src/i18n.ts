/**
 * 확장 다국어 헬퍼 — chrome.i18n(_locales) 래퍼.
 * 브라우저 UI 언어가 en이면 영어, 그 외는 default_locale(ko).
 */

/** 메시지 조회 (누락 시 키를 그대로 반환해 빈 화면 방지) */
export function msg(key: string, subs?: (string | number)[]): string {
  if (typeof chrome === "undefined" || !chrome.i18n) return key; // 확장 외부(테스트 하니스) 안전 가드
  const m = chrome.i18n.getMessage(key, subs?.map(String));
  return m || key;
}

/** 카탈로그의 {ko, en?} 텍스트에서 UI 언어에 맞는 값 선택 */
export function pick(text: { ko: string; en?: string }): string {
  return isEnglish() && text.en ? text.en : text.ko;
}

let cachedEn: boolean | null = null;
export function isEnglish(): boolean {
  if (cachedEn === null) {
    cachedEn =
      typeof chrome !== "undefined" && chrome.i18n
        ? chrome.i18n.getUILanguage().toLowerCase().startsWith("en")
        : false;
  }
  return cachedEn;
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
