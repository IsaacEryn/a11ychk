import { describe, expect, it } from "vitest";
import { KWCAG_ITEMS } from "../src/catalog/kwcag";
import { KWCAG_BY_SLUG, KWCAG_SLUGS, kwcagItemsOf } from "../src/catalog/kwcagSlug";

/**
 * 슬러그는 공개 주소(/guide/{slug})이자 저장 키라 한번 정하면 바꾸면 안 된다.
 * 항목명을 손보거나 번호가 바뀌어도 이 값들은 그대로여야 한다.
 */
describe("KWCAG 항목 슬러그", () => {
  it("이미 공개한 주소 33개는 고정이다 (일련번호 순)", () => {
    expect(KWCAG_SLUGS).toEqual([
      "alternative-text",
      "captions-for-multimedia",
      "table-structure",
      "meaningful-sequence",
      "clear-instructions",
      "content-not-relying-on-color-alone",
      "no-auto-play",
      "text-contrast",
      "distinguishable-content",
      "keyboard-accessible",
      "focus-order-and-visibility",
      "target-size",
      "character-key-shortcuts",
      "adjustable-time-limits",
      "pause-stop-hide",
      "no-flashing-content",
      "skip-repeated-blocks",
      "page-frame-and-content-titles",
      "meaningful-link-text",
      "consistent-reference-locators",
      "single-pointer-gestures",
      "pointer-cancellation",
      "label-in-name",
      "motion-actuation",
      "language-of-page",
      "no-change-of-context-without-request",
      "consistent-help",
      "error-identification",
      "labels-for-inputs",
      "accessible-authentication",
      "redundant-entry",
      "valid-markup",
      "aria-accessibility",
    ]);
  });

  it("겹치는 슬러그가 없다", () => {
    expect(new Set(KWCAG_SLUGS).size).toBe(KWCAG_SLUGS.length);
  });

  it("URL에 그대로 쓸 수 있다 (소문자·숫자·하이픈)", () => {
    for (const slug of KWCAG_SLUGS) {
      expect(slug).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
      expect(encodeURIComponent(slug)).toBe(slug);
    }
  });

  it("슬러그로 원래 항목을 되찾을 수 있다", () => {
    for (const item of KWCAG_ITEMS) expect(KWCAG_BY_SLUG.get(item.slug)).toBe(item);
  });

  it("kwcagItemsOf는 일련번호 순 항목을 돌려주고 모르는 값은 뺀다", () => {
    expect(kwcagItemsOf(["labels-for-inputs", "text-contrast", "nope"]).map((i) => i.serial)).toEqual([8, 29]);
  });
});
