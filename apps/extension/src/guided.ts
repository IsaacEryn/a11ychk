/**
 * 가이드형 수동 판정 — 카탈로그의 검사 방법(howToTest)을 확인 절차 단계로
 * 분해하고, 절차 수행 후 예/아니오/판단 불가 답변으로 판정을 바로 기입하게 한다.
 * 자유 기입 판정·메모와 공존하며 같은 저장소(setReview)를 쓴다.
 */
import type { KwcagItem } from "@a11ychk/core/catalog";
import { isEnglish, pick } from "./i18n";

/**
 * howToTest 문단을 문장 단위 절차로 분해한다.
 * ko는 "…다." 경계, en은 마침표+대문자 경계로 분리 — 약어 등으로 분리가
 * 어색해도 각 문장은 온전하므로 절차 품질이 크게 손상되지 않는다.
 * 분리가 실패하면 통짜 문단 1단계로 폴백.
 */
export function buildGuidedSteps(item: KwcagItem): string[] {
  const text = item.howToTest ? pick(item.howToTest).trim() : "";
  if (!text) return [];
  const parts = isEnglish() ? text.split(/(?<=\.)\s+(?=[A-Z(])/) : text.split(/(?<=다\.)\s+/);
  const steps = parts.map((s) => s.trim()).filter(Boolean);
  return steps.length > 0 ? steps : [text];
}
