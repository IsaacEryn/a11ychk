import { describe, expect, it } from "vitest";
import {
  KWCAG_LEGACY_IDS,
  kwcagFromStored,
  kwcagStoredKeys,
  resolveKwcagInput,
  toStoredKwcagKey,
} from "../src/catalog/kwcagLegacy";

/** 바꾸기 전 카탈로그(a6f4ef7)의 (옛 번호 → 슬러그) 33쌍. 고치지 말 것 */
const BEFORE: Record<string, string> = {
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
};

describe("옛 a11ychk 번호 대응표", () => {
  it("바꾸기 전 카탈로그와 같다", () => {
    expect({ ...KWCAG_LEGACY_IDS }).toEqual(BEFORE);
  });
});

describe("kwcagFromStored — 저장·전송값 해석 (숫자는 옛 번호로만)", () => {
  it("슬러그는 그대로 찾는다", () => {
    expect(kwcagFromStored("text-contrast")?.ksNo).toBe("5.4.3");
  });

  it("숫자는 옛 번호로 푼다 — 공식 번호로 풀지 않는다", () => {
    expect(kwcagFromStored("5.4.3")?.slug).toBe("distinguishable-content"); // 공식 5.4.3은 명도 대비
    expect(kwcagFromStored("5.4.1")?.slug).toBe("text-contrast"); // 공식 5.4.1은 색
    expect(kwcagFromStored("7.3.1")?.slug).toBe("meaningful-sequence"); // 공식 7.3.1은 오류 정정
    expect(kwcagFromStored("7.4.2")?.slug).toBe("error-identification");
  });

  it("옛 체계에 없던 번호와 모르는 값은 undefined", () => {
    expect(kwcagFromStored("5.3.3")).toBeUndefined(); // 공식 번호에만 있다
    expect(kwcagFromStored("nope")).toBeUndefined();
    expect(kwcagFromStored("")).toBeUndefined();
  });

  it("toStoredKwcagKey는 슬러그를 돌려주고 풀 수 없으면 null", () => {
    expect(toStoredKwcagKey("7.4.1")).toBe("labels-for-inputs");
    expect(toStoredKwcagKey("labels-for-inputs")).toBe("labels-for-inputs");
    expect(toStoredKwcagKey("x")).toBeNull();
  });

  it("kwcagStoredKeys는 슬러그와 옛 번호를 함께 돌려준다", () => {
    expect(kwcagStoredKeys("labels-for-inputs")).toEqual(["labels-for-inputs", "7.4.1"]);
    expect(kwcagStoredKeys("focus-order-and-visibility")).toEqual(["focus-order-and-visibility", "6.1.2"]);
  });
});

describe("resolveKwcagInput — 사람·에이전트 입력 해석", () => {
  it("슬러그 (앞뒤 공백·대문자 허용)", () => {
    expect(resolveKwcagInput(" Text-Contrast ")).toEqual({ item: kwcagFromStored("text-contrast") });
  });

  it("일련번호 1~33", () => {
    expect(resolveKwcagInput("8")?.item.slug).toBe("text-contrast");
    expect(resolveKwcagInput("33")?.item.slug).toBe("aria-accessibility");
    expect(resolveKwcagInput("0")).toBeNull();
    expect(resolveKwcagInput("34")).toBeNull();
  });

  it("공식 번호 — 옛 뜻과 같으면 안내 없음", () => {
    expect(resolveKwcagInput("5.3.3")).toEqual({ item: kwcagFromStored("clear-instructions") });
    expect(resolveKwcagInput("6.1.2")?.legacy).toBeUndefined();
    expect(resolveKwcagInput("5.4.2")?.legacy).toBeUndefined();
  });

  it("공식 번호 — 옛 뜻이 다르면 legacy로 함께 알린다", () => {
    const m = resolveKwcagInput("5.4.1");
    expect(m?.item.slug).toBe("content-not-relying-on-color-alone");
    expect(m?.legacy).toEqual({ id: "5.4.1", item: kwcagFromStored("text-contrast") });
    expect(resolveKwcagInput("7.3.1")?.legacy?.item.slug).toBe("meaningful-sequence");
  });

  it("옛 번호에만 있는 값(7.4.x)은 옛 항목으로 찾고 legacy로 알린다", () => {
    const m = resolveKwcagInput("7.4.1");
    expect(m?.item.slug).toBe("labels-for-inputs");
    expect(m?.legacy?.id).toBe("7.4.1");
  });

  it("모르는 값은 null", () => {
    expect(resolveKwcagInput("9.9.9")).toBeNull();
    expect(resolveKwcagInput("")).toBeNull();
  });
});
