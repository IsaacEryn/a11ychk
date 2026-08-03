/**
 * crawl_sample — 대표 페이지 표본 수집 (buildSample 재사용, 브라우저 불필요).
 *
 * fetcher로 일반 undici fetch를 주입한다. buildSample의 기본 fetcher는 SSRF 가드
 * (guardedFetch)라 localhost를 차단하는데, 이 서버의 핵심 용도가 배포 전 localhost
 * 검사다. SSRF 가드는 SaaS(남의 서버에서 임의 URL을 fetch)의 관심사이고, 로컬
 * 도구는 사용자 자신의 권한으로 도니 GitHub Action과 같은 기준을 적용한다.
 * robots.txt 존중은 buildSample 내부에서 그대로 동작한다.
 */
import { fetch as undiciFetch } from "undici";
import { buildSample, type SampleResult } from "@a11ychk/core";
import { footer } from "./funnel";

const DEFAULT_MAX_PAGES = 8;
export const CRAWL_MAX_PAGES = 20;

export interface CrawlSampleResult {
  structuredContent: {
    pages: { url: string; category: string; isRepeating: boolean }[];
    sampleMethod: string;
    source: string;
    technologies: string[];
  };
  text: string;
}

export async function runCrawlSampleTool(url: string, maxPages: number | undefined, lang: "ko" | "en"): Promise<CrawlSampleResult> {
  const max = Math.min(maxPages ?? DEFAULT_MAX_PAGES, CRAWL_MAX_PAGES);
  const sample: SampleResult = await buildSample(url, {
    maxPages: max,
    fetcher: (u) => undiciFetch(u) as unknown as Promise<Response>,
  });

  const structuredContent = {
    pages: sample.pages.map((p) => ({ url: p.url, category: p.category, isRepeating: p.isRepeating ?? false })),
    sampleMethod: sample.sampleMethod,
    source: sample.source,
    technologies: sample.technologies,
  };

  const L = (ko: string, en: string) => (lang === "en" ? en : ko);
  const lines = [
    `${L("대표 페이지 표본", "Representative sample")} (${sample.pages.length}${L("개", " pages")}, ${L("출처", "source")}: ${sample.source})`,
    "",
    ...sample.pages.map((p) => `- ${p.url} (${p.category})`),
    "",
    L(
      "이 URL들을 scan_pages에 넣으면 표본 전체를 검사할 수 있습니다.",
      "Pass these URLs to scan_pages to audit the whole sample.",
    ),
    L(
      "사이트 단위 통합 보고서(KWCAG 33항목 매트릭스·준수율 추이)는 a11ychk.com 회원 기능입니다.",
      "Site-level consolidated reports (KWCAG matrix, compliance trends) are a member feature at a11ychk.com.",
    ),
    "",
    footer(lang, "crawl", url),
  ];
  return { structuredContent, text: lines.join("\n") };
}
