/**
 * 대표 페이지 수집기.
 * 1) sitemap.xml이 있으면 그중 same-origin URL을 우선 사용
 * 2) 없으면 루트 문서에서 내부 링크를 추출(BFS 1단계)
 * 항상 robots.txt 규칙을 존중하고, 루트 URL을 첫 페이지로 포함한다.
 */
import type { CrawlOptions, CrawlResult } from "../types";
import { guardedFetch } from "../security/urlGuard";
import { fetchRobots, isPathAllowed, type RobotsRules } from "../security/robots";

/** 문서·미디어 등 HTML이 아닌 것으로 추정되는 확장자 */
const NON_HTML_EXT =
  /\.(png|jpe?g|gif|webp|avif|svg|ico|css|js|mjs|json|xml|pdf|zip|gz|tar|mp3|mp4|webm|mov|avi|woff2?|ttf|otf|eot|txt|csv|xlsx?|docx?|pptx?|hwpx?)$/i;

/** URL 정규화: fragment 제거, 기본 포트 제거, 후행 슬래시 통일 */
export function normalizeUrl(raw: string, base?: string): string | null {
  let url: URL;
  try {
    url = new URL(raw, base);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  url.hash = "";
  url.hostname = url.hostname.toLowerCase();
  if (url.pathname !== "/" && url.pathname.endsWith("/")) {
    url.pathname = url.pathname.slice(0, -1);
  }
  return url.toString();
}

export function isSameOrigin(a: string, b: string): boolean {
  try {
    return new URL(a).origin === new URL(b).origin;
  } catch {
    return false;
  }
}

/** HTML에서 <a href> 후보 추출 (경량 파서 — DOM 없이 정규식 사용) */
export function extractLinks(html: string, baseUrl: string): string[] {
  const out = new Set<string>();
  const re = /<a\b[^>]*?\bhref\s*=\s*("([^"]*)"|'([^']*)')/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const href = (m[2] ?? m[3] ?? "").trim();
    if (!href || href.startsWith("#") || href.startsWith("javascript:") || href.startsWith("mailto:") || href.startsWith("tel:")) {
      continue;
    }
    const normalized = normalizeUrl(href, baseUrl);
    if (normalized) out.add(normalized);
  }
  return [...out];
}

/** sitemap.xml에서 <loc> 추출 (sitemap index면 첫 하위 sitemap까지 따라감) */
async function fetchSitemapUrls(origin: string, fetcher: (u: string) => Promise<Response>): Promise<string[]> {
  const parse = (xml: string): { locs: string[]; isIndex: boolean } => {
    const locs = [...xml.matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/gi)].map((m) => (m[1] ?? "").trim());
    return { locs, isIndex: /<sitemapindex[\s>]/i.test(xml) };
  };
  try {
    const res = await fetcher(new URL("/sitemap.xml", origin).toString());
    if (!res.ok) return [];
    const { locs, isIndex } = parse((await res.text()).slice(0, 2_000_000));
    if (!isIndex) return locs;
    // sitemap index → 첫 번째 same-origin 하위 sitemap만 조회 (자원 절약)
    const child = locs.find((l) => isSameOrigin(l, origin));
    if (!child) return [];
    const childRes = await fetcher(child);
    if (!childRes.ok) return [];
    return parse((await childRes.text()).slice(0, 2_000_000)).locs;
  } catch {
    return [];
  }
}

/** 다양한 섹션을 고루 담기 위해 경로가 짧고 서로 다른 1-depth 경로를 우선 정렬 */
export function prioritizeUrls(urls: string[], rootUrl: string): string[] {
  const seenFirstSegment = new Set<string>();
  const scored = urls
    .filter((u) => u !== rootUrl)
    .map((u) => {
      const path = new URL(u).pathname;
      const segments = path.split("/").filter(Boolean);
      const first = segments[0] ?? "";
      const novel = !seenFirstSegment.has(first);
      if (first) seenFirstSegment.add(first);
      return { u, score: segments.length * 10 + (novel ? 0 : 5) + (NON_HTML_EXT.test(path) ? 1000 : 0) };
    })
    .sort((a, b) => a.score - b.score);
  return scored.map((s) => s.u);
}

function filterCandidates(urls: string[], rootUrl: string, robots: RobotsRules): string[] {
  const root = new URL(rootUrl);
  return urls
    .map((u) => normalizeUrl(u))
    .filter((u): u is string => !!u)
    .filter((u) => isSameOrigin(u, root.origin))
    .filter((u) => !NON_HTML_EXT.test(new URL(u).pathname))
    .filter((u) => isPathAllowed(robots, new URL(u).pathname + new URL(u).search));
}

/**
 * 후보 URL 수집 (표본 선정 전 단계). sitemap 우선, 없으면 루트 문서 내부 링크.
 * 루트는 candidates에 포함하지 않는다(표본 구성 시 별도 처리). 루트 HTML도 함께 반환.
 */
export async function collectCandidates(
  rootUrl: string,
  robots: RobotsRules,
  fetcher: (u: string) => Promise<Response>,
  limit: number,
): Promise<{ candidates: string[]; rootHtml?: string; source: CrawlResult["source"] }> {
  const origin = new URL(rootUrl).origin;

  // 1) sitemap 우선
  const sitemapUrls = filterCandidates(await fetchSitemapUrls(origin, fetcher), rootUrl, robots).filter(
    (u) => u !== rootUrl,
  );

  // 루트 HTML은 기술 감지·링크 수집에 필요하므로 가능하면 항상 가져온다
  let rootHtml: string | undefined;
  let linkCandidates: string[] = [];
  try {
    const res = await fetcher(rootUrl);
    const contentType = res.headers.get("content-type") ?? "";
    if (res.ok && contentType.includes("html")) {
      rootHtml = (await res.text()).slice(0, 3_000_000);
      linkCandidates = filterCandidates(extractLinks(rootHtml, rootUrl), rootUrl, robots).filter(
        (u) => u !== rootUrl,
      );
    }
  } catch {
    // 무시 — 후보가 sitemap만으로 구성될 수 있음
  }

  if (sitemapUrls.length > 0) {
    return { candidates: sitemapUrls.slice(0, limit), rootHtml, source: "sitemap" };
  }
  if (linkCandidates.length > 0) {
    return { candidates: linkCandidates.slice(0, limit), rootHtml, source: "links" };
  }
  return { candidates: [], rootHtml, source: "root-only" };
}

/**
 * 루트 URL에서 시작해 최대 maxPages개의 대표 페이지 URL을 수집.
 * robots.txt에서 루트 자체가 차단되면 에러를 던진다.
 */
export async function collectPages(rootRawUrl: string, options: CrawlOptions): Promise<CrawlResult> {
  const fetcher = options.fetcher ?? ((u: string) => guardedFetch(u));
  const rootUrl = normalizeUrl(rootRawUrl);
  if (!rootUrl) throw new Error(`올바르지 않은 URL: ${rootRawUrl}`);
  const origin = new URL(rootUrl).origin;

  const robots = await fetchRobots(origin);
  const rootPath = new URL(rootUrl).pathname + new URL(rootUrl).search;
  if (!isPathAllowed(robots, rootPath)) {
    throw new Error("해당 페이지는 robots.txt에서 크롤링을 허용하지 않습니다.");
  }

  const max = Math.max(1, options.maxPages);
  const pages = [rootUrl];
  if (max === 1) return { urls: pages, source: "root-only" };

  const { candidates, source } = await collectCandidates(rootUrl, robots, fetcher, max * 2);
  for (const u of prioritizeUrls(candidates, rootUrl)) {
    if (pages.length >= max) break;
    if (!pages.includes(u)) pages.push(u);
  }
  return { urls: pages, source: pages.length > 1 ? source : "root-only" };
}
