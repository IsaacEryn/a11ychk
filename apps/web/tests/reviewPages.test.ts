import { describe, expect, it } from "vitest";
import { derivePageAggregate, failedPages, isPageOutcome } from "@/lib/reviewPages";

describe("derivePageAggregate — 페이지별 판정 → 항목 판정 결합 규칙", () => {
  it("판정된 페이지가 없으면 null (항목 판정은 점검자 몫)", () => {
    expect(derivePageAggregate([])).toBeNull();
    expect(derivePageAggregate(["", ""])).toBeNull();
  });

  it("failed가 하나라도 있으면 failed", () => {
    expect(derivePageAggregate(["passed", "failed", "cannotTell"])).toBe("failed");
  });

  it("failed 없이 cannotTell이 있으면 cannotTell", () => {
    expect(derivePageAggregate(["passed", "cannotTell", "notPresent"])).toBe("cannotTell");
  });

  it("판정된 페이지가 전부 notPresent면 notPresent", () => {
    expect(derivePageAggregate(["notPresent", "notPresent"])).toBe("notPresent");
  });

  it("passed와 notPresent 혼합이면 passed", () => {
    expect(derivePageAggregate(["passed", "notPresent"])).toBe("passed");
  });

  it("미판정(빈 값)·잘못된 값은 무시하고 판정된 페이지만으로 결합한다", () => {
    expect(derivePageAggregate(["", "passed", "bogus"])).toBe("passed");
  });
});

describe("failedPages — pages(위반 페이지) 파생", () => {
  it("failed로 판정된 URL만 추린다", () => {
    expect(
      failedPages({ "https://a.test/": "passed", "https://b.test/": "failed", "https://c.test/": "cannotTell" }),
    ).toEqual(["https://b.test/"]);
  });
});

describe("isPageOutcome", () => {
  it("enum 값만 허용한다", () => {
    expect(isPageOutcome("failed")).toBe(true);
    expect(isPageOutcome("")).toBe(false);
    expect(isPageOutcome("notChecked")).toBe(false);
  });
});
