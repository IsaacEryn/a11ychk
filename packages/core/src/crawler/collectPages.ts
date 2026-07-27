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

/**
 * URL 정규화: fragment 제거, hostname 소문자화.
 * 후행 슬래시는 **보존**한다 — 사이트의 canonical 형태(sitemap/링크에 적힌 그대로)를
 * 유지해야 불필요한 리다이렉트를 유발하지 않는다. 예전엔 슬래시를 떼어 `/a/`를 `/a`로
 * 바꿨는데, 트레일링 슬래시를 canonical로 쓰는 사이트(Hugo·Jekyll 등)에서 `/a` 요청이
 * 308로 리다이렉트되고, 그 빈 응답 본문에 axe가 돌아 html-has-lang·document-title 등
 * 유령 위반이 생겼다. new URL(...)은 루트 경로에 한해 `/`를 붙이므로 루트는 항상 `/`로 남는다.
 */
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
  return url.toString();
}

export function isSameOrigin(a: string, b: string): boolean {
  try {
    return new URL(a).origin === new URL(b).origin;
  } catch {
    return false;
  }
}

/** 두 호스트가 www 프리픽스만 다른 같은 사이트인지 (apex ↔ www) */
function isWwwVariant(a: string, b: string): boolean {
  try {
    const strip = (h: string) => h.toLowerCase().replace(/^www\./, "");
    return strip(new URL(a).hostname) === strip(new URL(b).hostname);
  } catch {
    return false;
  }
}

/**
 * 대표(canonical) 루트 확정 — 루트를 실제로 fetch해 리다이렉트 최종 URL을 본다.
 * apex→www(codeslog.com → www.codeslog.com)처럼 대표 도메인이 리다이렉트로
 * 결정되는 사이트에서, 이후 sitemap·내부 링크의 same-origin 필터가 입력 origin이
 * 아니라 실제 콘텐츠 origin을 기준으로 동작하게 한다(그렇지 않으면 전량 걸러져 수집 0).
 *
 * 안전장치: 최종 호스트가 입력과 www 차이뿐일 때만 canonical로 채택한다. 단축 URL이
 * 전혀 다른 사이트로 튀는 경우 등은 입력을 유지해 예기치 않은 대상 이동을 막는다.
 * (경로 변화 example.com → example.com/ko 는 같은 호스트라 그대로 반영된다)
 * fetch로 얻은 루트 HTML도 함께 돌려줘 collectCandidates가 재fetch하지 않게 한다.
 */
export async function resolveCanonicalRoot(
  rootUrl: string,
  fetcher: (u: string) => Promise<Response>,
): Promise<{ canonicalRoot: string; rootHtml?: string }> {
  try {
    const res = await fetcher(rootUrl);
    const finalUrl = res.url ? normalizeUrl(res.url) : null;
    const canonicalRoot = finalUrl && isWwwVariant(finalUrl, rootUrl) ? finalUrl : rootUrl;
    let rootHtml: string | undefined;
    const contentType = res.headers.get("content-type") ?? "";
    if (res.ok && contentType.includes("html")) rootHtml = (await res.text()).slice(0, 3_000_000);
    return { canonicalRoot, rootHtml };
  } catch {
    // 루트 fetch 실패(네트워크 등) — 입력을 그대로 쓰고 이후 단계가 재시도/판단한다
    return { canonicalRoot: rootUrl };
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

/** sitemap 한 엔트리의 원본 신호 — 대표 글 선정(최신성·우선순위)에 쓴다. */
export interface SitemapEntry {
  loc: string;
  lastmod?: string;
  priority?: number;
  changefreq?: string;
}

/** 표본 후보 — URL과, 있으면 sitemap에서 얻은 최신성·우선순위 신호를 함께 나른다. */
export interface Candidate {
  url: string;
  lastmod?: string;
  priority?: number;
}

const SITEMAP_MAX_BYTES = 2_000_000;

/** sitemap XML을 `<url>`/`<sitemap>` 블록 단위로 파싱해 형제 신호(lastmod·priority 등)를 함께 묶는다. */
function parseSitemapXml(xml: string): { entries: SitemapEntry[]; isIndex: boolean } {
  const isIndex = /<sitemapindex[\s>]/i.test(xml);
  const entries: SitemapEntry[] = [];
  const blockRe = /<(url|sitemap)\b[^>]*>([\s\S]*?)<\/\1>/gi;
  let m: RegExpExecArray | null;
  while ((m = blockRe.exec(xml)) !== null) {
    const body = m[2] ?? "";
    const loc = /<loc>\s*([^<]+?)\s*<\/loc>/i.exec(body)?.[1]?.trim();
    if (!loc) continue;
    const lastmod = /<lastmod>\s*([^<]+?)\s*<\/lastmod>/i.exec(body)?.[1]?.trim();
    const priorityRaw = /<priority>\s*([^<]+?)\s*<\/priority>/i.exec(body)?.[1]?.trim();
    const changefreq = /<changefreq>\s*([^<]+?)\s*<\/changefreq>/i.exec(body)?.[1]?.trim();
    const priority = priorityRaw ? Number(priorityRaw) : NaN;
    entries.push({
      loc,
      lastmod: lastmod || undefined,
      priority: Number.isFinite(priority) ? priority : undefined,
      changefreq: changefreq || undefined,
    });
  }
  // 블록 매칭이 하나도 없으면(비표준 형식) bare <loc>만이라도 회수
  if (entries.length === 0) {
    for (const lm of xml.matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/gi)) {
      const loc = (lm[1] ?? "").trim();
      if (loc) entries.push({ loc });
    }
  }
  return { entries, isIndex };
}

/**
 * sitemap.xml에서 엔트리(loc + lastmod/priority) 수집.
 * sitemap index면 same-origin 하위 sitemap을 상위 N개(기본 5)까지 따라가고,
 * 총 엔트리 수(기본 5000)를 넘으면 절단한다(자원·시간 예산 보호).
 */
export async function fetchSitemapEntries(
  origin: string,
  fetcher: (u: string) => Promise<Response>,
  opts?: { maxChildSitemaps?: number; maxEntries?: number },
): Promise<SitemapEntry[]> {
  const maxChildSitemaps = opts?.maxChildSitemaps ?? 5;
  const maxEntries = opts?.maxEntries ?? 5000;
  try {
    const res = await fetcher(new URL("/sitemap.xml", origin).toString());
    if (!res.ok) return [];
    const { entries, isIndex } = parseSitemapXml((await res.text()).slice(0, SITEMAP_MAX_BYTES));
    if (!isIndex) return entries.slice(0, maxEntries);
    // sitemap index → same-origin 하위 sitemap 상위 N개 순회
    const children = entries
      .map((e) => e.loc)
      .filter((l) => isSameOrigin(l, origin))
      .slice(0, maxChildSitemaps);
    const collected: SitemapEntry[] = [];
    for (const child of children) {
      if (collected.length >= maxEntries) break;
      try {
        const childRes = await fetcher(child);
        if (!childRes.ok) continue;
        collected.push(...parseSitemapXml((await childRes.text()).slice(0, SITEMAP_MAX_BYTES)).entries);
      } catch {
        // 이 하위 sitemap만 건너뛴다
      }
    }
    return collected.slice(0, maxEntries);
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

/** 후보(메타 보존) 필터 — 정규화·same-origin·비HTML 제외·robots·중복 제거. */
function filterCandidateEntries(entries: Candidate[], rootUrl: string, robots: RobotsRules): Candidate[] {
  const root = new URL(rootUrl);
  const out: Candidate[] = [];
  const seen = new Set<string>();
  for (const e of entries) {
    const n = normalizeUrl(e.url);
    if (!n || seen.has(n)) continue;
    if (!isSameOrigin(n, root.origin)) continue;
    const parsed = new URL(n);
    if (NON_HTML_EXT.test(parsed.pathname)) continue;
    if (!isPathAllowed(robots, parsed.pathname + parsed.search)) continue;
    seen.add(n);
    out.push({ url: n, lastmod: e.lastmod, priority: e.priority });
  }
  return out;
}

/**
 * 후보 수집 (메타 보존 버전). sitemap 우선, 없으면 루트 문서 내부 링크(1-hop).
 * 루트는 candidates에 포함하지 않는다(표본 구성 시 별도 처리). 루트 HTML도 함께 반환.
 * sitemap 엔트리는 lastmod/priority 신호를 함께 나른다(링크 후보는 신호 없음).
 */
export async function collectCandidateEntries(
  rootUrl: string,
  robots: RobotsRules,
  fetcher: (u: string) => Promise<Response>,
  limit: number,
  preloadedRootHtml?: string,
): Promise<{ candidates: Candidate[]; rootHtml?: string; source: CrawlResult["source"] }> {
  const origin = new URL(rootUrl).origin;

  // 1) sitemap 우선
  const sitemapEntries = filterCandidateEntries(
    (await fetchSitemapEntries(origin, fetcher)).map((e) => ({ url: e.loc, lastmod: e.lastmod, priority: e.priority })),
    rootUrl,
    robots,
  ).filter((c) => c.url !== rootUrl);

  // 루트 HTML은 기술 감지·링크 수집에 필요하다. canonical 해석 단계에서 이미 받아온
  // HTML이 있으면 재fetch하지 않는다(리다이렉트 사이트에서 왕복 절약).
  let rootHtml: string | undefined = preloadedRootHtml;
  let linkCandidates: Candidate[] = [];
  try {
    if (rootHtml === undefined) {
      const res = await fetcher(rootUrl);
      const contentType = res.headers.get("content-type") ?? "";
      if (res.ok && contentType.includes("html")) rootHtml = (await res.text()).slice(0, 3_000_000);
    }
    if (rootHtml) {
      linkCandidates = filterCandidateEntries(
        extractLinks(rootHtml, rootUrl).map((u) => ({ url: u })),
        rootUrl,
        robots,
      ).filter((c) => c.url !== rootUrl);
    }
  } catch {
    // 무시 — 후보가 sitemap만으로 구성될 수 있음
  }

  if (sitemapEntries.length > 0) {
    return { candidates: sitemapEntries.slice(0, limit), rootHtml, source: "sitemap" };
  }
  if (linkCandidates.length > 0) {
    return { candidates: linkCandidates.slice(0, limit), rootHtml, source: "links" };
  }
  return { candidates: [], rootHtml, source: "root-only" };
}

/**
 * 후보 URL 수집 (문자열 버전, 하위 호환). collectCandidateEntries를 감싸 URL만 돌려준다.
 * collectPages()·기존 호출부가 의존하는 계약을 유지한다.
 */
export async function collectCandidates(
  rootUrl: string,
  robots: RobotsRules,
  fetcher: (u: string) => Promise<Response>,
  limit: number,
  preloadedRootHtml?: string,
): Promise<{ candidates: string[]; rootHtml?: string; source: CrawlResult["source"] }> {
  const { candidates, rootHtml, source } = await collectCandidateEntries(rootUrl, robots, fetcher, limit, preloadedRootHtml);
  return { candidates: candidates.map((c) => c.url), rootHtml, source };
}

/**
 * 루트 URL에서 시작해 최대 maxPages개의 대표 페이지 URL을 수집.
 * robots.txt에서 루트 자체가 차단되면 에러를 던진다.
 */
export async function collectPages(rootRawUrl: string, options: CrawlOptions): Promise<CrawlResult> {
  const fetcher = options.fetcher ?? ((u: string) => guardedFetch(u));
  const input = normalizeUrl(rootRawUrl);
  if (!input) throw new Error(`올바르지 않은 URL: ${rootRawUrl}`);

  // 대표 도메인 확정 — apex→www 등 리다이렉트 최종 URL을 이후 same-origin 기준으로 삼는다
  const { canonicalRoot, rootHtml } = await resolveCanonicalRoot(input, fetcher);
  const rootUrl = canonicalRoot;
  const origin = new URL(rootUrl).origin;

  const robots = await fetchRobots(origin);
  const rootPath = new URL(rootUrl).pathname + new URL(rootUrl).search;
  if (!isPathAllowed(robots, rootPath)) {
    throw new Error("해당 페이지는 robots.txt에서 크롤링을 허용하지 않습니다.");
  }

  const max = Math.max(1, options.maxPages);
  const pages = [rootUrl];
  if (max === 1) return { urls: pages, source: "root-only" };

  const { candidates, source } = await collectCandidates(rootUrl, robots, fetcher, max * 2, rootHtml);
  for (const u of prioritizeUrls(candidates, rootUrl)) {
    if (pages.length >= max) break;
    if (!pages.includes(u)) pages.push(u);
  }
  return { urls: pages, source: pages.length > 1 ? source : "root-only" };
}
