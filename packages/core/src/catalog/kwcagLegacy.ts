/**
 * 옛 a11ychk KWCAG 번호 해석.
 *
 * 2026-10 이전 a11ychk는 KWCAG 항목을 자체 번호로 저장·전송했다. 그중 10개가 KS X OT0003:2022의
 * 공식 번호와 달랐고, 6개(5.3.1·5.3.2·5.4.1·5.4.3·7.3.1·7.3.2)는 공식 체계에서 다른 항목의 번호다.
 * 숫자만 보고는 옛 번호인지 공식 번호인지 알 수 없으므로 규칙을 하나로 정한다.
 *
 * - 저장·전송된 값(DB scan_reviews.item_id, scans.summary.kwcagMatrix[].itemId, 확장 저장소의 키,
 *   확장이 보내는 판정)의 숫자는 늘 옛 번호다 → kwcagFromStored. 새로 쓰는 값은 모두 슬러그다.
 * - 사람·에이전트가 입력한 숫자(MCP 조회)는 공식 번호다 → resolveKwcagInput.
 *
 * KWCAG_LEGACY_IDS는 바꾸기 전 카탈로그를 얼린 표다. 고치지 말 것.
 * supabase/migrations/0039_kwcag_review_slugs.sql의 대응표와 같아야 한다(웹 테스트가 확인).
 */
import { KWCAG_BY_KSNO, KWCAG_ITEMS } from "./kwcag";
import { KWCAG_BY_SLUG } from "./kwcagSlug";
import type { KwcagItem, KwcagSlug } from "../types";

export const KWCAG_LEGACY_IDS: Readonly<Record<string, KwcagSlug>> = Object.freeze({
  "5.1.1": "alternative-text",
  "5.2.1": "captions-for-multimedia",
  "5.3.1": "content-not-relying-on-color-alone",
  "5.3.2": "clear-instructions",
  "5.4.1": "text-contrast",
  "5.4.2": "no-auto-play",
  "5.4.3": "distinguishable-content",
  "6.1.1": "keyboard-accessible",
  "6.1.2": "focus-order-and-visibility",
  "6.1.3": "target-size",
  "6.1.4": "character-key-shortcuts",
  "6.2.1": "adjustable-time-limits",
  "6.2.2": "pause-stop-hide",
  "6.3.1": "no-flashing-content",
  "6.4.1": "skip-repeated-blocks",
  "6.4.2": "page-frame-and-content-titles",
  "6.4.3": "meaningful-link-text",
  "6.4.4": "consistent-reference-locators",
  "6.5.1": "single-pointer-gestures",
  "6.5.2": "pointer-cancellation",
  "6.5.3": "label-in-name",
  "6.5.4": "motion-actuation",
  "7.1.1": "language-of-page",
  "7.2.1": "no-change-of-context-without-request",
  "7.2.2": "consistent-help",
  "7.3.1": "meaningful-sequence",
  "7.3.2": "table-structure",
  "7.4.1": "labels-for-inputs",
  "7.4.2": "error-identification",
  "7.4.3": "accessible-authentication",
  "7.4.4": "redundant-entry",
  "8.1.1": "valid-markup",
  "8.2.1": "aria-accessibility",
} satisfies Record<string, KwcagSlug>);

/** 저장·전송된 KWCAG 키 → 항목. 슬러그는 그대로, 숫자는 옛 번호로만 푼다. 모르면 undefined */
export function kwcagFromStored(key: string): KwcagItem | undefined {
  const bySlug = KWCAG_BY_SLUG.get(key);
  if (bySlug) return bySlug;
  const slug = KWCAG_LEGACY_IDS[key];
  return slug ? KWCAG_BY_SLUG.get(slug) : undefined;
}

/** 저장할 KWCAG 키 — 옛 번호로 들어와도 슬러그로 바꾼다. 풀 수 없으면 null */
export function toStoredKwcagKey(key: string): KwcagSlug | null {
  return kwcagFromStored(key)?.slug ?? null;
}

/** 한 항목이 저장돼 있을 수 있는 모든 키 — 슬러그와 옛 번호 (정리 SQL 전의 행을 함께 지울 때) */
export function kwcagStoredKeys(slug: KwcagSlug): string[] {
  return [slug, ...Object.keys(KWCAG_LEGACY_IDS).filter((id) => KWCAG_LEGACY_IDS[id] === slug)];
}

export interface KwcagInputMatch {
  item: KwcagItem;
  /** 입력한 번호가 옛 a11ychk 번호로는 다른 항목이었거나, 옛 번호에만 있는 값일 때 */
  legacy?: { id: string; item: KwcagItem };
}

/**
 * 사람·에이전트 입력 해석 — 슬러그, 일련번호(1~33), 공식 번호 순으로 찾는다.
 * 공식 번호에 없는 옛 번호(7.4.1~7.4.4)는 옛 항목으로 찾는다.
 * 같은 숫자의 옛 뜻이 다르면 legacy로 함께 돌려줘 호출자가 안내할 수 있게 한다.
 */
export function resolveKwcagInput(input: string): KwcagInputMatch | null {
  const key = input.trim();
  const bySlug = KWCAG_BY_SLUG.get(key.toLowerCase());
  if (bySlug) return { item: bySlug };
  if (/^\d{1,2}$/.test(key)) {
    const item = KWCAG_ITEMS[Number(key) - 1];
    return item ? { item } : null;
  }
  const legacySlug = KWCAG_LEGACY_IDS[key];
  const legacyItem = legacySlug ? KWCAG_BY_SLUG.get(legacySlug) : undefined;
  const official = KWCAG_BY_KSNO.get(key);
  if (official) {
    return legacyItem && legacyItem !== official
      ? { item: official, legacy: { id: key, item: legacyItem } }
      : { item: official };
  }
  return legacyItem ? { item: legacyItem, legacy: { id: key, item: legacyItem } } : null;
}
