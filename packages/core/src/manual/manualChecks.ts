/**
 * 수동 검사 항목 — 자동 도구로 판정할 수 없어 사람이 반드시 확인해야 하는 항목.
 * 보고서의 "수동 검사 필요" 섹션과 크롬 확장의 수동 점검 체크리스트가 이 데이터를 공유한다.
 *
 * 축은 WCAG 성공기준(A/AA)이고, 콘텐츠 원본(한국어 howToTest)은 KWCAG_ITEMS에 남긴 채
 * 역매핑으로 파생한다 — 한 SC의 검사 방법은 그 SC를 참조하는 KWCAG 항목(sources)에서 온다.
 */
import type { AutoCoverage, KwcagItem, KwcagPrinciple, LocalizedText, WcagOutcome } from "../types";
import { KWCAG_ITEMS } from "../catalog/kwcag";
import { WCAG_BY_ID, WCAG_CRITERIA, type WcagLevel } from "../catalog/wcag";

/** 자동 검사가 항목을 완전히 커버하지 못하는 모든 KWCAG 항목 */
export function getManualCheckItems(): KwcagItem[] {
  return KWCAG_ITEMS.filter((item) => item.autoCoverage !== "full");
}

/** 완전 수동 항목만 (자동 검출이 전혀 없는 항목) */
export function getFullyManualItems(): KwcagItem[] {
  return KWCAG_ITEMS.filter((item) => item.autoCoverage === "none");
}

/** WCAG 대응이 없는 KWCAG 고유 수동 항목 (5.4.3 콘텐츠 간 구분, 6.4.4 고정 참조위치) */
export function getKwcagOnlyManualItems(): KwcagItem[] {
  return getManualCheckItems().filter((item) => item.wcag.filter((sc) => WCAG_BY_ID.has(sc)).length === 0);
}

/**
 * SC id → 그 SC를 참조하는 수동 대상 KWCAG 항목들 (카탈로그 실재 SC만).
 * 다중 출처는 1.3.1 ← {7.3.1, 7.3.2, 7.4.1} 단 1건 — manualWcag.test가 고정한다.
 */
export const KWCAG_BY_WCAG: ReadonlyMap<string, KwcagItem[]> = (() => {
  const map = new Map<string, KwcagItem[]>();
  for (const item of getManualCheckItems()) {
    for (const sc of item.wcag) {
      if (!WCAG_BY_ID.has(sc)) continue; // 폐기(4.1.1)·AAA 참조는 제외
      const list = map.get(sc) ?? [];
      list.push(item);
      map.set(sc, list);
    }
  }
  return map;
})();

/** WCAG 축 수동 검사 항목 — KWCAG 역매핑 파생 */
export interface ManualWcagCheck {
  scId: string;
  level: WcagLevel;
  principle: KwcagPrinciple;
  name: LocalizedText;
  /** 출처 KWCAG 항목들 — howToTest를 출처 라벨과 함께 보존 (1.3.1은 3개) */
  sources: { kwcagId: string; name: LocalizedText; howToTest?: LocalizedText }[];
  /** 출처들의 최소 커버리지 — 하나라도 none이면 none */
  autoCoverage: AutoCoverage;
}

/** WCAG 축 수동 체크리스트 — WCAG_CRITERIA 순서(원칙→번호)로 정렬 */
export function getManualChecksByWcag(): ManualWcagCheck[] {
  const out: ManualWcagCheck[] = [];
  for (const c of WCAG_CRITERIA) {
    const sources = KWCAG_BY_WCAG.get(c.id);
    if (!sources || sources.length === 0) continue;
    out.push({
      scId: c.id,
      level: c.level,
      principle: c.principle,
      name: c.name,
      sources: sources.map((s) => ({ kwcagId: s.id, name: s.name, howToTest: s.howToTest })),
      autoCoverage: sources.some((s) => s.autoCoverage === "none") ? "none" : "partial",
    });
  }
  return out;
}

/**
 * 판정 결합 공용 규칙 — failed > cannotTell > (전 슬롯 판정 시) 긍정 > 없음(null).
 * complete = 결합 대상 슬롯 전원이 판정을 보유했는지. 부분적 긍정 판정만으로는
 * 결합 판정을 내지 않는다(1:N 관계에서 일부 통과를 전체 통과로 승격하지 않기 위함).
 * notChecked는 판정으로 취급하지 않는다(computeScores와 동일).
 */
export function combineOutcomes(outcomes: WcagOutcome[], complete: boolean): WcagOutcome | null {
  const judged = outcomes.filter((o) => o !== "notChecked");
  if (judged.includes("failed")) return "failed";
  if (judged.includes("cannotTell")) return "cannotTell";
  if (judged.length === 0 || !complete) return null;
  return judged.every((o) => o === "notPresent") ? "notPresent" : "passed";
}

/**
 * kwcag 직접 판정 → SC별 파생 판정 (점수 폴백용).
 * wcag 직접 판정과의 병합(직접 우선)은 호출자(computeScores 등)가 담당한다.
 */
export function deriveWcagReviewsFromKwcag(
  kwcagReviews: Record<string, WcagOutcome>,
): Record<string, WcagOutcome> {
  const out: Record<string, WcagOutcome> = {};
  for (const [scId, sources] of KWCAG_BY_WCAG) {
    const outcomes: WcagOutcome[] = [];
    for (const s of sources) {
      const o = kwcagReviews[s.id];
      if (o) outcomes.push(o);
    }
    const combined = combineOutcomes(outcomes, outcomes.length === sources.length);
    if (combined) out[scId] = combined;
  }
  return out;
}

/**
 * KWCAG 항목 하나의 wcag 판정 파생 (매트릭스 표시용) — 직접 kwcag 판정이 없을 때만
 * 호출자가 사용한다. 대응 SC가 없으면(5.4.3·6.4.4, 폐기 참조만 있는 8.1.1) null.
 */
export function deriveKwcagOutcomeFromWcag(
  item: KwcagItem,
  wcagReviews: ReadonlyMap<string, WcagOutcome> | Record<string, WcagOutcome>,
): WcagOutcome | null {
  const scs = item.wcag.filter((sc) => WCAG_BY_ID.has(sc));
  if (scs.length === 0) return null;
  const get = (sc: string): WcagOutcome | undefined =>
    wcagReviews instanceof Map ? wcagReviews.get(sc) : (wcagReviews as Record<string, WcagOutcome>)[sc];
  const outcomes: WcagOutcome[] = [];
  for (const sc of scs) {
    const o = get(sc);
    if (o) outcomes.push(o);
  }
  return combineOutcomes(outcomes, outcomes.length === scs.length);
}
