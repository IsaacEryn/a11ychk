/**
 * WCAG-EM 2.0 Step 2·3 — 대상 탐색 + 대표 표본 선정.
 *
 * 페이지 분류(categorizePage)는 2.0 Step 2.1(공통 뷰: 홈·로그인·문의 등)과
 * 2.3(표본 유형 다양성)에, 무작위 표본은 Step 3.2(구조 표본의 10%)에 대응한다.
 * collectPages의 후보 수집을 재사용하되, 페이지를 분류(공통 페이지 등)하고
 * 구조 표본(structured) + 무작위 표본(random 10%)으로 태깅한다.
 * 프로세스(process) 표본은 자동 크롤 불가이므로 크롬 확장에 위임한다.
 */
import type { BuildSampleOptions, PageCategory, SampledPage, SampleResult } from "../types";
import { guardedFetch } from "../security/urlGuard";
import { fetchRobots, isPathAllowed } from "../security/robots";
import { collectCandidates, normalizeUrl, prioritizeUrls } from "./collectPages";

/** URL 경로·질의로 공통 페이지 유형을 분류 */
export function categorizePage(url: string, isRoot: boolean): PageCategory {
  if (isRoot) return "home";
  const path = (() => {
    try {
      return (new URL(url).pathname + new URL(url).search).toLowerCase();
    } catch {
      return url.toLowerCase();
    }
  })();
  if (/(^|\/)(login|signin|sign-in|auth|account\/login|로그인)/.test(path)) return "login";
  if (/(contact|문의|inquiry|고객|support|1:1)/.test(path)) return "contact";
  if (/sitemap|사이트맵/.test(path)) return "sitemap";
  if (/(help|faq|도움말|가이드|guide|고객센터)/.test(path)) return "help";
  if (/(privacy|terms|policy|약관|개인정보|이용약관)/.test(path)) return "legal";
  if (/(search|검색)/.test(path)) return "search";
  if (/(join|signup|sign-up|register|가입|주문|order|checkout|결제|apply|신청)/.test(path)) return "form";
  return "content";
}

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

function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * 대표 표본 구성.
 * - 구조 표본: 루트(home) + 공통 페이지 유형별 대표 1개 + 섹션 다양성 (최대 maxPages)
 * - 무작위 표본: 남은 후보에서 시드 기반으로 ceil(구조표본 × 10%) 추가 선정
 */
export async function buildSample(rootRawUrl: string, options: BuildSampleOptions): Promise<SampleResult> {
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
  // 후보 풀은 표본보다 넉넉히 확보 (무작위 표본 선정 여지)
  const { candidates, rootHtml, source } = await collectCandidates(rootUrl, robots, fetcher, max * 4);
  const technologies = rootHtml ? detectTechnologies(rootHtml) : ["HTML"];

  // 후보를 다양성 우선으로 정렬 (루트 제외)
  const ordered = prioritizeUrls(candidates, rootUrl);

  // ── 구조 표본 ──
  const structured: SampledPage[] = [{ url: rootUrl, category: "home", sampleType: "structured" }];
  const usedCategories = new Set<PageCategory>(["home"]);
  const chosen = new Set<string>([rootUrl]);

  // 1) 공통/특수 페이지 유형별 대표 먼저
  for (const u of ordered) {
    if (structured.length >= max) break;
    const cat = categorizePage(u, false);
    if (cat !== "content" && !usedCategories.has(cat) && !chosen.has(u)) {
      structured.push({ url: u, category: cat, sampleType: "structured" });
      usedCategories.add(cat);
      chosen.add(u);
    }
  }
  // 2) 남은 자리를 다양성 순으로 채움
  for (const u of ordered) {
    if (structured.length >= max) break;
    if (chosen.has(u)) continue;
    structured.push({ url: u, category: categorizePage(u, false), sampleType: "structured" });
    chosen.add(u);
  }

  // ── 무작위 표본 (구조 표본의 10%, 최소 1개, 남은 후보가 있을 때만) ──
  const remaining = ordered.filter((u) => !chosen.has(u));
  const randomTarget = remaining.length === 0 ? 0 : Math.max(1, Math.ceil(structured.length * 0.1));
  const rand = seededRandom(hashString(rootUrl));
  const shuffled = [...remaining].sort(() => rand() - 0.5);
  const random: SampledPage[] = shuffled.slice(0, randomTarget).map((u) => ({
    url: u,
    category: categorizePage(u, false),
    sampleType: "random",
  }));

  const sampleMethod =
    random.length > 0
      ? `구조 표본 ${structured.length}개(공통 페이지·페이지 유형별 대표) + 무작위 표본 ${random.length}개(전체 후보에서 시드 기반 무작위 선정, WCAG-EM 2.0 Step 3.2 — 구조 표본의 10%)`
      : `구조 표본 ${structured.length}개(후보가 적어 무작위 표본 없음)`;

  return {
    pages: [...structured, ...random],
    technologies,
    sampleMethod,
    source,
  };
}
