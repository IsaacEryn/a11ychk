/**
 * KWCAG 2.2 (한국형 웹 콘텐츠 접근성 지침 2.2, KS X OT0003) 검사항목 33개.
 *
 * autoCoverage:
 *  - full    : 자동 도구(axe-core)로 판정 가능한 부분이 항목의 핵심을 대부분 커버
 *  - partial : 일부만 자동 검출 가능 — 자동 결과 + 수동 확인 병행 필요
 *  - none    : 자동 판정 불가 — 반드시 수동 검사
 *
 * 자동 도구는 어떤 항목도 100% "준수"를 보증하지 못한다. 보고서에는 항상
 * 자동 검사의 한계 고지가 함께 출력된다.
 */
import type { KwcagItem } from "../types";

export const KWCAG_ITEMS: KwcagItem[] = [
  // ─── 원칙 1. 인식의 용이성 (Perceivable) ───
  {
    id: "5.1.1",
    principle: "perceivable",
    name: { ko: "적절한 대체 텍스트 제공", en: "Appropriate alternative text" },
    wcag: ["1.1.1"],
    autoCoverage: "partial",
    howToTest: {
      ko: "대체 텍스트의 존재 여부는 자동으로 검사되지만, 내용이 이미지의 의미·용도를 적절히 설명하는지는 사람이 판단해야 합니다. 스크린 리더(NVDA, VoiceOver, 센스리더)로 이미지·버튼·아이콘을 읽어 실제 의미가 전달되는지 확인하세요. 장식용 이미지는 alt=\"\"로 비어 있는지 확인합니다.",
      en: "Automated checks verify alt text exists; a human must judge whether it conveys the image's meaning. Verify with a screen reader and check decorative images use empty alt.",
    },
  },
  {
    id: "5.2.1",
    principle: "perceivable",
    name: { ko: "자막 제공", en: "Captions for multimedia" },
    wcag: ["1.2.1", "1.2.2", "1.2.3"],
    autoCoverage: "partial",
    howToTest: {
      ko: "페이지 내 동영상·음성 콘텐츠를 재생하여 자막, 대본(원고) 또는 수어 중 하나 이상이 제공되는지 확인하세요. 자막이 음성 내용과 동기화되어 정확한지도 함께 확인합니다.",
      en: "Play each video/audio and confirm captions, transcript, or sign language are provided and synchronized.",
    },
  },
  {
    id: "5.3.1",
    principle: "perceivable",
    name: { ko: "색에 무관한 콘텐츠 인식", en: "Content not relying on color alone" },
    wcag: ["1.4.1"],
    autoCoverage: "partial",
    howToTest: {
      ko: "페이지를 흑백(그레이스케일)으로 바꿔 보고, 색만으로 구분되는 정보(필수 입력 표시, 그래프 범례, 링크 구분, 오류 표시 등)가 있는지 확인하세요. 색 외에 패턴·굵기·밑줄·텍스트 등 다른 시각 단서가 함께 제공되어야 합니다.",
      en: "View the page in grayscale and check whether any information is conveyed by color alone.",
    },
  },
  {
    id: "5.3.2",
    principle: "perceivable",
    name: { ko: "명확한 지시사항 제공", en: "Clear instructions" },
    wcag: ["1.3.3"],
    autoCoverage: "none",
    howToTest: {
      ko: "\"오른쪽 버튼을 누르세요\", \"둥근 아이콘을 클릭\", \"삐 소리가 나면\" 처럼 모양·크기·위치·방향·색·소리에만 의존하는 안내가 있는지 확인하세요. 이런 지시는 텍스트 레이블 등 감각과 무관한 정보와 함께 제공되어야 합니다.",
      en: "Check for instructions that rely only on shape, size, location, orientation, color, or sound.",
    },
  },
  {
    id: "5.4.1",
    principle: "perceivable",
    name: { ko: "텍스트 콘텐츠의 명도 대비", en: "Text contrast" },
    wcag: ["1.4.3"],
    autoCoverage: "partial",
    howToTest: {
      ko: "대부분 자동으로 검사되지만, 이미지 안의 텍스트, 그라데이션·배경 이미지 위 텍스트, 마우스 오버/포커스 상태의 대비는 자동 도구가 판정하지 못할 수 있습니다. 명도 대비 4.5:1 이상(18pt 이상 큰 텍스트는 3:1)을 색상 피커로 직접 확인하세요.",
      en: "Automated checks cover most cases; manually verify text over images/gradients and hover/focus states meet 4.5:1 (3:1 for large text).",
    },
  },
  {
    id: "5.4.2",
    principle: "perceivable",
    name: { ko: "자동 재생 금지", en: "No auto-play" },
    wcag: ["1.4.2"],
    autoCoverage: "partial",
    howToTest: {
      ko: "페이지 진입 시 3초 이상 자동으로 재생되는 소리(배경음악, 동영상 소리)가 있는지 확인하세요. 자동 재생이 불가피하면 정지/음소거 수단을 콘텐츠 최상단에서 제공해야 합니다.",
      en: "Check no audio plays automatically for more than 3 seconds, or a stop/mute control is provided first.",
    },
  },
  {
    id: "5.4.3",
    principle: "perceivable",
    name: { ko: "콘텐츠 간의 구분", en: "Distinguishable content" },
    wcag: [],
    autoCoverage: "none",
    howToTest: {
      ko: "이웃한 콘텐츠 블록(본문과 배너, 메뉴와 본문 등)이 테두리·구분선·여백·배경색 차이 등으로 시각적으로 구별되는지 확인하세요. (KWCAG 고유 항목 — WCAG에는 직접 대응 기준이 없습니다.)",
      en: "Verify adjacent content blocks are visually distinguishable by borders, spacing, or background differences.",
    },
  },

  // ─── 원칙 2. 운용의 용이성 (Operable) ───
  {
    id: "6.1.1",
    principle: "operable",
    name: { ko: "키보드 사용 보장", en: "Keyboard accessible" },
    wcag: ["2.1.1", "2.1.2"],
    autoCoverage: "partial",
    howToTest: {
      ko: "마우스 없이 Tab/Shift+Tab/Enter/Space/화살표 키만으로 모든 기능(메뉴, 슬라이더, 모달, 드래그 기능의 대체 수단 포함)을 사용할 수 있는지 확인하세요. 특정 요소에 초점이 갇혀 빠져나올 수 없는 경우(키보드 함정)가 없는지도 확인합니다.",
      en: "Operate every feature using only the keyboard; ensure no keyboard traps.",
    },
  },
  {
    id: "6.1.2",
    principle: "operable",
    name: { ko: "초점 이동과 표시", en: "Focus order and visibility" },
    wcag: ["2.4.3", "2.4.7", "2.4.11"],
    autoCoverage: "partial",
    howToTest: {
      ko: "Tab 키로 이동할 때 초점이 논리적 순서(읽기 순서)로 이동하는지, 현재 초점이 시각적으로 명확히 표시되는지(outline 제거 여부), 초점이 다른 요소에 가려지지 않는지 확인하세요.",
      en: "Verify logical focus order, visible focus indicator, and that focused elements are not obscured.",
    },
  },
  {
    id: "6.1.3",
    principle: "operable",
    name: { ko: "조작 가능", en: "Target size / operable controls" },
    wcag: ["2.5.5", "2.5.8"],
    autoCoverage: "partial",
    howToTest: {
      ko: "버튼·링크 등 조작 가능한 요소의 크기가 충분한지(최소 24×24 CSS px 권장), 인접한 컨트롤과 간격이 확보되어 잘못 누를 위험이 없는지 확인하세요.",
      en: "Verify interactive targets are at least 24×24 CSS px or adequately spaced.",
    },
  },
  {
    id: "6.1.4",
    principle: "operable",
    name: { ko: "문자 단축키", en: "Character key shortcuts" },
    wcag: ["2.1.4"],
    autoCoverage: "none",
    addedIn22: true,
    howToTest: {
      ko: "단일 문자(예: 'S', '?')로 동작하는 단축키가 있다면, 끄기·재설정이 가능하거나 특정 요소에 초점이 있을 때만 동작하는지 확인하세요. 음성 입력 사용자가 의도치 않게 기능을 실행하는 것을 방지하기 위함입니다.",
      en: "If single-character shortcuts exist, verify they can be turned off, remapped, or are active only on focus.",
    },
  },
  {
    id: "6.2.1",
    principle: "operable",
    name: { ko: "응답시간 조절", en: "Adjustable time limits" },
    wcag: ["2.2.1"],
    autoCoverage: "partial",
    howToTest: {
      ko: "세션 만료, 자동 로그아웃, 시간 제한이 있는 기능(예약, 결제 등)이 있다면 사전에 알리고 연장·해제 수단을 제공하는지 확인하세요.",
      en: "If time limits exist (session timeout, etc.), verify users are warned and can extend or disable them.",
    },
  },
  {
    id: "6.2.2",
    principle: "operable",
    name: { ko: "정지 기능 제공", en: "Pause, stop, hide" },
    wcag: ["2.2.2"],
    autoCoverage: "partial",
    howToTest: {
      ko: "자동으로 움직이는 콘텐츠(캐러셀/슬라이드 배너, 흐르는 공지, 애니메이션)가 있다면 정지·이전·다음 컨트롤이 제공되는지 확인하세요. 특히 메인 비주얼 슬라이더는 정지 버튼이 필수입니다.",
      en: "Verify auto-moving content (carousels, tickers) provides pause/stop/previous/next controls.",
    },
  },
  {
    id: "6.3.1",
    principle: "operable",
    name: { ko: "깜빡임과 번쩍임 사용 제한", en: "No flashing content" },
    wcag: ["2.3.1"],
    autoCoverage: "partial",
    howToTest: {
      ko: "초당 3~50회 깜빡이거나 번쩍이는 콘텐츠(플래시 효과, 번개 효과 광고 등)가 있는지 확인하세요. 광과민성 발작을 유발할 수 있으므로 사용하지 않아야 합니다.",
      en: "Check nothing flashes more than 3 times per second.",
    },
  },
  {
    id: "6.4.1",
    principle: "operable",
    name: { ko: "반복 영역 건너뛰기", en: "Skip repeated blocks" },
    wcag: ["2.4.1"],
    autoCoverage: "partial",
    howToTest: {
      ko: "페이지 최상단에서 Tab을 눌렀을 때 '본문 바로가기' 링크가 나타나고, 실제로 본문으로 초점이 이동하는지 확인하세요. 링크 존재는 자동 검사되지만 실제 동작은 수동 확인이 필요합니다.",
      en: "Press Tab at page top and confirm a working skip link moves focus to main content.",
    },
  },
  {
    id: "6.4.2",
    principle: "operable",
    name: { ko: "제목 제공", en: "Page, frame, and content titles" },
    wcag: ["2.4.2"],
    autoCoverage: "partial",
    howToTest: {
      ko: "페이지 <title>이 페이지 내용을 구체적으로 설명하는지(사이트 전체가 동일 제목이면 위반), iframe에 title 속성이 있는지, 콘텐츠 블록에 적절한 제목(heading)이 있는지 확인하세요.",
      en: "Verify page titles are descriptive and unique, frames are titled, and content sections have headings.",
    },
  },
  {
    id: "6.4.3",
    principle: "operable",
    name: { ko: "적절한 링크 텍스트", en: "Meaningful link text" },
    wcag: ["2.4.4"],
    autoCoverage: "partial",
    howToTest: {
      ko: "'여기', '더보기', '클릭' 처럼 목적지를 알 수 없는 링크 텍스트가 있는지 확인하세요. 링크 텍스트만 읽어도(또는 주변 문맥과 함께) 어디로 가는지 알 수 있어야 합니다.",
      en: "Check link text (with context) identifies the destination — avoid bare 'click here' / 'more'.",
    },
  },
  {
    id: "6.4.4",
    principle: "operable",
    name: { ko: "고정된 참조 위치 정보", en: "Consistent reference locators (e-pub)" },
    wcag: [],
    autoCoverage: "none",
    addedIn22: true,
    howToTest: {
      ko: "전자출판문서(EPUB 등 웹 기반 전자책)에 적용되는 항목입니다. 페이지 구분자가 있는 경우 각 페이지 위치가 고정적으로 참조 가능한지 확인하세요. 일반 웹 페이지에는 해당하지 않는 경우가 많습니다.",
      en: "Applies to web-based e-publications: verify fixed page locators exist. Often N/A for ordinary web pages.",
    },
  },
  {
    id: "6.5.1",
    principle: "operable",
    name: { ko: "단일 포인터 입력 지원", en: "Single pointer gestures" },
    wcag: ["2.5.1"],
    autoCoverage: "none",
    addedIn22: true,
    howToTest: {
      ko: "핀치 줌, 두 손가락 스와이프, 경로 기반 제스처(드래그로 그리기 등)가 필요한 기능이 있다면, 한 손가락 탭/더블탭 등 단일 포인터로도 동일 기능을 수행할 수 있는지 확인하세요.",
      en: "Verify multipoint or path-based gestures have single-pointer alternatives.",
    },
  },
  {
    id: "6.5.2",
    principle: "operable",
    name: { ko: "포인터 입력 취소", en: "Pointer cancellation" },
    wcag: ["2.5.2"],
    autoCoverage: "none",
    addedIn22: true,
    howToTest: {
      ko: "버튼 등을 누른 상태에서 포인터를 밖으로 이동해 떼면 실행이 취소되는지 확인하세요. 기능은 down 이벤트가 아니라 up 이벤트에서 실행되어야 합니다.",
      en: "Verify actions trigger on pointer-up and can be aborted by moving off the target.",
    },
  },
  {
    id: "6.5.3",
    principle: "operable",
    name: { ko: "레이블과 네임", en: "Label in name" },
    wcag: ["2.5.3"],
    autoCoverage: "partial",
    addedIn22: true,
    howToTest: {
      ko: "화면에 보이는 버튼·링크 텍스트가 접근 가능한 이름(aria-label 등)에 포함되는지 확인하세요. 음성 인식 사용자가 화면에 보이는 이름으로 컨트롤을 호출할 수 있어야 합니다.",
      en: "Verify the visible text of controls is contained in their accessible name.",
    },
  },
  {
    id: "6.5.4",
    principle: "operable",
    name: { ko: "동작기반 작동", en: "Motion actuation" },
    wcag: ["2.5.4"],
    autoCoverage: "none",
    addedIn22: true,
    howToTest: {
      ko: "기기 흔들기·기울이기 등 동작으로 실행되는 기능이 있다면, 버튼 등 일반적인 UI로도 동일 기능을 수행할 수 있고 동작 인식을 끌 수 있는지 확인하세요.",
      en: "Verify motion-triggered functions have UI alternatives and motion sensing can be disabled.",
    },
  },

  // ─── 원칙 3. 이해의 용이성 (Understandable) ───
  {
    id: "7.1.1",
    principle: "understandable",
    name: { ko: "기본 언어 표시", en: "Language of page" },
    wcag: ["3.1.1"],
    autoCoverage: "full",
  },
  {
    id: "7.2.1",
    principle: "understandable",
    name: { ko: "사용자 요구에 따른 실행", en: "No change of context without request" },
    wcag: ["3.2.1", "3.2.2"],
    autoCoverage: "none",
    howToTest: {
      ko: "요소에 초점이 가거나 값을 선택하기만 했는데 새 창이 열리거나 페이지가 이동하는 등 예고 없는 맥락 변화가 있는지 확인하세요. 새 창이 열리는 링크는 사전에 알려야 합니다(예: '새 창 열림' 표시).",
      en: "Verify focus or input alone never triggers unexpected context changes; new windows are announced in advance.",
    },
  },
  {
    id: "7.2.2",
    principle: "understandable",
    name: { ko: "찾기 쉬운 도움 정보", en: "Consistent help" },
    wcag: ["3.2.6"],
    autoCoverage: "none",
    addedIn22: true,
    howToTest: {
      ko: "고객센터 연락처, 챗봇, 도움말 링크 등 도움 정보가 여러 페이지에서 동일한 상대적 위치(예: 항상 푸터, 항상 우측 하단)에 일관되게 제공되는지 확인하세요.",
      en: "Verify help mechanisms appear in the same relative location across pages.",
    },
  },
  {
    id: "7.3.1",
    principle: "understandable",
    name: { ko: "콘텐츠의 선형구조", en: "Meaningful sequence" },
    wcag: ["1.3.1", "1.3.2"],
    autoCoverage: "partial",
    howToTest: {
      ko: "CSS를 끄거나 스크린 리더로 읽었을 때 콘텐츠가 논리적 순서로 제공되는지 확인하세요. 시각적 배치(position, order 등)로만 순서를 만든 경우 실제 DOM 순서가 뒤섞여 있을 수 있습니다.",
      en: "Disable CSS or use a screen reader to verify the content order is logical.",
    },
  },
  {
    id: "7.3.2",
    principle: "understandable",
    name: { ko: "표의 구성", en: "Table structure" },
    wcag: ["1.3.1"],
    autoCoverage: "partial",
    howToTest: {
      ko: "데이터 표에 caption 또는 요약이 제공되고 제목 셀(th)과 데이터 셀(td)이 구분되는지는 자동 검사되지만, 복잡한 표의 헤더 연결(scope, headers)이 의미상 올바른지는 스크린 리더로 셀을 탐색하며 확인하세요.",
      en: "Verify captions and header cells exist (automated) and header associations read correctly in a screen reader.",
    },
  },
  {
    id: "7.4.1",
    principle: "understandable",
    name: { ko: "레이블 제공", en: "Labels for inputs" },
    wcag: ["3.3.2", "1.3.1"],
    autoCoverage: "partial",
    howToTest: {
      ko: "모든 입력 서식에 레이블이 연결되어 있는지는 자동 검사되지만, 레이블 내용이 입력 목적을 정확히 설명하는지, placeholder만으로 레이블을 대신하고 있지 않은지 확인하세요.",
      en: "Automated checks verify labels exist; confirm they describe the purpose and placeholders aren't used as labels.",
    },
  },
  {
    id: "7.4.2",
    principle: "understandable",
    name: { ko: "오류 정정", en: "Error identification & correction" },
    wcag: ["3.3.1", "3.3.3"],
    autoCoverage: "none",
    howToTest: {
      ko: "서식을 잘못 입력하고 제출해 보세요. 어떤 항목이 왜 잘못되었는지 텍스트로 알려주는지, 오류 위치로 초점이 이동하거나 쉽게 찾아갈 수 있는지, 정정 방법을 제안하는지 확인하세요.",
      en: "Submit invalid forms and verify errors are identified in text with correction suggestions.",
    },
  },
  {
    id: "7.4.3",
    principle: "understandable",
    name: { ko: "접근 가능한 인증", en: "Accessible authentication" },
    wcag: ["3.3.8"],
    autoCoverage: "none",
    addedIn22: true,
    howToTest: {
      ko: "로그인 등 인증 과정에서 왜곡된 문자 읽기, 퍼즐 풀기 같은 인지 기능 테스트에만 의존하는지 확인하세요. 붙여넣기 허용, 브라우저 자동완성 허용, 이메일 링크 인증 등 대체 수단이 제공되어야 합니다.",
      en: "Verify authentication doesn't rely solely on cognitive tests; paste and autofill must not be blocked.",
    },
  },
  {
    id: "7.4.4",
    principle: "understandable",
    name: { ko: "반복 입력 정보", en: "Redundant entry" },
    wcag: ["3.3.7"],
    autoCoverage: "none",
    addedIn22: true,
    howToTest: {
      ko: "여러 단계로 이루어진 절차(회원가입, 주문 등)에서 같은 정보를 다시 입력하도록 요구하는지 확인하세요. 이전에 입력한 정보는 자동 입력되거나 선택 가능해야 합니다.",
      en: "In multi-step processes, verify previously entered information is auto-populated or selectable.",
    },
  },

  // ─── 원칙 4. 견고성 (Robust) ───
  {
    id: "8.1.1",
    principle: "robust",
    name: { ko: "마크업 오류 방지", en: "Parsing / valid markup" },
    wcag: ["4.1.1"],
    autoCoverage: "full",
  },
  {
    id: "8.2.1",
    principle: "robust",
    name: { ko: "웹 애플리케이션 접근성 준수", en: "Accessible web applications (ARIA)" },
    wcag: ["4.1.2", "4.1.3"],
    autoCoverage: "partial",
    howToTest: {
      ko: "ARIA 속성 오용은 자동 검사되지만, 커스텀 위젯(탭, 아코디언, 모달 등)이 스크린 리더에서 역할·상태·값을 올바르게 안내하고 키보드 패턴(WAI-ARIA APG)대로 동작하는지는 보조기기로 직접 확인하세요.",
      en: "Automated checks catch ARIA misuse; verify custom widgets announce role/state and follow APG keyboard patterns.",
    },
  },
];

export const KWCAG_BY_ID: ReadonlyMap<string, KwcagItem> = new Map(KWCAG_ITEMS.map((i) => [i.id, i]));

export const KWCAG_PRINCIPLE_LABEL: Record<KwcagItem["principle"], { ko: string; en: string }> = {
  perceivable: { ko: "인식의 용이성", en: "Perceivable" },
  operable: { ko: "운용의 용이성", en: "Operable" },
  understandable: { ko: "이해의 용이성", en: "Understandable" },
  robust: { ko: "견고성", en: "Robust" },
};
