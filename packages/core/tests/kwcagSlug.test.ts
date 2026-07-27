import { describe, expect, it } from "vitest";
import { KWCAG_ITEMS } from "../src/catalog/kwcag";
import { KWCAG_BY_SLUG, KWCAG_SLUGS, kwcagSlug } from "../src/catalog/kwcagSlug";

/**
 * 슬러그는 공개 주소(/guide/{slug})가 되므로 한번 정하면 바꾸면 안 된다.
 * 항목명을 손보다가 주소가 딸려 바뀌는 사고를 여기서 막는다.
 */
describe("KWCAG 항목 슬러그", () => {
  it("33개 항목 전부에 슬러그가 있다", () => {
    expect(KWCAG_SLUGS).toHaveLength(33);
    expect(KWCAG_SLUGS.every((s) => s.length > 0)).toBe(true);
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
    for (const item of KWCAG_ITEMS) {
      expect(KWCAG_BY_SLUG.get(kwcagSlug(item))?.id).toBe(item.id);
    }
  });

  // 주소가 바뀌면 그동안 쌓인 검색 색인과 외부 링크가 끊긴다.
  // 항목명을 다듬더라도 이 값들은 그대로여야 한다.
  it("이미 공개한 주소는 고정이다", () => {
    const pinned: Record<string, string> = {
      "5.1.1": "alternative-text",
      "5.4.1": "text-contrast",
      "6.1.1": "keyboard-accessible",
      "6.1.3": "target-size",
      "6.4.3": "meaningful-link-text",
      "7.1.1": "language-of-page",
      "7.4.1": "labels-for-inputs",
      "8.1.1": "valid-markup",
      "8.2.1": "aria-accessibility",
    };
    for (const [id, slug] of Object.entries(pinned)) {
      const item = KWCAG_ITEMS.find((i) => i.id === id);
      expect(item, `${id} 항목이 사라졌다`).toBeDefined();
      expect(kwcagSlug(item!)).toBe(slug);
    }
  });
});
