import "server-only";
import crypto from "node:crypto";
import { getRuleEntry, type Impact, type PageScanResult, type ScanSummary } from "@a11ychk/core/catalog";

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
  kwcag: string[];
  /** 개선 가이드 첫 단락 (로케일 반영) */
  guideFirst: string;
  /** 이 규칙의 전체 위반 요소 수 */
  nodeCount: number;
  /** 위치 표본 — 정확히 1개만 (나머지는 가입 후) */
  sample: { selector: string; html: string } | null;
}

export interface TeaserResult {
  rate: number;
  byImpact: Record<Impact, number>;
  ruleCount: number;
  totalNodes: number;
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
  const rules: TeaserRule[] = [...page.violations]
    .sort((a, b) => IMPACT_ORDER.indexOf(a.impact) - IMPACT_ORDER.indexOf(b.impact))
    .map((v) => {
      const entry = getRuleEntry(v.ruleId, v.tags);
      const first = v.nodes[0];
      return {
        ruleId: v.ruleId,
        title: pick(entry.title),
        impact: v.impact,
        wcag: entry.wcag,
        kwcag: entry.kwcag,
        guideFirst: pick(entry.guide).split("\n\n")[0]?.trim() ?? "",
        nodeCount: v.nodes.length,
        sample: first ? { selector: first.selector.slice(0, 300), html: first.html.slice(0, 300) } : null,
      };
    });
  return {
    rate: summary.complianceRate,
    byImpact: summary.byImpact,
    ruleCount: rules.length,
    totalNodes: summary.totalViolationNodes,
    rules,
    cached: false,
  };
}
