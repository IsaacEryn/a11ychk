import type { LocalizedText } from "../types";

/** 로케일에 맞는 문자열을 고른다 — en이 없으면 ko로 폴백. */
export function pickLocale(text: LocalizedText, locale: string): string {
  return locale === "en" && text.en ? text.en : text.ko;
}
