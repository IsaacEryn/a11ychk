/** 다국어 텍스트 — 한국어 필수, 그 외 언어는 선택 */
export interface LocalizedText {
  ko: string;
  en?: string;
}

export type Impact = "critical" | "serious" | "moderate" | "minor";

/** WCAG 적합성 수준. BP = axe best-practice (WCAG 필수 항목 아님) */
export type RuleLevel = "A" | "AA" | "BP";

/** 규칙 카탈로그 한 항목 — axe 규칙을 WCAG/KWCAG에 매핑하고 한국어 가이드를 제공 */
export interface RuleCatalogEntry {
  ruleId: string;
  /** WCAG 2.2 성공기준 번호 (예: "1.1.1") */
  wcag: string[];
  /** KWCAG 2.2 검사항목 번호 (예: "5.1.1") */
  kwcag: string[];
  level: RuleLevel;
  title: LocalizedText;
  /** 왜 문제인지 + 어떻게 고치는지 (코드 예시 포함 가능, 마크다운) */
  guide: LocalizedText;
}

export type KwcagPrinciple = "perceivable" | "operable" | "understandable" | "robust";

/** 자동 검사 커버리지: full = 자동으로 판정 가능, partial = 일부만, none = 수동 검사 필수 */
export type AutoCoverage = "full" | "partial" | "none";

export interface KwcagItem {
  /** 검사항목 번호 (KWCAG 2.2 / KS X OT0003), 예: "5.1.1" */
  id: string;
  principle: KwcagPrinciple;
  name: LocalizedText;
  /** 대응되는 WCAG 2.2 성공기준 */
  wcag: string[];
  autoCoverage: AutoCoverage;
  /** 수동 검사 방법 안내 (autoCoverage가 full이 아닐 때) */
  howToTest?: LocalizedText;
  /** KWCAG 2.2에서 신설된 항목 여부 */
  addedIn22?: boolean;
}

/** 페이지 내 개별 위반 노드 */
export interface FindingNode {
  selector: string;
  html: string;
  failureSummary: string;
}

/** 페이지에서 발견된 규칙 단위 위반 */
export interface Finding {
  ruleId: string;
  impact: Impact;
  /** axe가 전달한 태그 (wcag2a, wcag143 등) */
  tags: string[];
  helpUrl: string;
  nodes: FindingNode[];
}

/** 한 페이지의 스캔 결과 */
export interface PageScanResult {
  url: string;
  violations: Finding[];
  /** 통과한 규칙 id 목록 */
  passes: string[];
  /** 자동 판정 불가(확인 필요) 규칙 id 목록 */
  incomplete: string[];
  scannedAt: string;
}

export type KwcagStatus = "pass" | "fail" | "review" | "manual" | "not-applicable";

export interface KwcagMatrixRow {
  itemId: string;
  status: KwcagStatus;
  violationCount: number;
  ruleIds: string[];
}

/** 스캔 전체 요약 (scans.summary jsonb에 저장) */
export interface ScanSummary {
  pageCount: number;
  scannedPageCount: number;
  totalViolations: number;
  totalViolationNodes: number;
  byImpact: Record<Impact, number>;
  /** ruleId → 위반 노드 수 */
  byRule: Record<string, number>;
  kwcagMatrix: KwcagMatrixRow[];
  /** 자동 검사 가능 규칙 기준 준수율 (0–100) */
  complianceRate: number;
  engine: { name: string; axeVersion: string };
}

export interface CrawlOptions {
  maxPages: number;
  /** SSRF 가드를 통과한 fetch 구현 (기본: guardedFetch) */
  fetcher?: (url: string) => Promise<Response>;
  userAgent?: string;
}

export interface CrawlResult {
  urls: string[];
  /** 페이지 수집 방식 */
  source: "sitemap" | "links" | "root-only";
}
