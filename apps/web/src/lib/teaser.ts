import "server-only";
import crypto from "node:crypto";
import {
  automatedComplianceRate,
  getRuleEntry,
  groupViolationsForAiFix,
  kwcagItemsOf,
  kwcagNoListLabel,
  partitionAdvisory,
  type Impact,
  type PageScanResult,
  type ScanSummary,
} from "@a11ychk/core/catalog";

/**
 * 비로그인 맛보기 검사(1페이지) 공용 로직 — IP 해시·한도 상수·응답 트리밍.
 * 결과는 DB에 저장하지 않으며, 위반 요소 위치는 규칙당 1개만 응답에 포함한다
 * (서버측 잠금 — 나머지는 응답에 아예 실리지 않아 클라이언트에서 우회 불가).
 */

/** IP당 일일 한도 / 전역 일일 캡 (비용 상한: 최악 100회 × ~20초 ≈ 33분/일) */
export const TEASER_IP_DAILY_LIMIT = 2;
export const TEASER_GLOBAL_DAILY_CAP = 100;
/** 전역 캡 카운터의 sentinel 키 (teaser_usage.ip_hash) */
export const TEASER_GLOBAL_KEY = "global";

function salt(): string {
  const s = process.env.REFERRAL_HASH_SECRET ?? process.env.INTERNAL_API_SECRET;
  if (!s || s === "change-me") throw new Error("REFERRAL_HASH_SECRET(또는 INTERNAL_API_SECRET)이 설정되지 않았습니다.");
  return s;
}

/** IP 일방향 해시 — 원본 IP는 어디에도 저장하지 않는다 (초대 시스템 해시와 동일 솔트) */
export function hashIp(ip: string): string {
  return crypto.createHash("sha256").update(`${salt()}:ip:${ip.trim()}`).digest("hex");
}

const IMPACT_ORDER: Impact[] = ["critical", "serious", "moderate", "minor"];

export interface TeaserRule {
  ruleId: string;
  title: string;
  impact: Impact;
  wcag: string[];
  /** KWCAG 공식 번호(ksNo, 예: ["5.4.3", "7.3.2"]). 번호 개편 전에 로드된 화면이 join(", ")으로 쓰므로 배열로 둔다 */
  kwcag: string[];
  /** KWCAG 대응 표기 (예: "검사항목 8·29"). 대응이 없으면 빈 문자열 */
  kwcagLabel: string;
  /** 개선 가이드 첫 단락 (로케일 반영) */
  guideFirst: string;
  /** 이 규칙의 전체 위반 요소 수 */
  nodeCount: number;
  /** 위치 표본 — 정확히 1개만 (나머지는 가입 후) */
  sample: { selector: string; html: string } | null;
}

/** 규칙 수·요소 수·심각도는 모두 적합성 위반(모범 사례 권고 제외)만 센다 — 준수율과 같은 기준 */
export interface TeaserResult {
  rate: number;
  byImpact: Record<Impact, number>;
  ruleCount: number;
  totalNodes: number;
  /** 목록·수치에서 뺀 모범 사례 권고 규칙 수 (WCAG 성공기준에 대응하지 않아 준수율에도 들어가지 않는다) */
  advisoryCount: number;
  rules: TeaserRule[];
  cached: boolean;
}

/**
 * 검사 결과를 맛보기 응답으로 트리밍·로컬라이즈한다.
 * 카탈로그 해석(getRuleEntry)을 서버에서 끝내 클라이언트 번들에 규칙 카탈로그가
 * 포함되지 않게 하고, 노드는 규칙당 1개만 실어 서버 수준에서 상세를 잠근다.
 */
export function buildTeaserResult(page: PageScanResult, summary: ScanSummary, locale: "ko" | "en"): TeaserResult {
  const pick = (t: { ko: string; en?: string }) => (locale === "en" && t.en ? t.en : t.ko);
  // runAxeOnPage는 프레임(iframe)별 결과를 이어 붙이므로 같은 규칙이 여러 번 온다 — 규칙 하나로 합친다.
  // 모범 사례 권고는 준수율에 들어가지 않으므로 목록·수치에서도 뺀다(웹 보고서·Action·MCP와 같은 분리).
  const { violations, advisory } = partitionAdvisory(summary, groupViolationsForAiFix([page]));
  const rules: TeaserRule[] = violations
    .sort((a, b) => IMPACT_ORDER.indexOf(a.impact) - IMPACT_ORDER.indexOf(b.impact))
    .map((v) => {
      const entry = getRuleEntry(v.ruleId, v.tags);
      const first = v.nodes[0];
      const kwItems = kwcagItemsOf(entry.kwcag);
      return {
        ruleId: v.ruleId,
        title: pick(entry.title),
        impact: v.impact,
        wcag: entry.wcag,
        kwcag: kwItems.map((i) => i.ksNo),
        kwcagLabel: kwcagNoListLabel(kwItems, locale),
        guideFirst: pick(entry.guide).split("\n\n")[0]?.trim() ?? "",
        nodeCount: v.nodes.length,
        sample: first ? { selector: first.selector.slice(0, 300), html: first.html.slice(0, 300) } : null,
      };
    });
  const byImpact: Record<Impact, number> = { critical: 0, serious: 0, moderate: 0, minor: 0 };
  for (const r of rules) byImpact[r.impact] += r.nodeCount;
  return {
    rate: automatedComplianceRate(summary),
    byImpact,
    ruleCount: rules.length,
    totalNodes: rules.reduce((n, r) => n + r.nodeCount, 0),
    advisoryCount: advisory.length,
    rules,
    cached: false,
  };
}
