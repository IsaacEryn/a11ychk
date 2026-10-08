import { describe, expect, it } from "vitest";
import { cardLabel } from "../src/lib/billing/cardLabel";

describe("cardLabel — 화면·메일이 함께 쓰는 카드 표기", () => {
  it("토스 카드 종류(한국어 원값)를 언어에 맞는 이름으로, 번호는 토스가 준 마스킹 그대로", () => {
    expect(cardLabel({ cardType: "신용", number: "1234****" }, "ko")).toBe("신용카드 1234****");
    expect(cardLabel({ cardType: "체크", number: "1234****" }, "en")).toBe("Debit card 1234****");
    expect(cardLabel({ cardType: "기프트", number: "1234****" }, "en")).toBe("Gift card 1234****");
  });
  it("모르는 종류는 한국어에서만 원값, 영어에서는 빼고 번호만 — 한국어 원값이 영문에 섞이지 않는다", () => {
    expect(cardLabel({ cardType: "법인", number: "1234****" }, "ko")).toBe("법인 1234****");
    expect(cardLabel({ cardType: "법인", number: "1234****" }, "en")).toBe("1234****");
    expect(cardLabel({ cardType: null, number: "1234****" }, "ko")).toBe("1234****");
  });
  it("번호가 없거나 카드가 없으면 null", () => {
    expect(cardLabel({ cardType: "신용", number: null }, "ko")).toBeNull();
    expect(cardLabel(null, "ko")).toBeNull();
    expect(cardLabel(undefined, "en")).toBeNull();
  });
});
