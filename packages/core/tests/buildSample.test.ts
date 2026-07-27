import { describe, expect, it } from "vitest";
import { buildSample, detectTechnologies } from "../src/crawler/buildSample";
import { categorizePage } from "../src/crawler/stratifiedSample";

describe("categorizePage", () => {
  it("루트는 home", () => {
    expect(categorizePage("https://x.com/", true)).toBe("home");
  });
  it("경로로 공통 페이지 유형 분류", () => {
    expect(categorizePage("https://x.com/login", false)).toBe("login");
    expect(categorizePage("https://x.com/contact-us", false)).toBe("contact");
    expect(categorizePage("https://x.com/privacy-policy", false)).toBe("legal");
    expect(categorizePage("https://x.com/help/faq", false)).toBe("help");
    expect(categorizePage("https://x.com/checkout", false)).toBe("form");
    expect(categorizePage("https://x.com/blog/post-1", false)).toBe("content");
  });
});

describe("detectTechnologies", () => {
  it("HTML 특징으로 기술 감지", () => {
    const tech = detectTechnologies(
      `<html><head><link rel="stylesheet" href="a.css"></head><body>
       <script src="app.js"></script><button aria-label="x" role="button"></button>
       <svg></svg><a href="/doc.pdf">문서</a></body></html>`,
    );
    expect(tech).toContain("HTML");
    expect(tech).toContain("CSS");
    expect(tech).toContain("JavaScript");
    expect(tech).toContain("WAI-ARIA");
    expect(tech).toContain("SVG");
    expect(tech).toContain("PDF");
  });
});

describe("buildSample", () => {
  const HTML = `<!DOCTYPE html><html lang="ko"><head><title>홈</title>
    <link rel="stylesheet" href="/s.css"><script src="/a.js"></script></head><body>
    <a href="/login">로그인</a><a href="/contact">문의</a><a href="/privacy">개인정보</a>
    <a href="/blog/1">글1</a><a href="/blog/2">글2</a><a href="/blog/3">글3</a>
    <a href="/products/a">상품A</a><a href="/products/b">상품B</a>
    </body></html>`;

  function fetcher(): Promise<Response> {
    return Promise.resolve(
      new Response(HTML, { status: 200, headers: { "content-type": "text/html" } }),
    );
  }

  it("구조 표본에 루트(home)와 공통 페이지 유형이 포함된다", async () => {
    const result = await buildSample("https://example.com/", { maxPages: 6, fetcher });
    const structured = result.pages.filter((p) => p.sampleType === "structured");
    expect(structured[0]).toMatchObject({ category: "home" });
    const cats = new Set(structured.map((p) => p.category));
    expect(cats.has("login")).toBe(true);
    expect(cats.has("contact")).toBe(true);
    expect(structured.length).toBeLessThanOrEqual(6);
  });

  it("무작위 표본은 구조 표본의 10%(ceil)만큼 추가된다", async () => {
    const result = await buildSample("https://example.com/", { maxPages: 6, fetcher });
    const structured = result.pages.filter((p) => p.sampleType === "structured");
    const random = result.pages.filter((p) => p.sampleType === "random");
    expect(random.length).toBe(Math.ceil(structured.length * 0.1));
    // 구조·무작위 표본은 서로 겹치지 않는다
    const sUrls = new Set(structured.map((p) => p.url));
    expect(random.every((p) => !sUrls.has(p.url))).toBe(true);
  });

  it("기술 감지 결과와 표본 방법 설명을 포함한다", async () => {
    const result = await buildSample("https://example.com/", { maxPages: 6, fetcher });
    expect(result.technologies).toContain("CSS");
    expect(result.technologies).toContain("JavaScript");
    expect(result.sampleMethod).toContain("무작위");
  });
});

describe("buildSample — 반복 콘텐츠(게시판) 대표 수집", () => {
  // sitemap에 게시글 40개(/blog/{n}) + 공통 페이지. 한도가 작아도 대표 글이 포함돼야 한다.
  const sitemap = () => {
    const posts = Array.from({ length: 40 }, (_, i) => `<url><loc>https://b.com/blog/${i + 1}</loc></url>`).join("");
    return `<?xml version="1.0"?><urlset>
      <url><loc>https://b.com/login</loc></url>
      <url><loc>https://b.com/contact</loc></url>
      ${posts}
    </urlset>`;
  };
  const fetcher = (u: string): Promise<Response> => {
    if (u.includes("/sitemap.xml")) {
      return Promise.resolve(new Response(sitemap(), { status: 200, headers: { "content-type": "application/xml" } }));
    }
    if (u.includes("/robots.txt")) return Promise.resolve(new Response("", { status: 404 }));
    const r = new Response("<!DOCTYPE html><html lang=ko><body>root</body></html>", {
      status: 200,
      headers: { "content-type": "text/html" },
    });
    Object.defineProperty(r, "url", { value: "https://b.com/" });
    return Promise.resolve(r);
  };

  it("free=5에서도 게시판 대표 글이 최소 1개 포함된다", async () => {
    const result = await buildSample("https://b.com/", { maxPages: 5, fetcher });
    const structured = result.pages.filter((p) => p.sampleType === "structured");
    const reps = structured.filter((p) => p.isRepeating && p.templateKey === "/blog/{n}");
    expect(reps.length).toBeGreaterThanOrEqual(1);
    // 클러스터 요약이 결과에 실린다
    const cluster = result.clusters?.find((c) => c.templateKey === "/blog/{n}");
    expect(cluster).toMatchObject({ total: 40 });
    expect(cluster!.sampled).toBeGreaterThanOrEqual(1);
  });

  it("한도가 크면 대표 글이 비례해서 더 많이 수집된다", async () => {
    const small = await buildSample("https://b.com/", { maxPages: 5, fetcher });
    const large = await buildSample("https://b.com/", { maxPages: 20, fetcher });
    const repCount = (r: Awaited<ReturnType<typeof buildSample>>) =>
      r.pages.filter((p) => p.sampleType === "structured" && p.templateKey === "/blog/{n}").length;
    expect(repCount(large)).toBeGreaterThan(repCount(small));
  });

  it("결정적 — 같은 입력이면 같은 표본", async () => {
    const a = await buildSample("https://b.com/", { maxPages: 12, fetcher });
    const b = await buildSample("https://b.com/", { maxPages: 12, fetcher });
    expect(a.pages.map((p) => p.url)).toEqual(b.pages.map((p) => p.url));
  });
});
