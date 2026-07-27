/**
 * axe 결과 정규화 — 순수 함수. Playwright·axe-core 런타임 의존성이 없어
 * 서버 스캐너와 크롬 확장(브라우저) 양쪽에서 공유한다.
 */
import type { Finding, Impact, PageScanResult } from "../types";

/** WCAG 2.2 AA + best-practice 태그 기준으로 실행 */
export const AXE_RUN_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"];

/**
 * 제3자 광고·추적 네트워크가 페이지에 주입하는 프레임·요소 선택자 — axe 검사에서 제외.
 * 사이트 소유자가 고칠 수 없는 마크업(AdSense가 넣는 sodar 추적 이미지·빈 광고 슬롯
 * iframe, reCAPTCHA aframe 등)이며, WCAG-EM은 '사이트 자체 콘텐츠'를 평가 대상으로 본다.
 * 광고 iframe 내부 접근성은 광고 네트워크의 책임이므로 사이트 점수에 반영하지 않는다.
 */
export const THIRD_PARTY_AD_EXCLUDE: string[] = [
  "ins.adsbygoogle",
  'iframe[src*="googlesyndication.com"]',
  'iframe[src*="doubleclick.net"]',
  'iframe[src*="google.com/recaptcha"]',
  'iframe[src*="googletagservices.com"]',
  'iframe[id^="aswift_"]',
  'iframe[id^="google_ads_iframe"]',
  '[src*="googlesyndication.com"]',
  '[src*="doubleclick.net"]',
];

const VALID_IMPACTS: Impact[] = ["critical", "serious", "moderate", "minor"];

export interface AxeRunResults {
  violations: {
    id: string;
    impact?: string | null;
    tags: string[];
    helpUrl: string;
    nodes: { target: unknown[]; html: string; failureSummary?: string }[];
  }[];
  passes: { id: string }[];
  incomplete: { id: string }[];
}

function toImpact(value: string | null | undefined): Impact {
  return VALID_IMPACTS.includes(value as Impact) ? (value as Impact) : "moderate";
}

function toSelector(target: unknown[]): string {
  return target.map((t) => (Array.isArray(t) ? t.join(" >> ") : String(t))).join(", ");
}

export function normalizeAxeResults(url: string, raw: AxeRunResults): PageScanResult {
  const violations: Finding[] = raw.violations.map((v) => ({
    ruleId: v.id,
    impact: toImpact(v.impact),
    tags: v.tags,
    helpUrl: v.helpUrl,
    nodes: v.nodes.slice(0, 25).map((n) => ({
      selector: toSelector(n.target),
      // 스니펫은 표시용 — 저장 용량과 XSS 표면을 줄이기 위해 길이 제한
      html: n.html.slice(0, 600),
      failureSummary: (n.failureSummary ?? "").slice(0, 1000),
    })),
  }));
  return {
    url,
    violations,
    passes: raw.passes.map((p) => p.id),
    incomplete: raw.incomplete.map((i) => i.id),
    scannedAt: new Date().toISOString(),
  };
}
