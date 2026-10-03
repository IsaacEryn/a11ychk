import { describe, expect, it } from "vitest";
import {
  migrateReviewKeys,
  normalizeKwcagKeys,
  normalizeKwcagMatrix,
  normalizeReviewRows,
} from "../src/catalog/kwcagStored";
import type { KwcagMatrixRow, KwcagStatus } from "../src/types";

const row = (itemId: string, status: KwcagStatus = "manual"): KwcagMatrixRow => ({
  itemId,
  status,
  violationCount: 0,
  ruleIds: [],
});

describe("normalizeKwcagMatrix", () => {
  it("옛 번호 요약을 슬러그·공식 순서로 바꾼다", () => {
    const out = normalizeKwcagMatrix([row("7.4.1"), row("5.4.1", "fail"), row("5.3.1")]);
    expect(out.map((r) => r.itemId)).toEqual(["content-not-relying-on-color-alone", "text-contrast", "labels-for-inputs"]);
    expect(out[1]!.status).toBe("fail");
  });

  it("모르는 행은 버리고, 같은 항목이면 슬러그 행을 쓴다", () => {
    const out = normalizeKwcagMatrix([row("5.4.1", "fail"), row("text-contrast", "pass"), row("9.9.9")]);
    expect(out).toEqual([row("text-contrast", "pass")]);
  });

  it("없으면 빈 배열", () => {
    expect(normalizeKwcagMatrix(undefined)).toEqual([]);
    expect(normalizeKwcagMatrix(null)).toEqual([]);
  });
});

describe("normalizeReviewRows", () => {
  it("kwcag 옛 번호 행을 슬러그로 바꾸고 wcag 행은 그대로 둔다", () => {
    const out = normalizeReviewRows([
      { standard: "kwcag", item_id: "5.4.3", outcome: "failed" },
      { standard: "wcag", item_id: "1.4.3", outcome: "passed" },
    ]);
    expect(out).toEqual([
      { standard: "kwcag", item_id: "distinguishable-content", outcome: "failed" },
      { standard: "wcag", item_id: "1.4.3", outcome: "passed" },
    ]);
  });

  it("같은 항목의 옛 행·슬러그 행이 함께 있으면 슬러그 행만 남는다 (순서 무관)", () => {
    const out = normalizeReviewRows([
      { standard: "kwcag", item_id: "7.4.1", outcome: "failed" },
      { standard: "kwcag", item_id: "labels-for-inputs", outcome: "passed" },
    ]);
    expect(out).toEqual([{ standard: "kwcag", item_id: "labels-for-inputs", outcome: "passed" }]);
  });

  it("풀 수 없는 kwcag 행은 버린다 (옛 체계에 없던 숫자 포함)", () => {
    expect(normalizeReviewRows([{ standard: "kwcag", item_id: "5.3.3" }])).toEqual([]);
    expect(normalizeReviewRows(null)).toEqual([]);
  });
});

describe("normalizeKwcagKeys", () => {
  it("키를 슬러그로 바꾸고, 같은 항목이면 슬러그 키의 값을 쓴다", () => {
    expect(
      normalizeKwcagKeys({ "6.1.2": "failed", "focus-order-and-visibility": "passed", "7.3.2": "passed", nope: "x" }),
    ).toEqual({ "focus-order-and-visibility": "passed", "table-structure": "passed" });
  });
});

describe("migrateReviewKeys — 확장 저장소 키 정리", () => {
  const e = (outcome: string) => ({ outcome, note: "" });

  it("SC 키와 슬러그 키는 그대로 둔다", () => {
    expect(migrateReviewKeys({ "1.4.3": e("passed"), "distinguishable-content": e("failed") })).toEqual({
      map: { "1.4.3": e("passed"), "distinguishable-content": e("failed") },
      changed: false,
    });
  });

  it("옛 5.4.3(콘텐츠 간의 구분)은 슬러그 키로 옮긴다 — 1.4.3으로 가지 않는다", () => {
    expect(migrateReviewKeys({ "5.4.3": e("failed") })).toEqual({
      map: { "distinguishable-content": e("failed") },
      changed: true,
    });
  });

  it("옛 5.4.1(명도 대비)은 1.4.3으로, 옛 7.3.2(표의 구성)는 1.3.1로", () => {
    expect(migrateReviewKeys({ "5.4.1": e("failed") }).map).toEqual({ "1.4.3": e("failed") });
    expect(migrateReviewKeys({ "7.3.2": e("passed") }).map).toEqual({ "1.3.1": e("passed") });
  });

  it("옛 6.1.2는 대응 SC 세 개로 퍼진다", () => {
    expect(migrateReviewKeys({ "6.1.2": e("failed") }).map).toEqual({
      "2.4.3": e("failed"),
      "2.4.7": e("failed"),
      "2.4.11": e("failed"),
    });
  });

  it("이미 있는 SC 판정은 덮지 않는다", () => {
    expect(migrateReviewKeys({ "1.4.3": e("passed"), "5.4.1": e("failed") }).map).toEqual({ "1.4.3": e("passed") });
  });

  it("풀 수 없는 숫자 키는 그대로 둔다", () => {
    expect(migrateReviewKeys({ "9.9.9": e("passed"), "5.3.3": e("failed") })).toEqual({
      map: { "9.9.9": e("passed"), "5.3.3": e("failed") },
      changed: false,
    });
  });
});
