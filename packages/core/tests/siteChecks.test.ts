import { describe, expect, it } from "vitest";
import { computeNotPresentScs, computeSiteChecks } from "../src/report/siteChecks";
import type { PageSignature } from "../src/types";

function sig(partial: Partial<PageSignature>): PageSignature {
  return {
    url: "https://example.com/",
    title: "홈",
    navLinks: ["회사소개", "제품", "문의"],
    hasSearch: false,
    hasSitemap: false,
    hasMedia: false,
    ...partial,
  };
}

describe("computeSiteChecks", () => {
  it("표본이 1개면 사이트 검사를 하지 않는다", () => {
    expect(computeSiteChecks([sig({})])).toEqual([]);
  });

  it("모든 페이지 제목이 같으면 2.4.2 위반", () => {
    const out = computeSiteChecks([
      sig({ url: "https://x.com/a", title: "사이트" }),
      sig({ url: "https://x.com/b", title: "사이트" }),
    ]);
    const r = out.find((o) => o.ruleId === "a11ychk:page-title-unique");
    expect(r?.outcome).toBe("failed");
    expect(r?.count).toBe(2);
  });

  it("제목이 서로 다르면 2.4.2 위반 없음", () => {
    const out = computeSiteChecks([
      sig({ url: "https://x.com/a", title: "홈" }),
      sig({ url: "https://x.com/b", title: "회사소개" }),
    ]);
    expect(out.find((o) => o.ruleId === "a11ychk:page-title-unique")).toBeUndefined();
  });

  it("검색·사이트맵이 없으면 2.4.5 위반, 있으면 통과", () => {
    const noWay = computeSiteChecks([
      sig({ url: "https://x.com/a", title: "홈" }),
      sig({ url: "https://x.com/b", title: "회사" }),
    ]);
    expect(noWay.find((o) => o.ruleId === "a11ychk:multiple-ways")?.outcome).toBe("failed");

    const withSearch = computeSiteChecks([
      sig({ url: "https://x.com/a", title: "홈", hasSearch: true }),
      sig({ url: "https://x.com/b", title: "회사" }),
    ]);
    expect(withSearch.find((o) => o.ruleId === "a11ychk:multiple-ways")?.outcome).toBe("passed");
  });

  it("내비게이션 순서가 다르면 3.2.3 확인 필요(review)", () => {
    const out = computeSiteChecks([
      sig({ url: "https://x.com/a", navLinks: ["회사소개", "제품", "문의"] }),
      sig({ url: "https://x.com/b", navLinks: ["제품", "회사소개", "문의"] }),
    ]);
    expect(out.find((o) => o.ruleId === "a11ychk:consistent-navigation")?.outcome).toBe("review");
  });

  it("computeNotPresentScs — 전 페이지 시그니처 확보 + 미디어 전무일 때만 1.2.x 반환", () => {
    const a = sig({ url: "https://x.com/a" });
    const b = sig({ url: "https://x.com/b" });
    expect(computeNotPresentScs([a, b], 2)).toContain("1.2.1");
    expect(computeNotPresentScs([a, b], 2)).toHaveLength(5);
    // 한 페이지라도 미디어가 있으면 판단하지 않음
    expect(computeNotPresentScs([a, sig({ url: "https://x.com/c", hasMedia: true })], 2)).toEqual([]);
    // 시그니처가 일부만 수집됐으면 판단 보류
    expect(computeNotPresentScs([a], 2)).toEqual([]);
    expect(computeNotPresentScs([], 0)).toEqual([]);
  });

  it("내비게이션 순서가 일관되면 3.2.3 통과", () => {
    const out = computeSiteChecks([
      sig({ url: "https://x.com/a", navLinks: ["회사소개", "제품", "문의"] }),
      sig({ url: "https://x.com/b", navLinks: ["회사소개", "제품", "문의", "로그인"] }),
    ]);
    expect(out.find((o) => o.ruleId === "a11ychk:consistent-navigation")?.outcome).toBe("passed");
  });
});
