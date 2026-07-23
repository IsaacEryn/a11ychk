/**
 * WCAG 2.2 성공기준(Success Criteria) 카탈로그 — Level A·AA 전체.
 * WCAG-EM 2.0(웹 접근성 평가 방법론) Step 4의 "성공기준별 결과" 매트릭스에 사용한다.
 * 출처: W3C WCAG 2.2 Recommendation / Quick Reference.
 *
 * (4.1.1 Parsing은 WCAG 2.2에서 폐기되어 제외. AAA는 목표 수준이 아니므로 제외.)
 */
import type { KwcagPrinciple, LocalizedText } from "../types";

export type WcagLevel = "A" | "AA";

export interface WcagCriterion {
  /** 성공기준 번호 (예: "1.4.3") */
  id: string;
  level: WcagLevel;
  principle: KwcagPrinciple;
  name: LocalizedText;
}

export const WCAG_CRITERIA: WcagCriterion[] = [
  // ─── 원칙 1. 인식의 용이성 (Perceivable) ───
  { id: "1.1.1", level: "A", principle: "perceivable", name: { ko: "비텍스트 콘텐츠", en: "Non-text Content" } },
  { id: "1.2.1", level: "A", principle: "perceivable", name: { ko: "오디오·비디오(사전 녹화)", en: "Audio-only and Video-only (Prerecorded)" } },
  { id: "1.2.2", level: "A", principle: "perceivable", name: { ko: "자막(사전 녹화)", en: "Captions (Prerecorded)" } },
  { id: "1.2.3", level: "A", principle: "perceivable", name: { ko: "음성 해설 또는 대체 미디어(사전 녹화)", en: "Audio Description or Media Alternative (Prerecorded)" } },
  { id: "1.2.4", level: "AA", principle: "perceivable", name: { ko: "자막(실시간)", en: "Captions (Live)" } },
  { id: "1.2.5", level: "AA", principle: "perceivable", name: { ko: "음성 해설(사전 녹화)", en: "Audio Description (Prerecorded)" } },
  { id: "1.3.1", level: "A", principle: "perceivable", name: { ko: "정보와 관계", en: "Info and Relationships" } },
  { id: "1.3.2", level: "A", principle: "perceivable", name: { ko: "의미 있는 순서", en: "Meaningful Sequence" } },
  { id: "1.3.3", level: "A", principle: "perceivable", name: { ko: "감각적 특성", en: "Sensory Characteristics" } },
  { id: "1.3.4", level: "AA", principle: "perceivable", name: { ko: "표시 방향", en: "Orientation" } },
  { id: "1.3.5", level: "AA", principle: "perceivable", name: { ko: "입력 목적 식별", en: "Identify Input Purpose" } },
  { id: "1.4.1", level: "A", principle: "perceivable", name: { ko: "색의 사용", en: "Use of Color" } },
  { id: "1.4.2", level: "A", principle: "perceivable", name: { ko: "오디오 제어", en: "Audio Control" } },
  { id: "1.4.3", level: "AA", principle: "perceivable", name: { ko: "명도 대비(최소)", en: "Contrast (Minimum)" } },
  { id: "1.4.4", level: "AA", principle: "perceivable", name: { ko: "텍스트 크기 조정", en: "Resize Text" } },
  { id: "1.4.5", level: "AA", principle: "perceivable", name: { ko: "텍스트 이미지", en: "Images of Text" } },
  { id: "1.4.10", level: "AA", principle: "perceivable", name: { ko: "리플로우", en: "Reflow" } },
  { id: "1.4.11", level: "AA", principle: "perceivable", name: { ko: "비텍스트 대비", en: "Non-text Contrast" } },
  { id: "1.4.12", level: "AA", principle: "perceivable", name: { ko: "텍스트 간격", en: "Text Spacing" } },
  { id: "1.4.13", level: "AA", principle: "perceivable", name: { ko: "호버·포커스 시 콘텐츠", en: "Content on Hover or Focus" } },

  // ─── 원칙 2. 운용의 용이성 (Operable) ───
  { id: "2.1.1", level: "A", principle: "operable", name: { ko: "키보드", en: "Keyboard" } },
  { id: "2.1.2", level: "A", principle: "operable", name: { ko: "키보드 함정 방지", en: "No Keyboard Trap" } },
  { id: "2.1.4", level: "A", principle: "operable", name: { ko: "문자 키 단축키", en: "Character Key Shortcuts" } },
  { id: "2.2.1", level: "A", principle: "operable", name: { ko: "시간 조절 가능", en: "Timing Adjustable" } },
  { id: "2.2.2", level: "A", principle: "operable", name: { ko: "일시정지·정지·숨김", en: "Pause, Stop, Hide" } },
  { id: "2.3.1", level: "A", principle: "operable", name: { ko: "3회 섬광 이하", en: "Three Flashes or Below Threshold" } },
  { id: "2.4.1", level: "A", principle: "operable", name: { ko: "블록 건너뛰기", en: "Bypass Blocks" } },
  { id: "2.4.2", level: "A", principle: "operable", name: { ko: "페이지 제목", en: "Page Titled" } },
  { id: "2.4.3", level: "A", principle: "operable", name: { ko: "초점 순서", en: "Focus Order" } },
  { id: "2.4.4", level: "A", principle: "operable", name: { ko: "링크 목적(문맥 내)", en: "Link Purpose (In Context)" } },
  { id: "2.4.5", level: "AA", principle: "operable", name: { ko: "여러 방법", en: "Multiple Ways" } },
  { id: "2.4.6", level: "AA", principle: "operable", name: { ko: "제목과 레이블", en: "Headings and Labels" } },
  { id: "2.4.7", level: "AA", principle: "operable", name: { ko: "보이는 초점", en: "Focus Visible" } },
  { id: "2.4.11", level: "AA", principle: "operable", name: { ko: "초점 가림 방지(최소)", en: "Focus Not Obscured (Minimum)" } },
  { id: "2.5.1", level: "A", principle: "operable", name: { ko: "포인터 제스처", en: "Pointer Gestures" } },
  { id: "2.5.2", level: "A", principle: "operable", name: { ko: "포인터 취소", en: "Pointer Cancellation" } },
  { id: "2.5.3", level: "A", principle: "operable", name: { ko: "레이블과 네임", en: "Label in Name" } },
  { id: "2.5.4", level: "A", principle: "operable", name: { ko: "동작 기반 작동", en: "Motion Actuation" } },
  { id: "2.5.7", level: "AA", principle: "operable", name: { ko: "드래그 동작", en: "Dragging Movements" } },
  { id: "2.5.8", level: "AA", principle: "operable", name: { ko: "대상 크기(최소)", en: "Target Size (Minimum)" } },

  // ─── 원칙 3. 이해의 용이성 (Understandable) ───
  { id: "3.1.1", level: "A", principle: "understandable", name: { ko: "페이지 언어", en: "Language of Page" } },
  { id: "3.1.2", level: "AA", principle: "understandable", name: { ko: "부분 언어", en: "Language of Parts" } },
  { id: "3.2.1", level: "A", principle: "understandable", name: { ko: "초점 시", en: "On Focus" } },
  { id: "3.2.2", level: "A", principle: "understandable", name: { ko: "입력 시", en: "On Input" } },
  { id: "3.2.3", level: "AA", principle: "understandable", name: { ko: "일관된 내비게이션", en: "Consistent Navigation" } },
  { id: "3.2.4", level: "AA", principle: "understandable", name: { ko: "일관된 식별", en: "Consistent Identification" } },
  { id: "3.2.6", level: "A", principle: "understandable", name: { ko: "일관된 도움말", en: "Consistent Help" } },
  { id: "3.3.1", level: "A", principle: "understandable", name: { ko: "오류 식별", en: "Error Identification" } },
  { id: "3.3.2", level: "A", principle: "understandable", name: { ko: "레이블 또는 안내", en: "Labels or Instructions" } },
  { id: "3.3.3", level: "AA", principle: "understandable", name: { ko: "오류 정정 제안", en: "Error Suggestion" } },
  { id: "3.3.4", level: "AA", principle: "understandable", name: { ko: "오류 방지(법률·금융·데이터)", en: "Error Prevention (Legal, Financial, Data)" } },
  { id: "3.3.7", level: "A", principle: "understandable", name: { ko: "중복 입력", en: "Redundant Entry" } },
  { id: "3.3.8", level: "AA", principle: "understandable", name: { ko: "접근 가능한 인증(최소)", en: "Accessible Authentication (Minimum)" } },

  // ─── 원칙 4. 견고성 (Robust) ───
  { id: "4.1.2", level: "A", principle: "robust", name: { ko: "네임·역할·값", en: "Name, Role, Value" } },
  { id: "4.1.3", level: "AA", principle: "robust", name: { ko: "상태 메시지", en: "Status Messages" } },
];

export const WCAG_BY_ID: ReadonlyMap<string, WcagCriterion> = new Map(WCAG_CRITERIA.map((c) => [c.id, c]));

export const WCAG_PRINCIPLE_LABEL: Record<KwcagPrinciple, LocalizedText> = {
  perceivable: { ko: "인식의 용이성", en: "Perceivable" },
  operable: { ko: "운용의 용이성", en: "Operable" },
  understandable: { ko: "이해의 용이성", en: "Understandable" },
  robust: { ko: "견고성", en: "Robust" },
};

/** 목표 적합성 수준에 포함되는 성공기준만 (AA는 A+AA 포함) */
export function criteriaForTarget(target: WcagLevel | "AAA"): WcagCriterion[] {
  if (target === "A") return WCAG_CRITERIA.filter((c) => c.level === "A");
  return WCAG_CRITERIA; // AA 또는 AAA → A+AA 전체 (AAA 기준은 카탈로그 미포함)
}

/** 성공기준 번호 → W3C 공식 앵커 (Understanding 문서·Report Tool test id 공용) */
export const WCAG22_ANCHORS: Record<string, string> = {
  "1.1.1": "non-text-content",
  "1.2.1": "audio-only-and-video-only-prerecorded",
  "1.2.2": "captions-prerecorded",
  "1.2.3": "audio-description-or-media-alternative-prerecorded",
  "1.2.4": "captions-live",
  "1.2.5": "audio-description-prerecorded",
  "1.3.1": "info-and-relationships",
  "1.3.2": "meaningful-sequence",
  "1.3.3": "sensory-characteristics",
  "1.3.4": "orientation",
  "1.3.5": "identify-input-purpose",
  "1.4.1": "use-of-color",
  "1.4.2": "audio-control",
  "1.4.3": "contrast-minimum",
  "1.4.4": "resize-text",
  "1.4.5": "images-of-text",
  "1.4.10": "reflow",
  "1.4.11": "non-text-contrast",
  "1.4.12": "text-spacing",
  "1.4.13": "content-on-hover-or-focus",
  "2.1.1": "keyboard",
  "2.1.2": "no-keyboard-trap",
  "2.1.4": "character-key-shortcuts",
  "2.2.1": "timing-adjustable",
  "2.2.2": "pause-stop-hide",
  "2.3.1": "three-flashes-or-below-threshold",
  "2.4.1": "bypass-blocks",
  "2.4.2": "page-titled",
  "2.4.3": "focus-order",
  "2.4.4": "link-purpose-in-context",
  "2.4.5": "multiple-ways",
  "2.4.6": "headings-and-labels",
  "2.4.7": "focus-visible",
  "2.4.11": "focus-not-obscured-minimum",
  "2.5.1": "pointer-gestures",
  "2.5.2": "pointer-cancellation",
  "2.5.3": "label-in-name",
  "2.5.4": "motion-actuation",
  "2.5.7": "dragging-movements",
  "2.5.8": "target-size-minimum",
  "3.1.1": "language-of-page",
  "3.1.2": "language-of-parts",
  "3.2.1": "on-focus",
  "3.2.2": "on-input",
  "3.2.3": "consistent-navigation",
  "3.2.4": "consistent-identification",
  "3.2.6": "consistent-help",
  "3.3.1": "error-identification",
  "3.3.2": "labels-or-instructions",
  "3.3.3": "error-suggestion",
  "3.3.4": "error-prevention-legal-financial-data",
  "3.3.7": "redundant-entry",
  "3.3.8": "accessible-authentication-minimum",
  "4.1.2": "name-role-value",
  "4.1.3": "status-messages",
};

/** W3C Understanding 문서 URL (성공기준 이해·검사 방법 공식 문서) */
export function understandingUrl(scId: string): string | undefined {
  const anchor = WCAG22_ANCHORS[scId];
  return anchor ? `https://www.w3.org/WAI/WCAG22/Understanding/${anchor}` : undefined;
}
