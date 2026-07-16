/**
 * 자체 커스텀 검사의 공용(순수) 부분 — Node 의존 없음.
 * - PAGE_CHECK_RESULT 신호(PageCheckSignals)를 위반/통과/확인필요(CustomResult)로 판정
 * - 서버 스캐너(customChecks.ts, playwright)와 크롬 확장(popup.ts)이 함께 사용해
 *   두 채널의 판정 로직이 갈라지지 않게 한다.
 *
 * DOM 신호 수집 자체는 실행 환경별로 다르다:
 * - 서버: customChecks.ts의 BASE_SCRIPT(문자열 평가 — 번들러 변환 영향 없음)
 * - 확장: popup.ts의 collectPageSignals(chrome.scripting func 직렬화)
 * 두 수집기는 반드시 같은 PageCheckSignals 형태를 반환해야 한다.
 */
import type { Finding } from "../types";

export interface CustomResult {
  violations: Finding[];
  passes: string[];
  incomplete: string[];
}

/** 페이지 컨텍스트에서 수집하는 원시 신호 (수집기 공용 계약) */
export interface PageCheckSignals {
  inlineClickNonInteractive: { selector: string; html: string }[];
  focusSampled: number;
  focusNoOutline: number;
  focusExamples: { selector: string; html: string }[];
  hasMedia: boolean;
  altSampled: number;
  altFilename: { selector: string; html: string; alt: string }[];
  altGeneric: { selector: string; html: string; alt: string }[];
  autoplay: { selector: string; html: string }[];
  genericLinks: number;
  smallTargets: { selector: string; html: string; size: string }[];
  targetSampled: number;
  /** 반복 내비게이션이 있는데 건너뛰기 링크가 없음 (2.4.1) */
  hasNav: boolean;
  skipLinkPresent: boolean;
  /** 자막 track이 없는 video 수 (1.2.2) */
  videoNoTrack: number;
  /** 새 창 열림 고지가 없는 target=_blank 링크 수 (3.2.2) */
  blankNoNotice: number;
}

function finding(ruleId: string, impact: Finding["impact"], nodes: Finding["nodes"]): Finding {
  return { ruleId, impact, tags: [], helpUrl: "", nodes };
}

/**
 * 수집된 신호 → 커스텀 규칙 판정 (리플로우 제외 — 뷰포트 변경이 필요해 서버 전용).
 * 확신 가능한 항목만 위반, 불확실한 휴리스틱은 확인 필요로 분류.
 */
export function customFindingsFromSignals(base: PageCheckSignals): CustomResult {
  const violations: Finding[] = [];
  const passes: string[] = [];
  const incomplete: string[] = [];

  // 2.1.1 키보드 — 인라인 onclick이 붙은 비대화형·비초점 요소.
  // onclick + 비대화형 + tabindex/role 없음 = 키보드로 도달 불가한 확정적 위반.
  if (base.inlineClickNonInteractive.length > 0) {
    violations.push(
      finding(
        "a11ychk:keyboard-clickable",
        "serious",
        base.inlineClickNonInteractive.map((n) => ({
          selector: n.selector,
          html: n.html,
          failureSummary: "클릭 이벤트가 있으나 키보드 초점을 받지 못하는 요소입니다. tabindex와 role, 키보드 이벤트를 추가하거나 button/a로 변경하세요.",
        })),
      ),
    );
  }

  // 2.4.7 보이는 초점 — 초점 시 시각 변화가 감지되지 않는 요소.
  // 프로그램적 focus()는 :focus-visible을 항상 트리거하지 않아 오탐 가능 → '확인 필요'로만 분류.
  if (base.focusSampled > 0) {
    if (base.focusNoOutline > 0) incomplete.push("a11ychk:focus-visible");
    else passes.push("a11ychk:focus-visible");
  }

  // 1.1.1 대체 텍스트 품질 — 파일명 alt는 확정 위반(WCAG F30), 일반어 alt는 확인 필요
  if (base.altFilename.length > 0) {
    violations.push(
      finding(
        "a11ychk:alt-quality",
        "serious",
        base.altFilename.map((n) => ({
          selector: n.selector,
          html: n.html,
          failureSummary: `대체 텍스트가 파일명("${n.alt}")입니다. 이미지의 의미를 설명하는 텍스트로 바꾸세요.`,
        })),
      ),
    );
  } else if (base.altSampled > 0 && base.altGeneric.length === 0) {
    // alt가 있는 이미지가 존재하고 파일명·일반어가 없으면 품질 휴리스틱 통과
    passes.push("a11ychk:alt-quality");
  }
  if (base.altGeneric.length > 0) incomplete.push("a11ychk:alt-quality");

  // 1.4.2 자동 재생 — 음소거 없는 autoplay 미디어는 확정 위반
  if (base.autoplay.length > 0) {
    violations.push(
      finding(
        "a11ychk:autoplay",
        "serious",
        base.autoplay.map((n) => ({
          selector: n.selector,
          html: n.html,
          failureSummary: "음소거 없이 자동 재생되는 미디어입니다. autoplay를 제거하거나 muted를 추가하고, 정지 수단을 제공하세요.",
        })),
      ),
    );
  } else if (base.hasMedia) {
    passes.push("a11ychk:autoplay");
  }

  // 2.4.4 링크 텍스트 — "여기", "더보기" 등 일반어 링크는 맥락 확인 필요
  if (base.genericLinks > 0) incomplete.push("a11ychk:link-text");

  // 2.5.8 타깃 크기 — 24×24px 미만 비인라인 타깃 (간격 예외가 있어 확인 필요로만)
  if (base.targetSampled > 0) {
    if (base.smallTargets.length > 0) incomplete.push("a11ychk:target-size");
    else passes.push("a11ychk:target-size");
  }

  // 2.4.1 건너뛰기 링크 — 반복 내비게이션이 있는데 건너뛰기 링크가 없으면 확인 필요
  if (base.hasNav) {
    if (base.skipLinkPresent) passes.push("a11ychk:skip-link");
    else incomplete.push("a11ychk:skip-link");
  }

  // 1.2.2 자막 — 자막 track이 없는 video는 확인 필요
  if (base.videoNoTrack > 0) incomplete.push("a11ychk:captions-track");

  // 3.2.2 새 창 열림 고지 — target=_blank인데 고지가 없는 링크는 확인 필요
  if (base.blankNoNotice > 0) incomplete.push("a11ychk:new-window");

  return { violations, passes, incomplete };
}
