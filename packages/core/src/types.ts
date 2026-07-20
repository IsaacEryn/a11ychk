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

/** 점검자 확증용으로 자동 수집한 값 (존재는 확인됨 — 품질은 사람이 판정) */
export interface ReviewSample {
  selector: string;
  text: string;
}

/** 사이트 수준 검사를 위한 페이지 시그니처 (WCAG-EM Phase C) */
export interface PageSignature {
  url: string;
  title: string;
  /** 주 내비게이션 링크 텍스트 시퀀스 */
  navLinks: string[];
  hasSearch: boolean;
  hasSitemap: boolean;
  hasMedia: boolean;
  /** 확인용 수집 자료 — 대체 텍스트·폼 레이블·맥락 확인이 필요한 링크 텍스트 (구버전 스캔엔 없음) */
  review?: {
    alts: ReviewSample[];
    labels: ReviewSample[];
    genericLinks: ReviewSample[];
  };
}

/** 사이트 수준 검사 결과 (집계 시 규칙 세트로 편입) */
export interface SiteCheckOutcome {
  ruleId: string;
  outcome: "failed" | "passed" | "review";
  count: number;
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
  /** 자동 판정 불가(확인 필요)로 나온 규칙 id — 인라인 확인 가이드용 */
  reviewRuleIds?: string[];
}

/**
 * WCAG-EM/EARL 정렬 성공기준 판정값.
 * - passed: 자동 검사에서 통과
 * - failed: 자동 검사에서 위반
 * - cannotTell: 자동 판정 불가(확인 필요, axe incomplete)
 * - notChecked: 자동 규칙이 없어 자동 검사 대상이 아님 → 수동 평가 필요
 * - notPresent: 해당 콘텐츠가 없어 적용되지 않음
 */
export type WcagOutcome = "passed" | "failed" | "cannotTell" | "notChecked" | "notPresent";

export interface WcagMatrixRow {
  /** 성공기준 번호 (예: "1.4.3") */
  scId: string;
  outcome: WcagOutcome;
  violationCount: number;
  ruleIds: string[];
  /** 자동 판정 불가(확인 필요)로 나온 규칙 id — 인라인 확인 가이드용 */
  reviewRuleIds?: string[];
}

/** WCAG-EM Step 1 평가 범위 (scans.scope에 저장) */
export interface EvaluationScope {
  /** 목표 적합성 수준 */
  conformanceTarget: "A" | "AA" | "AAA";
  /** 접근성 지원 기준 (브라우저·보조기기 조합) */
  accessibilitySupportBaseline: string[];
  /** 포함/제외 URL 패턴 (범위 정의) */
  includePatterns?: string[];
  excludePatterns?: string[];
  /** 점검자가 직접 지정한 표본 페이지 (자동 수집 대신 사용) */
  manualPages?: string[];
  notes?: string;
}

/** 보고서 메타 정보 (scans.report_meta) — 점검자가 보고서 페이지에서 입력 */
export interface ReportMeta {
  /** 사이트 이름 (예: "입학지원센터") */
  siteName?: string;
  /** 의뢰 기관/조직 (WCAG-EM commissioner) */
  organization?: string;
  /** 평가자 이름 (dct:creator) */
  evaluatorName?: string;
  /** 보고서 제목 (dct:title) */
  title?: string;
  /** 총평 / Executive Summary (dct:summary) */
  executiveSummary?: string;
  /** 공유 보기 기본 출력 범위 — 비소유자(공유 링크) 뷰에 소유자가 지정한 표시 모드 */
  publicView?: "all" | "auto" | "done" | "issues";
  /** 공유 보기 기본 표시 표준 — 비소유자 뷰의 std */
  publicStd?: "both" | "wcag" | "kwcag";
}

/** 점검자 판정 (scan_reviews 행) */
export interface ScanReview {
  standard: "wcag" | "kwcag";
  itemId: string;
  outcome: WcagOutcome;
  note: string;
}

/** 봇 차단 검증 판정 */
export type AccessVerdict =
  | "ok" // 자동 검사 가능
  | "robots-blocked" // robots.txt가 봇을 차단 (우리는 존중하여 검사하지 않음)
  | "ua-blocked" // 봇 UA만 차단 (브라우저 UA는 통과)
  | "challenge" // 봇 방어 챌린지 (Cloudflare 등) — UA와 무관하게 차단
  | "http-error" // 봇 여부와 무관한 HTTP 오류
  | "unreachable"; // 접속 불가

export interface AccessCheckResult {
  verdict: AccessVerdict;
  robotsAllowed: boolean;
  /** 봇 UA로 요청한 HTTP 상태 */
  botStatus?: number;
  /** 일반 브라우저 UA로 요청한 HTTP 상태 (봇이 차단된 경우에만 확인) */
  browserStatus?: number;
  /** 감지된 봇 방어 서비스 (cloudflare 등) */
  challengeVendor?: string;
}

export type PageCategory =
  | "home"
  | "login"
  | "contact"
  | "sitemap"
  | "help"
  | "legal"
  | "search"
  | "form"
  | "content";

export type SampleType = "structured" | "random" | "process";

/** WCAG-EM Step 2·3 결과 요약 (ScanSummary.sample에 저장) */
export interface SampleSummary {
  structuredCount: number;
  randomCount: number;
  processCount: number;
  /** 무작위 표본 선정 방법 설명 */
  method: string;
  /** 의존 기술 (HTML/CSS/JavaScript/WAI-ARIA/SVG/PDF 등) */
  technologies: string[];
  /** 4.c: 무작위 표본이 구조 표본에 없는 새 위반 규칙을 드러냈는지 */
  randomSurfacedNewRules: string[];
}

/** 한 종류의 준수율 계산 결과 (자동/수동/통합 공통) */
export interface ScoreBreakdown {
  /** 준수율 % (0–100). 판정된 항목 기준 (passed / (passed+failed)) */
  rate: number;
  /** 준수(통과)로 판정된 성공기준 수 */
  passed: number;
  /** 미준수(위반)로 판정된 성공기준 수 */
  failed: number;
  /** 판정된 성공기준 수 (passed + failed) */
  evaluated: number;
  /** 아직 판정되지 않은 성공기준 수 (수동 확인 필요·미확인·해당없음) */
  notEvaluated: number;
}

/**
 * 세 가지 준수율 (WCAG-EM Phase D).
 * - automated: 자동 검사(axe + 자체 규칙 + 사이트 검사)만의 결과
 * - manual: 점검자가 직접 판정 기입한 결과만
 * - combined: 자동 + 수동을 통합 (점검자 판정이 자동 판정을 우선)
 * 모두 목표 적합성 수준의 WCAG 성공기준을 기준으로 계산.
 */
export interface ScanScores {
  automated: ScoreBreakdown;
  manual: ScoreBreakdown;
  combined: ScoreBreakdown;
  /** 목표 수준 전체 성공기준 수 (분모 기준) */
  totalCriteria: number;
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
  /** WCAG 2.2 성공기준별 판정 (WCAG-EM Step 4) */
  wcagMatrix: WcagMatrixRow[];
  /** 자동 검사 가능 규칙 기준 준수율 (0–100) — 하위 호환용(자동 검사 규칙 기준) */
  complianceRate: number;
  /** 자동/수동/통합 세 준수율 (WCAG 성공기준 기준). 구버전 스캔엔 없을 수 있음 */
  scores?: ScanScores;
  engine: { name: string; axeVersion: string };
  /** WCAG-EM 표본 요약 (없을 수 있음 — 구버전 스캔 호환) */
  sample?: SampleSummary;
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

/** WCAG-EM 표본에 선정된 페이지 (분류·표본유형 태깅) */
export interface SampledPage {
  url: string;
  category: PageCategory;
  sampleType: SampleType;
}

export interface SampleResult {
  pages: SampledPage[];
  /** 의존 기술 (루트 문서에서 감지) */
  technologies: string[];
  /** 표본 선정 방법 설명 */
  sampleMethod: string;
  source: CrawlResult["source"];
}

export interface BuildSampleOptions extends CrawlOptions {
  /** 구조 표본 최대 페이지 수 (요금제 연동). 무작위 표본은 이의 10%가 추가된다. */
  maxPages: number;
}
