import { describe, expect, it } from "vitest";
import { extractLinks, isSameOrigin, normalizeUrl, prioritizeUrls } from "../src/crawler/collectPages";

describe("normalizeUrl", () => {
  it("fragment 제거·후행 슬래시 통일", () => {
    expect(normalizeUrl("https://Example.com/a/#section")).toBe("https://example.com/a");
    expect(normalizeUrl("https://example.com/a/")).toBe("https://example.com/a");
    expect(normalizeUrl("https://example.com/")).toBe("https://example.com/");
  });

  it("상대 경로 해석", () => {
    expect(normalizeUrl("/about", "https://example.com/home")).toBe("https://example.com/about");
  });

  it("비 http 스킴은 null", () => {
    expect(normalizeUrl("mailto:a@b.c")).toBeNull();
    expect(normalizeUrl("javascript:void(0)")).toBeNull();
  });
});

describe("extractLinks", () => {
  it("a href 추출 + 특수 링크 제외 + 중복 제거", () => {
    const html = `
      <a href="/about">소개</a>
      <a href='/about'>소개2</a>
      <a href="#top">위로</a>
      <a href="mailto:x@y.z">메일</a>
      <a href="tel:010">전화</a>
      <a href="javascript:void(0)">js</a>
      <a class="btn" href="https://example.com/pricing">요금</a>
    `;
    const links = extractLinks(html, "https://example.com/");
    expect(links).toContain("https://example.com/about");
    expect(links).toContain("https://example.com/pricing");
    expect(links).toHaveLength(2);
  });
});

describe("isSameOrigin", () => {
  it("스킴·호스트·포트 일치 판정", () => {
    expect(isSameOrigin("https://a.com/x", "https://a.com/y")).toBe(true);
    expect(isSameOrigin("https://a.com", "http://a.com")).toBe(false);
    expect(isSameOrigin("https://a.com", "https://b.com")).toBe(false);
  });
});

describe("prioritizeUrls", () => {
  it("루트 제외, 얕은 경로·새로운 섹션 우선", () => {
    const root = "https://example.com/";
    const urls = [
      "https://example.com/blog/2024/01/post-1",
      "https://example.com/about",
      "https://example.com/blog",
      root,
    ];
    const sorted = prioritizeUrls(urls, root);
    expect(sorted).not.toContain(root);
    expect(sorted[0]).toBe("https://example.com/about");
    expect(sorted[1]).toBe("https://example.com/blog");
    expect(sorted[2]).toBe("https://example.com/blog/2024/01/post-1");
  });
});
