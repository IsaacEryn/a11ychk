import { describe, expect, it } from "vitest";
import type { Candidate } from "../src/crawler/collectPages";
import { stratifiedSample } from "../src/crawler/stratifiedSample";

const ROOT = "https://e.com/";
const c = (path: string, extra?: Partial<Candidate>): Candidate => ({ url: `https://e.com${path}`, ...extra });

/** 배분 예시(plan): common login·contact·cart(form)·help·legal, static about·brand,
 *  클러스터 products120·blog30·notice12. */
function buildFixture(): Candidate[] {
  const list: Candidate[] = [
    c("/login"),
    c("/contact"),
    c("/cart/checkout"),
    c("/help/faq"),
    c("/privacy"),
    c("/about"),
    c("/brand"),
  ];
  for (let i = 1; i <= 120; i++) list.push(c(`/products/${i}`));
  for (let i = 1; i <= 30; i++) list.push(c(`/blog/${i}`));
  for (let i = 1; i <= 12; i++) list.push(c(`/notice/${i}`));
  return list;
}

const countCat = (structured: { category: string }[], cat: string) => structured.filter((p) => p.category === cat).length;
const clusterSampled = (clusters: { templateKey: string; sampled: number }[], key: string) =>
  clusters.find((cl) => cl.templateKey === key)?.sampled ?? 0;

describe("stratifiedSample — 한도 비례 배분", () => {
  it("free=5: 홈+로그인+문의 + 반복 콘텐츠 2종 대표", () => {
    const { structured, clusters } = stratifiedSample({ rootUrl: ROOT, candidates: buildFixture(), max: 5 });
    expect(structured).toHaveLength(5);
    expect(structured[0]!.category).toBe("home");
    expect(countCat(structured, "login")).toBe(1);
    expect(countCat(structured, "contact")).toBe(1);
    // 남은 2자리는 가장 큰 두 클러스터(products, blog) 대표
    expect(clusterSampled(clusters, "/products/{n}")).toBe(1);
    expect(clusterSampled(clusters, "/blog/{n}")).toBe(1);
    expect(clusterSampled(clusters, "/notice/{n}")).toBe(0);
  });

  it("enterprise=20: Round-1 11 + Round-2 9를 크기 비례로 (products8·blog3·notice1)", () => {
    const { structured, clusters } = stratifiedSample({ rootUrl: ROOT, candidates: buildFixture(), max: 20 });
    expect(structured).toHaveLength(20);
    expect(clusterSampled(clusters, "/products/{n}")).toBe(8);
    expect(clusterSampled(clusters, "/blog/{n}")).toBe(3);
    expect(clusterSampled(clusters, "/notice/{n}")).toBe(1);
  });

  it("per-cluster cap = ceil(max/2) — 경쟁 클러스터가 있으면 독식하지 못하고 넘침이 재분배된다", () => {
    // products가 훨씬 크지만 cap(=10)에 걸려 넘치는 몫은 blog로 재분배된다
    const cands: Candidate[] = [];
    for (let i = 1; i <= 120; i++) cands.push(c(`/products/${i}`));
    for (let i = 1; i <= 30; i++) cands.push(c(`/blog/${i}`));
    const max = 20;
    const { structured, clusters } = stratifiedSample({ rootUrl: ROOT, candidates: cands, max });
    expect(structured).toHaveLength(20);
    expect(clusterSampled(clusters, "/products/{n}")).toBe(Math.ceil(max / 2)); // 10에서 클램프
    expect(clusterSampled(clusters, "/blog/{n}")).toBe(9); // 넘친 몫 흡수
  });

  it("결정적 — 같은 입력이면 같은 표본, 순서 무관", () => {
    const a = stratifiedSample({ rootUrl: ROOT, candidates: buildFixture(), max: 12 });
    const shuffled = [...buildFixture()].reverse();
    const b = stratifiedSample({ rootUrl: ROOT, candidates: shuffled, max: 12 });
    expect(a.structured.map((p) => p.url).sort()).toEqual(b.structured.map((p) => p.url).sort());
  });

  it("lastmod 최신 글을 대표로 우선 선정", () => {
    const cands: Candidate[] = [
      c("/blog/1", { lastmod: "2020-01-01" }),
      c("/blog/2", { lastmod: "2026-07-01" }),
      c("/blog/3", { lastmod: "2023-05-05" }),
    ];
    const { structured } = stratifiedSample({ rootUrl: ROOT, candidates: cands, max: 2 });
    const rep = structured.find((p) => p.isRepeating);
    expect(rep!.url).toBe("https://e.com/blog/2");
  });

  it("크기 1 클러스터는 반복으로 잡지 않는다", () => {
    const cands: Candidate[] = [c("/products/9")]; // 단일 → 정적 콘텐츠로 흡수
    const { structured, clusters } = stratifiedSample({ rootUrl: ROOT, candidates: cands, max: 5 });
    expect(clusters).toHaveLength(0);
    expect(structured.some((p) => p.url === "https://e.com/products/9" && !p.isRepeating)).toBe(true);
  });

  it("max=1이면 루트만", () => {
    const { structured, clusters } = stratifiedSample({ rootUrl: ROOT, candidates: buildFixture(), max: 1 });
    expect(structured).toHaveLength(1);
    expect(clusters).toHaveLength(0);
  });

  it("페이지네이션 중복은 접힌다", () => {
    const cands: Candidate[] = [c("/list?page=1"), c("/list?page=2"), c("/list?page=3")];
    const { structured } = stratifiedSample({ rootUrl: ROOT, candidates: cands, max: 10 });
    // /list 하나로 접혀 루트 외 1개만
    expect(structured.filter((p) => p.url.includes("/list")).length).toBe(1);
  });
});
