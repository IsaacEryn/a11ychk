import { describe, expect, it } from "vitest";
import { isRepeatingKey, normalizeForDedup, templateKey } from "../src/crawler/urlTemplate";

describe("templateKey — 세그먼트 정규화 규칙", () => {
  it("숫자 id → {n}", () => {
    expect(templateKey("https://e.com/products/1023")).toBe("/products/{n}");
    expect(templateKey("https://e.com/notice/000123")).toBe("/notice/{n}");
  });

  it("UUID → {uuid}", () => {
    expect(templateKey("https://e.com/item/f47ac10b-58cc-4372-a567-0e02b2c3d479")).toBe("/item/{uuid}");
  });

  it("날짜·연도 구분", () => {
    expect(templateKey("https://e.com/blog/2024-01-31/hi-there-post")).toBe("/blog/{date}/{slug}");
    expect(templateKey("https://e.com/archive/2024/123")).toBe("/archive/{year}/{n}");
    // 1800·3000은 연도 범위 밖 → 일반 숫자
    expect(templateKey("https://e.com/x/3000")).toBe("/x/{n}");
  });

  it("해시류 식별자 → {hash}", () => {
    expect(templateKey("https://e.com/d/9f8c2ab1e4d7c0b5")).toBe("/d/{hash}");
    expect(templateKey("https://e.com/d/a1b2c3d4e5f6a7b8c9")).toBe("/d/{hash}");
  });

  it("게시글 제목형 slug → {slug} (index≥1에서만)", () => {
    expect(templateKey("https://e.com/blog/my-first-post")).toBe("/blog/{slug}");
    expect(templateKey("https://e.com/blog/hello-world-guide")).toBe("/blog/{slug}");
  });

  it("첫 세그먼트는 slug로 치환하지 않는다 (섹션 구분 보존)", () => {
    // /blog/*와 /products/*가 다른 클러스터로 유지되어야 층화가 깨지지 않는다
    expect(templateKey("https://e.com/hello-world-guide")).toBe("/hello-world-guide");
    expect(templateKey("https://e.com/products/x")).not.toBe(templateKey("https://e.com/blog/x"));
  });

  it("짧은 사전적 세그먼트는 리터럴 유지", () => {
    expect(templateKey("https://e.com/about")).toBe("/about");
    expect(templateKey("https://e.com/contact-us")).toBe("/contact-us"); // 하이픈 1개·8자 미만
    expect(templateKey("https://e.com/login")).toBe("/login");
  });

  it("루트는 /", () => {
    expect(templateKey("https://e.com/")).toBe("/");
    expect(templateKey("https://e.com")).toBe("/");
  });
});

describe("templateKey — 클러스터 병합/분리", () => {
  it("같은 템플릿의 다른 글은 같은 키", () => {
    expect(templateKey("https://e.com/blog/1")).toBe(templateKey("https://e.com/blog/2"));
    expect(templateKey("https://e.com/blog/a-long-title")).toBe(templateKey("https://e.com/blog/other-title-x"));
  });

  it("query는 키에 영향 없음", () => {
    expect(templateKey("https://e.com/blog/1?utm=x")).toBe("/blog/{n}");
  });

  it("재현성 — 같은 입력 같은 출력", () => {
    const u = "https://e.com/2024/03/some-article-slug";
    expect(templateKey(u)).toBe(templateKey(u));
  });
});

describe("isRepeatingKey", () => {
  it("플레이스홀더 포함 여부", () => {
    expect(isRepeatingKey("/blog/{slug}")).toBe(true);
    expect(isRepeatingKey("/products/{n}")).toBe(true);
    expect(isRepeatingKey("/about")).toBe(false);
    expect(isRepeatingKey("/")).toBe(false);
  });
});

describe("normalizeForDedup", () => {
  it("페이지네이션·정렬 파라미터 제거 → 목록 페이지들이 한 URL로 접힘", () => {
    expect(normalizeForDedup("https://e.com/list?page=2")).toBe("https://e.com/list");
    expect(normalizeForDedup("https://e.com/list?page=3&sort=desc")).toBe("https://e.com/list");
    expect(normalizeForDedup("https://e.com/list?page=2")).toBe(normalizeForDedup("https://e.com/list?page=3"));
  });

  it("의미 있는 query는 보존하되 키 순서를 정렬", () => {
    expect(normalizeForDedup("https://e.com/x?b=2&a=1")).toBe("https://e.com/x?a=1&b=2");
    expect(normalizeForDedup("https://e.com/x?id=5&page=2")).toBe("https://e.com/x?id=5");
  });

  it("fragment 제거·hostname 소문자·후행 슬래시 보존", () => {
    expect(normalizeForDedup("https://E.com/a/#top")).toBe("https://e.com/a/");
  });

  it("파싱 불가 입력은 그대로 반환", () => {
    expect(normalizeForDedup("not a url")).toBe("not a url");
  });
});
