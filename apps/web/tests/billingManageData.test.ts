import { describe, expect, it } from "vitest";
import { cardSummaryOf } from "../src/lib/billing/manageData";

describe("cardSummaryOf — 결제 관리에 보일 카드 요약만 남긴다", () => {
  it("토스 카드 요약의 세 문자열 필드만", () => {
    expect(cardSummaryOf({ issuerCode: "61", number: "1234****", cardType: "신용", billingKey: "bk_plain", extra: 1 })).toEqual({
      issuerCode: "61",
      number: "1234****",
      cardType: "신용",
    });
  });

  it("문자열이 아닌 값은 버린다", () => {
    expect(cardSummaryOf({ issuerCode: 61, number: "1234****", cardType: { x: 1 } })).toEqual({ issuerCode: null, number: "1234****", cardType: null });
  });

  it("마스킹 번호가 없거나 문자열이 아니면 요약 없음(null)", () => {
    expect(cardSummaryOf({ issuerCode: "61", cardType: "신용" })).toBeNull();
    expect(cardSummaryOf({ number: 1234 })).toBeNull();
    expect(cardSummaryOf({ number: "" })).toBeNull();
    for (const raw of [null, undefined, "1234****", 42, []]) expect(cardSummaryOf(raw)).toBeNull();
  });

  it("64자를 넘는 값은 버린다(64자까지는 그대로)", () => {
    const at = "9".repeat(64);
    const over = "9".repeat(65);
    expect(cardSummaryOf({ number: at, cardType: over })).toEqual({ issuerCode: null, number: at, cardType: null });
    expect(cardSummaryOf({ number: over, cardType: "신용" })).toBeNull();
  });
});
