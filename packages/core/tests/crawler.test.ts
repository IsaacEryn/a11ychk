import { describe, expect, it } from "vitest";
import {
  extractLinks,
  fetchSitemapEntries,
  isSameOrigin,
  normalizeUrl,
  prioritizeUrls,
  resolveCanonicalRoot,
} from "../src/crawler/collectPages";

const xmlRes = (body: string, ok = true) =>
  Promise.resolve(new Response(body, { status: ok ? 200 : 404, headers: { "content-type": "application/xml" } }));

describe("normalizeUrl", () => {
  it("fragment 제거·hostname 소문자화, 후행 슬래시는 보존", () => {
    expect(normalizeUrl("https://Example.com/a/#section")).toBe("https://example.com/a/");
    // 회귀 방지: canonical 슬래시를 떼면 /a → /a/ 308 리다이렉트 → 빈 문서 axe 유령 위반
    expect(normalizeUrl("https://example.com/a/")).toBe("https://example.com/a/");
    expect(normalizeUrl("https://example.com/a")).toBe("https://example.com/a");
    expect(normalizeUrl("https://example.com/")).toBe("https://example.com/");
    expect(normalizeUrl("https://example.com")).toBe("https://example.com/");
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

describe("fetchSitemapEntries — lastmod/priority 파싱 + index 다중 순회", () => {
  it("<url> 블록의 loc·lastmod·priority를 함께 추출", async () => {
    const xml = `<?xml version="1.0"?><urlset>
      <url><loc>https://e.com/blog/1</loc><lastmod>2026-07-01</lastmod><priority>0.8</priority></url>
      <url><loc>https://e.com/about</loc></url>
    </urlset>`;
    const entries = await fetchSitemapEntries("https://e.com", () => xmlRes(xml));
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({ loc: "https://e.com/blog/1", lastmod: "2026-07-01", priority: 0.8 });
    expect(entries[1]!.lastmod).toBeUndefined();
    expect(entries[1]!.priority).toBeUndefined();
  });

  it("sitemap index면 same-origin 하위 sitemap을 상위 N개까지 순회", async () => {
    const index = `<sitemapindex>
      <sitemap><loc>https://e.com/sitemap-a.xml</loc></sitemap>
      <sitemap><loc>https://e.com/sitemap-b.xml</loc></sitemap>
      <sitemap><loc>https://e.com/sitemap-c.xml</loc></sitemap>
    </sitemapindex>`;
    const child = (n: string) => `<urlset><url><loc>https://e.com/${n}</loc></url></urlset>`;
    const fetcher = (u: string) => {
      if (u.endsWith("/sitemap.xml")) return xmlRes(index);
      if (u.endsWith("sitemap-a.xml")) return xmlRes(child("a"));
      if (u.endsWith("sitemap-b.xml")) return xmlRes(child("b"));
      return xmlRes(child("c"));
    };
    // maxChildSitemaps=2 → 앞의 두 하위만
    const entries = await fetchSitemapEntries("https://e.com", fetcher, { maxChildSitemaps: 2 });
    expect(entries.map((e) => e.loc)).toEqual(["https://e.com/a", "https://e.com/b"]);
  });

  it("maxEntries 초과분은 절단", async () => {
    const urls = Array.from({ length: 10 }, (_, i) => `<url><loc>https://e.com/p/${i}</loc></url>`).join("");
    const entries = await fetchSitemapEntries("https://e.com", () => xmlRes(`<urlset>${urls}</urlset>`), {
      maxEntries: 4,
    });
    expect(entries).toHaveLength(4);
  });

  it("sitemap 없음(404) → 빈 배열", async () => {
    const entries = await fetchSitemapEntries("https://e.com", () => xmlRes("", false));
    expect(entries).toEqual([]);
  });
});

describe("resolveCanonicalRoot — 리다이렉트 최종(canonical) 루트 확정", () => {
  const html = '<!DOCTYPE html><html><head></head><body><a href="/a">a</a></body></html>';
  const resWith = (url: string) => {
    const r = new Response(html, { status: 200, headers: { "content-type": "text/html" } });
    Object.defineProperty(r, "url", { value: url });
    return r;
  };

  it("apex→www 리다이렉트면 www를 canonical로 채택하고 루트 HTML을 함께 반환한다", async () => {
    const { canonicalRoot, rootHtml } = await resolveCanonicalRoot("https://codeslog.com/", () =>
      Promise.resolve(resWith("https://www.codeslog.com/")),
    );
    expect(canonicalRoot).toBe("https://www.codeslog.com/");
    expect(rootHtml).toContain("<a href=");
  });

  it("www→apex 방향도 canonical로 반영한다", async () => {
    const { canonicalRoot } = await resolveCanonicalRoot("https://www.codeslog.com/", () =>
      Promise.resolve(resWith("https://codeslog.com/")),
    );
    expect(canonicalRoot).toBe("https://codeslog.com/");
  });

  it("전혀 다른 사이트로 튀는 리다이렉트는 입력을 유지한다(www 차이만 채택)", async () => {
    const { canonicalRoot } = await resolveCanonicalRoot("https://bit.ly/x", () =>
      Promise.resolve(resWith("https://evil.example.com/")),
    );
    expect(canonicalRoot).toBe("https://bit.ly/x");
  });

  it("같은 호스트의 경로 리다이렉트는 그 경로를 canonical로 반영한다", async () => {
    const { canonicalRoot } = await resolveCanonicalRoot("https://example.com/", () =>
      Promise.resolve(resWith("https://example.com/ko")),
    );
    expect(canonicalRoot).toBe("https://example.com/ko");
  });

  it("최종 URL을 알 수 없으면(res.url 없음) 입력을 유지한다", async () => {
    const { canonicalRoot } = await resolveCanonicalRoot("https://example.com/", () =>
      Promise.resolve(new Response(html, { status: 200, headers: { "content-type": "text/html" } })),
    );
    expect(canonicalRoot).toBe("https://example.com/");
  });

  it("루트 fetch가 실패하면 입력을 유지한다", async () => {
    const { canonicalRoot } = await resolveCanonicalRoot("https://example.com/", () =>
      Promise.reject(new Error("network")),
    );
    expect(canonicalRoot).toBe("https://example.com/");
  });
});

describe("buildSample — apex→www 리다이렉트 사이트 수집", () => {
  it("리다이렉트 최종 origin의 sitemap·링크로 표본을 구성한다(수집 0 회귀 방지)", async () => {
    const html = `<!DOCTYPE html><html lang="ko"><body>
      <a href="https://www.codeslog.com/about">소개</a>
      <a href="https://www.codeslog.com/login">로그인</a>
      <a href="https://www.codeslog.com/contact">문의</a>
      <a href="https://www.codeslog.com/blog/1">글</a></body></html>`;
    // apex로 요청해도 최종 URL은 www — extractLinks가 www 절대 링크를 same-origin으로 인정해야 표본이 는다
    const fetcher = (u: string): Promise<Response> => {
      if (u.includes("/sitemap.xml")) return Promise.resolve(new Response("", { status: 404 }));
      const r = new Response(html, { status: 200, headers: { "content-type": "text/html" } });
      Object.defineProperty(r, "url", { value: "https://www.codeslog.com/" });
      return Promise.resolve(r);
    };
    const result = await import("../src/crawler/buildSample").then((m) =>
      m.buildSample("https://codeslog.com/", { maxPages: 5, fetcher }),
    );
    // 루트가 canonical(www)로 잡히고, 내부 링크가 표본에 포함되어야 한다
    expect(result.pages[0]!.url).toBe("https://www.codeslog.com/");
    expect(result.pages.length).toBeGreaterThan(1);
    expect(result.pages.every((p) => new URL(p.url).hostname === "www.codeslog.com")).toBe(true);
  });
});
