/**
 * WCAG-EM 2.0 Step 2·3 — 대상 탐색 + 대표 표본 선정.
 *
 * 페이지 분류(categorizePage)는 2.0 Step 2.1(공통 뷰: 홈·로그인·문의 등)과
 * 2.3(표본 유형 다양성)에, 무작위 표본은 Step 3.2(구조 표본의 10%)에 대응한다.
 * 구조 표본은 stratifiedSample(층화 표집 + 반복 콘텐츠 한도 비례 배분)이 선정하고,
 * 이 파일은 후보 수집·기술 감지·무작위 표본 추가·요약 문구 구성을 담당한다.
 * 프로세스(process) 표본은 자동 크롤 불가이므로 크롬 확장에 위임한다.
 */
import type { BuildSampleOptions, SampledPage, SampleResult } from "../types";
import { guardedFetch } from "../security/urlGuard";
import { fetchRobots, isPathAllowed } from "../security/robots";
import { collectCandidateEntries, normalizeUrl, resolveCanonicalRoot } from "./collectPages";
import { categorizePage, stratifiedSample } from "./stratifiedSample";
import { hashString } from "../util/hash";

/** 후보 풀 상한 — 반복 콘텐츠 클러스터 크기를 정확히 가늠하기 위해 넉넉히 확보(CPU만 소모). */
const CANDIDATE_POOL_LIMIT = 5000;

/** 루트 문서 HTML에서 의존 기술을 감지 */
export function detectTechnologies(html: string): string[] {
  const tech = new Set<string>(["HTML"]);
  const h = html.toLowerCase();
  if (/<link[^>]+stylesheet|<style[\s>]/.test(h)) tech.add("CSS");
  if (/<script[\s>]/.test(h)) tech.add("JavaScript");
  if (/\brole\s*=|\baria-[a-z]+\s*=/.test(h)) tech.add("WAI-ARIA");
  if (/<svg[\s>]|\.svg\b/.test(h)) tech.add("SVG");
  if (/\.pdf\b/.test(h)) tech.add("PDF");
  if (/<video[\s>]|<audio[\s>]/.test(h)) tech.add("HTML Media");
  return [...tech];
}

/** 결정적 시드 PRNG (mulberry32) — 재현 가능한 무작위 표본 */
function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * 대표 표본 구성.
 * - 구조 표본: 루트(home) + 공통 페이지 유형별 대표 + 반복 콘텐츠 대표(한도 비례) — stratifiedSample
 * - 무작위 표본: 남은 후보에서 시드 기반으로 ceil(구조표본 × 10%) 추가 선정
 */
export async function buildSample(rootRawUrl: string, options: BuildSampleOptions): Promise<SampleResult> {
  const fetcher = options.fetcher ?? ((u: string) => guardedFetch(u));
  const input = normalizeUrl(rootRawUrl);
  if (!input) throw new Error(`올바르지 않은 URL: ${rootRawUrl}`);

  // 대표 도메인 확정 — apex→www 등 리다이렉트 최종 URL을 same-origin 기준·표본 루트로 삼는다.
  // 이게 없으면 sitemap·내부 링크가 전부 다른 origin(www)으로 걸러져 표본이 루트 1개뿐이 된다.
  const { canonicalRoot, rootHtml: canonicalHtml } = await resolveCanonicalRoot(input, fetcher);
  const rootUrl = canonicalRoot;
  const origin = new URL(rootUrl).origin;

  const robots = await fetchRobots(origin);
  const rootPath = new URL(rootUrl).pathname + new URL(rootUrl).search;
  if (!isPathAllowed(robots, rootPath)) {
    throw new Error("해당 페이지는 robots.txt에서 크롤링을 허용하지 않습니다.");
  }

  const max = Math.max(1, options.maxPages);
  const { candidates, rootHtml, source } = await collectCandidateEntries(
    rootUrl,
    robots,
    fetcher,
    CANDIDATE_POOL_LIMIT,
    canonicalHtml,
    options.excludePatterns,
  );
  const technologies = rootHtml ? detectTechnologies(rootHtml) : ["HTML"];

  // ── 구조 표본 (층화 + 반복 콘텐츠 한도 비례 배분) ──
  const { structured, clusters } = stratifiedSample({ rootUrl, candidates, max });
  const chosen = new Set(structured.map((p) => p.url));

  // ── 무작위 표본 (구조 표본의 10%, 최소 1개, 남은 후보가 있을 때만) ──
  const remaining = candidates.filter((c) => !chosen.has(c.url));
  const randomTarget = remaining.length === 0 ? 0 : Math.max(1, Math.ceil(structured.length * 0.1));
  const rand = seededRandom(hashString(rootUrl));
  // Fisher-Yates — sort의 비교 함수로 무작위를 흉내내면 분포가 치우쳐 앞쪽 후보가
  // 과대 대표되고, 결과가 엔진의 정렬 구현에 묶인다(같은 시드여도 엔진이 바뀌면 달라짐)
  const shuffled = [...remaining];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j]!, shuffled[i]!];
  }
  const random: SampledPage[] = shuffled.slice(0, randomTarget).map((c) => ({
    url: c.url,
    category: categorizePage(c.url, false),
    sampleType: "random",
  }));

  const clusterNote =
    clusters.length > 0
      ? ` — 반복 콘텐츠 ${clusters.length}종(${clusters
          .map((c) => `${c.templateKey} ${c.sampled}/${c.total}`)
          .join(", ")})`
      : "";
  const sampleMethod =
    random.length > 0
      ? `구조 표본 ${structured.length}개(공통 페이지·유형별 대표 + 반복 콘텐츠 한도 비례) + 무작위 표본 ${random.length}개(전체 후보에서 시드 기반 무작위 선정, WCAG-EM 2.0 Step 3.2 — 구조 표본의 10%)${clusterNote}`
      : `구조 표본 ${structured.length}개(후보가 적어 무작위 표본 없음)${clusterNote}`;

  return {
    pages: [...structured, ...random],
    technologies,
    sampleMethod,
    source,
    clusters: clusters.length > 0 ? clusters : undefined,
  };
}
