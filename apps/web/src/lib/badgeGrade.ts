/**
 * 준수율 등급 — 배지·공개 디렉터리·보고서 요약이 공유하는 단일 밴딩 기준.
 * 자동 점검(axe+자체규칙) 기반 준수율에 대한 표시 등급이며, 공식 인증 판정이 아니다.
 *
 * 임계는 보수적으로 잡는다: 저품질 사이트를 "양호"로 표시해 서비스가 품질을
 * 보증하는 인상을 주지 않도록 한다.
 */
export type Grade = "good" | "fair" | "poor";

/** 공개 디렉터리 등재를 허용하는 최소 준수율 (이 미만은 등재해도 목록 노출 보류) */
export const DIRECTORY_MIN_RATE = 85;

export function gradeOf(rate: number): Grade {
  if (rate >= 90) return "good";
  if (rate >= 75) return "fair";
  return "poor";
}

/** 배지·UI 색상 (globals.css 토큰과 동일 계열의 정적 hex — SVG 임베드용) */
export function gradeColor(grade: Grade): string {
  return grade === "good" ? "#0b5d54" : grade === "fair" ? "#8a7a1f" : "#a4243b";
}
