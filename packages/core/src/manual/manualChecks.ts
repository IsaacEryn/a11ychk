/**
 * 수동 검사 항목 — 자동 도구로 판정할 수 없어 사람이 반드시 확인해야 하는 KWCAG 항목.
 * 보고서의 "수동 검사 필요" 섹션과 크롬 확장의 수동 점검 체크리스트가 이 데이터를 공유한다.
 */
import type { KwcagItem } from "../types";
import { KWCAG_ITEMS } from "../catalog/kwcag";

/** 자동 검사가 항목을 완전히 커버하지 못하는 모든 KWCAG 항목 */
export function getManualCheckItems(): KwcagItem[] {
  return KWCAG_ITEMS.filter((item) => item.autoCoverage !== "full");
}

/** 완전 수동 항목만 (자동 검출이 전혀 없는 항목) */
export function getFullyManualItems(): KwcagItem[] {
  return KWCAG_ITEMS.filter((item) => item.autoCoverage === "none");
}
