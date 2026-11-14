/**
 * KWCAG 2.2 (한국형 웹 콘텐츠 접근성 지침 2.2, KS X OT0003:2022) 검사항목 33개.
 *
 * 순서·번호·이름·원칙은 표준 원문을 따른다 — 방송통신표준심의회 2022-12-28 개정본,
 * 국립전파연구원 방송통신표준자료실 게시
 * (https://www.rra.go.kr/ko/reference/kcsList_view.do?nb_seq=5247&nb_type=6).
 * - slug: 항목의 고정 식별자(공개 URL·저장 키). 바꾸지 않는다.
 * - ksNo: 표준 본문의 검사항목 번호(5.1.1~8.2.1). 표시용.
 * - serial: 웹 접근성 품질인증 심사의 일련번호(1~33, 같은 순서). 표시·정렬용.
 *   (한국지능정보사회진흥원 「웹 접근성 품질인증 표준심사 지침」, 2024. 10.)
 * 2026-10 이전 a11ychk는 자체 번호를 썼다 — 옛 번호 해석은 kwcagLegacy.ts.
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
import { pickLocale } from "../util/locale";

export const KWCAG_ITEMS: KwcagItem[] = [
  // ─── 원칙 1. 인식의 용이성 (Perceivable) ───
  {
    slug: "alternative-text",
    ksNo: "5.1.1",
    serial: 1,
    principle: "perceivable",
    name: { ko: "적절한 대체 텍스트 제공", en: "Appropriate alternative text" },
    wcag: ["1.1.1"],
    autoCoverage: "partial",
    howToTest: {
      ko: "대체 텍스트의 존재 여부는 자동으로 검사되지만, 내용이 이미지의 의미·용도를 적절히 설명하는지는 사람이 판단해야 합니다. 스크린 리더(NVDA, VoiceOver, 센스리더)로 이미지·버튼·아이콘을 읽어 실제 의미가 전달되는지 확인하세요. 장식용 이미지는 alt=\"\"로 비어 있는지 확인합니다.",
      en: "Automated checks verify that alt text exists, but a person has to judge whether it properly describes the image's meaning and purpose. Read images, buttons, and icons with a screen reader (NVDA, VoiceOver, or Sense Reader) to confirm the actual meaning comes across. Check that decorative images have an empty alt=\"\".",
    },
  },
  {
    slug: "captions-for-multimedia",
    ksNo: "5.2.1",
    serial: 2,
    principle: "perceivable",
    name: { ko: "자막 제공", en: "Captions for multimedia" },
    wcag: ["1.2.1", "1.2.2", "1.2.3"],
    autoCoverage: "partial",
    howToTest: {
      ko: "페이지 내 동영상·음성 콘텐츠를 재생하여 자막, 대본(원고) 또는 수어 중 하나 이상이 제공되는지 확인하세요. 자막이 음성 내용과 동기화되어 정확한지도 함께 확인합니다.",
      en: "Play each video and audio clip on the page and confirm that at least one of captions, a transcript, or sign language interpretation is provided. Also check that the captions are accurate and synchronized with the audio.",
    },
  },
  {
    slug: "table-structure",
    ksNo: "5.3.1",
    serial: 3,
    principle: "perceivable",
    name: { ko: "표의 구성", en: "Table structure" },
    wcag: ["1.3.1"],
    autoCoverage: "partial",
    howToTest: {
      ko: "데이터 표에 caption 또는 요약이 제공되고 제목 셀(th)과 데이터 셀(td)이 구분되는지는 자동 검사되지만, 복잡한 표의 헤더 연결(scope, headers)이 의미상 올바른지는 스크린 리더로 셀을 탐색하며 확인하세요.",
      en: "Automated checks verify that data tables have a caption or summary and that header cells (th) are distinguished from data cells (td). Whether header associations in complex tables (scope, headers) are semantically correct must be checked by moving through the cells with a screen reader.",
    },
  },
  {
    slug: "meaningful-sequence",
    ksNo: "5.3.2",
    serial: 4,
    principle: "perceivable",
    name: { ko: "콘텐츠의 선형구조", en: "Meaningful sequence" },
    wcag: ["1.3.1", "1.3.2"],
    autoCoverage: "partial",
    howToTest: {
      ko: "CSS를 끄거나 스크린 리더로 읽었을 때 콘텐츠가 논리적 순서로 제공되는지 확인하세요. 시각적 배치(position, order 등)로만 순서를 만든 경우 실제 DOM 순서가 뒤섞여 있을 수 있습니다.",
      en: "Turn off CSS or read the page with a screen reader and confirm the content comes out in a logical order. If the order is created only through visual layout (position, order, and similar), the actual DOM order may be scrambled.",
    },
  },
  {
    slug: "clear-instructions",
    ksNo: "5.3.3",
    serial: 5,
    principle: "perceivable",
    name: { ko: "명확한 지시사항 제공", en: "Clear instructions" },
    wcag: ["1.3.3"],
    autoCoverage: "none",
    howToTest: {
      ko: "안내 문구가 모양·크기·위치·방향·색·소리 같은 감각 정보에만 기대지 않는지 확인합니다. 본문, 서식 안내, 오류 메시지, 도움말에서 \"오른쪽 버튼을 누르세요\", \"빨간 글씨 항목\", \"둥근 아이콘을 클릭\", \"삐 소리가 나면\" 같은 표현을 찾고, 같은 안내 안에 대상의 텍스트 이름(예: '다음' 버튼)이 함께 있는지 봅니다. 스크린 리더로 듣거나 CSS를 끈 상태에서도 그대로 따라 할 수 있으면 통과, 위치·색·소리만으로 대상을 가리키면 실패입니다.",
      en: "Check that instructions don't rely only on sensory characteristics such as shape, size, position, orientation, color, or sound. Search the body text, form hints, error messages, and help for phrases like \"press the button on the right\", \"the fields in red\", \"click the round icon\", or \"when you hear the beep\", and confirm the same instruction also names the target in text (for example, the \"Next\" button). It passes if the instruction can still be followed with a screen reader or with CSS turned off; it fails if position, color, or sound is the only way to identify the target.",
    },
  },
  {
    slug: "content-not-relying-on-color-alone",
    ksNo: "5.4.1",
    serial: 6,
    principle: "perceivable",
    name: { ko: "색에 무관한 콘텐츠 인식", en: "Content not relying on color alone" },
    wcag: ["1.4.1"],
    autoCoverage: "partial",
    howToTest: {
      ko: "페이지를 흑백(그레이스케일)으로 바꿔 보고, 색만으로 구분되는 정보(필수 입력 표시, 그래프 범례, 링크 구분, 오류 표시 등)가 있는지 확인하세요. 색 외에 패턴·굵기·밑줄·텍스트 등 다른 시각 단서가 함께 제공되어야 합니다.",
      en: "Switch the page to grayscale and look for information distinguished only by color, such as required-field markers, chart legends, link styling, or error indicators. Another visual cue, such as a pattern, weight, underline, or text, must accompany the color.",
    },
  },
  {
    slug: "no-auto-play",
    ksNo: "5.4.2",
    serial: 7,
    principle: "perceivable",
    name: { ko: "자동 재생 금지", en: "No auto-play" },
    wcag: ["1.4.2"],
    autoCoverage: "partial",
    howToTest: {
      ko: "페이지 진입 시 3초 이상 자동으로 재생되는 소리(배경음악, 동영상 소리)가 있는지 확인하세요. 자동 재생이 불가피하면 정지/음소거 수단을 콘텐츠 최상단에서 제공해야 합니다.",
      en: "Check whether any sound (background music, video audio) plays automatically for more than 3 seconds when the page opens. If autoplay can't be avoided, a stop or mute control must be provided at the very top of the content.",
    },
  },
  {
    slug: "text-contrast",
    ksNo: "5.4.3",
    serial: 8,
    principle: "perceivable",
    name: { ko: "텍스트 콘텐츠의 명도 대비", en: "Text contrast" },
    wcag: ["1.4.3"],
    autoCoverage: "partial",
    howToTest: {
      ko: "대부분 자동으로 검사되지만, 이미지 안의 텍스트, 그라데이션·배경 이미지 위 텍스트, 마우스 오버/포커스 상태의 대비는 자동 도구가 판정하지 못할 수 있습니다. 명도 대비 4.5:1 이상(18pt 이상 큰 텍스트는 3:1)을 색상 피커로 직접 확인하세요.",
      en: "Most cases are checked automatically, but automated tools may not be able to judge text inside images, text over gradients or background images, or contrast in hover and focus states. Use a color picker to verify a contrast ratio of at least 4.5:1 (3:1 for large text of 18pt or more).",
    },
  },
  {
    slug: "distinguishable-content",
    ksNo: "5.4.4",
    serial: 9,
    principle: "perceivable",
    name: { ko: "콘텐츠 간의 구분", en: "Distinguishable content" },
    wcag: [],
    autoCoverage: "none",
    howToTest: {
      ko: "이웃한 콘텐츠 블록이 테두리·구분선·무늬·배경색·여백 가운데 하나 이상으로 서로 구별되는지 눈으로 확인합니다. 머리글·메뉴·본문·배너·꼬리말처럼 영역이 맞닿는 곳과 목록·카드·게시물처럼 같은 모양이 반복되는 곳을 중심으로 봅니다. 배경색 차이로만 나눴다면 화면을 흑백으로 바꿔도 경계가 보이는지 함께 보고, 블록끼리 경계를 알 수 없어 한 덩어리로 보이면 실패입니다. (KWCAG 고유 항목 — WCAG에는 직접 대응 기준이 없습니다.)",
      en: "Visually check that adjacent content blocks are set apart by at least one cue: a border, divider line, pattern, background color, or spacing. Focus on places where regions meet (header, menu, main content, banners, footer) and where similar items repeat (lists, cards, posts). If only a background color separates them, also view the page in grayscale to confirm the boundary stays visible; it fails when blocks run together and their edges can't be made out. (A KWCAG-specific checkpoint with no direct WCAG counterpart.)",
    },
  },

  // ─── 원칙 2. 운용의 용이성 (Operable) ───
  {
    slug: "keyboard-accessible",
    ksNo: "6.1.1",
    serial: 10,
    principle: "operable",
    name: { ko: "키보드 사용 보장", en: "Keyboard accessible" },
    wcag: ["2.1.1", "2.1.2"],
    autoCoverage: "partial",
    howToTest: {
      ko: "마우스 없이 Tab/Shift+Tab/Enter/Space/화살표 키만으로 모든 기능(메뉴, 슬라이더, 모달, 드래그 기능의 대체 수단 포함)을 사용할 수 있는지 확인하세요. 특정 요소에 초점이 갇혀 빠져나올 수 없는 경우(키보드 함정)가 없는지도 확인합니다.",
      en: "Without a mouse, confirm every feature (menus, sliders, modals, and alternatives to drag interactions) can be used with only Tab, Shift+Tab, Enter, Space, and the arrow keys. Also check that focus never gets trapped on an element with no way out (a keyboard trap).",
    },
  },
  {
    slug: "focus-order-and-visibility",
    ksNo: "6.1.2",
    serial: 11,
    principle: "operable",
    name: { ko: "초점 이동과 표시", en: "Focus order and visibility" },
    wcag: ["2.4.3", "2.4.7", "2.4.11"],
    autoCoverage: "partial",
    howToTest: {
      ko: "Tab 키로 이동할 때 초점이 논리적 순서(읽기 순서)로 이동하는지, 현재 초점이 시각적으로 명확히 표시되는지(outline 제거 여부), 초점이 다른 요소에 가려지지 않는지 확인하세요.",
      en: "Press Tab and check that focus moves in a logical (reading) order, that the current focus is clearly visible (watch for removed outlines), and that the focused element isn't hidden behind other content.",
    },
  },
  {
    slug: "target-size",
    ksNo: "6.1.3",
    serial: 12,
    principle: "operable",
    name: { ko: "조작 가능", en: "Target size / operable controls" },
    // 2.5.5(Target Size Enhanced)는 AAA라 카탈로그 밖 — 목표 수준(A/AA) 대응은 2.5.8뿐
    wcag: ["2.5.8"],
    autoCoverage: "partial",
    howToTest: {
      ko: "버튼·링크 등 조작 가능한 요소의 크기가 충분한지(최소 24×24 CSS px 권장), 인접한 컨트롤과 간격이 확보되어 잘못 누를 위험이 없는지 확인하세요.",
      en: "Check that buttons, links, and other interactive elements are large enough (at least 24×24 CSS px recommended) and have enough space from adjacent controls that there's no risk of pressing the wrong one.",
    },
  },
  {
    slug: "character-key-shortcuts",
    ksNo: "6.1.4",
    serial: 13,
    principle: "operable",
    name: { ko: "문자 단축키", en: "Character key shortcuts" },
    wcag: ["2.1.4"],
    autoCoverage: "none",
    addedIn22: true,
    howToTest: {
      ko: "단일 문자(예: 'S', '?')로 동작하는 단축키가 있다면, 끄기·재설정이 가능하거나 특정 요소에 초점이 있을 때만 동작하는지 확인하세요. 음성 입력 사용자가 의도치 않게 기능을 실행하는 것을 방지하기 위함입니다.",
      en: "If shortcuts that use a single character (such as 'S' or '?') exist, check that they can be turned off or remapped, or work only while a specific element has focus. This prevents speech input users from triggering features by accident.",
    },
  },
  {
    slug: "adjustable-time-limits",
    ksNo: "6.2.1",
    serial: 14,
    principle: "operable",
    name: { ko: "응답시간 조절", en: "Adjustable time limits" },
    wcag: ["2.2.1"],
    autoCoverage: "partial",
    howToTest: {
      ko: "세션 만료, 자동 로그아웃, 시간 제한이 있는 기능(예약, 결제 등)이 있다면 사전에 알리고 연장·해제 수단을 제공하는지 확인하세요.",
      en: "If there are session expiries, automatic logouts, or time-limited features (bookings, payments, and so on), check that users are told in advance and given a way to extend or turn off the limit.",
    },
  },
  {
    slug: "pause-stop-hide",
    ksNo: "6.2.2",
    serial: 15,
    principle: "operable",
    name: { ko: "정지 기능 제공", en: "Pause, stop, hide" },
    wcag: ["2.2.2"],
    autoCoverage: "partial",
    howToTest: {
      ko: "자동으로 움직이는 콘텐츠(캐러셀/슬라이드 배너, 흐르는 공지, 애니메이션)가 있다면 정지·이전·다음 컨트롤이 제공되는지 확인하세요. 특히 메인 비주얼 슬라이더는 정지 버튼이 필수입니다.",
      en: "If content moves automatically (carousels and slide banners, scrolling notices, animations), check that pause/stop, previous, and next controls are provided. A main visual slider in particular must have a pause button.",
    },
  },
  {
    slug: "no-flashing-content",
    ksNo: "6.3.1",
    serial: 16,
    principle: "operable",
    name: { ko: "깜빡임과 번쩍임 사용 제한", en: "No flashing content" },
    wcag: ["2.3.1"],
    autoCoverage: "partial",
    howToTest: {
      ko: "초당 3~50회 깜빡이거나 번쩍이는 콘텐츠(플래시 효과, 번개 효과 광고 등)가 있는지 확인하세요. 광과민성 발작을 유발할 수 있으므로 사용하지 않아야 합니다.",
      en: "Check for content that blinks or flashes 3 to 50 times per second (flash effects, lightning-effect ads, and so on). It must not be used because it can trigger photosensitive seizures.",
    },
  },
  {
    slug: "skip-repeated-blocks",
    ksNo: "6.4.1",
    serial: 17,
    principle: "operable",
    name: { ko: "반복 영역 건너뛰기", en: "Skip repeated blocks" },
    wcag: ["2.4.1"],
    autoCoverage: "partial",
    howToTest: {
      ko: "페이지 최상단에서 Tab을 눌렀을 때 '본문 바로가기' 링크가 나타나고, 실제로 본문으로 초점이 이동하는지 확인하세요. 링크 존재는 자동 검사되지만 실제 동작은 수동 확인이 필요합니다.",
      en: "Press Tab at the top of the page and confirm a \"Skip to main content\" link appears and actually moves focus to the main content. The link's presence is checked automatically, but whether it works needs a manual check.",
    },
  },
  {
    slug: "page-frame-and-content-titles",
    ksNo: "6.4.2",
    serial: 18,
    principle: "operable",
    name: { ko: "제목 제공", en: "Page, frame, and content titles" },
    wcag: ["2.4.2"],
    autoCoverage: "partial",
    howToTest: {
      ko: "페이지 <title>이 페이지 내용을 구체적으로 설명하는지(사이트 전체가 동일 제목이면 위반), iframe에 title 속성이 있는지, 콘텐츠 블록에 적절한 제목(heading)이 있는지 확인하세요.",
      en: "Check that each page's <title> specifically describes its content (the same title across the whole site is a failure), that iframes have a title attribute, and that content blocks have appropriate headings.",
    },
  },
  {
    slug: "meaningful-link-text",
    ksNo: "6.4.3",
    serial: 19,
    principle: "operable",
    name: { ko: "적절한 링크 텍스트", en: "Meaningful link text" },
    wcag: ["2.4.4"],
    autoCoverage: "partial",
    howToTest: {
      ko: "'여기', '더보기', '클릭' 처럼 목적지를 알 수 없는 링크 텍스트가 있는지 확인하세요. 링크 텍스트만 읽어도(또는 주변 문맥과 함께) 어디로 가는지 알 수 있어야 합니다.",
      en: "Look for link text that doesn't reveal the destination, such as \"here\", \"more\", or \"click\". The link text alone (or together with its surrounding context) must tell users where the link goes.",
    },
  },
  {
    slug: "consistent-reference-locators",
    ksNo: "6.4.4",
    serial: 20,
    principle: "operable",
    name: { ko: "고정된 참조 위치 정보", en: "Consistent reference locators (e-pub)" },
    wcag: [],
    autoCoverage: "none",
    addedIn22: true,
    howToTest: {
      ko: "전자출판문서 형식의 웹 페이지에 각 페이지로 이동하는 기능이 있고, 참조 위치 정보가 서식·플랫폼과 관계없이 일관되게 유지되는지 확인합니다. 페이지 목록이나 페이지 번호 입력 같은 이동 기능이 있는지 보고, 글자 크기를 키우거나 다른 리더 앱·브라우저에서 연 뒤 같은 페이지 번호로 이동해 같은 내용이 나오는지 비교합니다. 인쇄본의 쪽 번호를 따르는 문서라면 EPUB의 page-list 탐색 목록과 pagebreak 표시가 원본 쪽 번호와 맞아야 합니다. 페이지 구분이 없는 일반 웹 페이지는 대부분 해당 없음으로 처리합니다.",
      en: "In web pages published as e-publications, check that readers can move to each page and that page locators stay consistent regardless of format or platform. Look for a way to navigate by page (a page list or a page-number input), then enlarge the text or open the publication in another reading app or browser and confirm the same page number still leads to the same content. If the publication follows a print edition's page numbers, the EPUB page-list navigation and pagebreak markers must match the original. Ordinary web pages without page divisions are usually marked not applicable.",
    },
  },
  {
    slug: "single-pointer-gestures",
    ksNo: "6.5.1",
    serial: 21,
    principle: "operable",
    name: { ko: "단일 포인터 입력 지원", en: "Single pointer gestures" },
    wcag: ["2.5.1"],
    autoCoverage: "none",
    addedIn22: true,
    howToTest: {
      ko: "두 손가락 이상을 쓰는 다중 포인터 제스처나, 움직이는 경로가 중요한 경로 기반 제스처로만 작동하는 기능이 없는지 확인합니다. 지도 핀치 확대, 두 손가락 회전, 캐러셀 스와이프, 정해진 모양을 그려 잠금 해제하기 같은 기능을 찾아, 확대·축소 버튼이나 이전·다음 버튼처럼 한 지점을 누르는 조작(탭, 두 번 탭, 길게 누르기)으로도 같은 결과를 얻을 수 있는지 터치 기기와 마우스로 시험합니다. 대체 조작이 없으면 실패이며, 서명 입력처럼 경로 자체가 필수인 경우와 페이지 확대처럼 브라우저·운영체제가 제공하는 제스처는 예외입니다.",
      en: "Check that no function works only through multipoint gestures (two or more fingers) or path-based gestures where the path of movement matters. Find features such as pinch-to-zoom maps, two-finger rotation, carousel swipes, or drawing a pattern to unlock, and test on a touch device and with a mouse whether the same result is available through single-point actions such as a tap, double tap, or long press (zoom buttons, previous/next buttons, and so on). It fails if there is no such alternative; exceptions are cases where the path is essential, such as drawing a signature, and gestures provided by the browser or operating system, such as page zoom.",
    },
  },
  {
    slug: "pointer-cancellation",
    ksNo: "6.5.2",
    serial: 22,
    principle: "operable",
    name: { ko: "포인터 입력 취소", en: "Pointer cancellation" },
    wcag: ["2.5.2"],
    autoCoverage: "none",
    addedIn22: true,
    howToTest: {
      ko: "한 번 누르기로 실행되는 기능이 포인터를 누르는 순간(down 이벤트)이 아니라 떼는 순간(up 이벤트)에 실행되고, 실행 전에 취소할 수 있는지 확인합니다. 버튼·링크·메뉴를 마우스로 누른 채 기다려 그 상태에서 아무 동작도 일어나지 않는지 보고, 누른 채로 포인터를 대상 밖으로 옮긴 뒤 떼면 실행이 취소되는지 시험합니다. 터치 화면에서도 같은 방법으로 확인하고, 개발자 도구에서 mousedown·pointerdown·touchstart에 기능을 바로 연결한 핸들러가 있는지 보면 원인을 찾기 쉽습니다. 누르는 순간 실행되더라도 실행 뒤 되돌릴 수 있거나, 떼면 원래대로 돌아오거나(누르는 동안만 재생 등), 화면 피아노 건반처럼 누르는 순간 실행되는 것이 본질이면 통과입니다.",
      en: "Check that functions triggered by a single pointer run when the pointer is released (the up event), not the moment it goes down, and can be cancelled before they run. Press and hold buttons, links, and menu items with the mouse to confirm nothing happens while held, then move the pointer off the target before releasing and confirm the action is cancelled. Repeat on a touch screen; in developer tools, handlers that attach functionality directly to mousedown, pointerdown, or touchstart usually point to the cause. It still passes if an action triggered on press can be undone afterward, if releasing reverses it (for example, play only while held), or if acting on press is essential, as with an on-screen piano keyboard.",
    },
  },
  {
    slug: "label-in-name",
    ksNo: "6.5.3",
    serial: 23,
    principle: "operable",
    name: { ko: "레이블과 네임", en: "Label in name" },
    wcag: ["2.5.3"],
    autoCoverage: "partial",
    addedIn22: true,
    howToTest: {
      ko: "화면에 보이는 버튼·링크 텍스트가 접근 가능한 이름(aria-label 등)에 포함되는지 확인하세요. 음성 인식 사용자가 화면에 보이는 이름으로 컨트롤을 호출할 수 있어야 합니다.",
      en: "Check that the visible text of buttons and links is included in their accessible name (aria-label and so on). Speech recognition users must be able to activate a control by saying the name they see on screen.",
    },
  },
  {
    slug: "motion-actuation",
    ksNo: "6.5.4",
    serial: 24,
    principle: "operable",
    name: { ko: "동작기반 작동", en: "Motion actuation" },
    wcag: ["2.5.4"],
    autoCoverage: "none",
    addedIn22: true,
    howToTest: {
      ko: "기기를 흔들거나 기울이는 동작, 카메라 앞에서 손을 흔드는 동작처럼 기기나 사용자의 움직임으로 실행되는 기능이 버튼 같은 일반 UI로도 실행되는지 확인합니다. 스마트폰에서 흔들어 실행 취소하기, 기울여서 스크롤하거나 사진 넘기기 같은 기능을 직접 실행해 보고, 같은 기능을 화면의 컨트롤로도 쓸 수 있는지 봅니다. 설정 등에서 동작 인식을 끌 수 있는지, 끈 뒤에는 기기를 움직여도 실행되지 않는지도 시험합니다. 대체 UI가 없거나 동작 인식을 끌 수 없으면 실패이고, 걸음 수 측정처럼 움직임 자체가 기능의 본질인 경우는 예외입니다.",
      en: "Check that functions triggered by device or user motion, such as shaking or tilting the device or waving at the camera, can also be operated through regular UI like buttons. On a phone, try features such as shake to undo or tilt to scroll or flip through photos, and confirm the same function is available from on-screen controls. Also test whether motion response can be turned off (in settings or similar) and that, once off, moving the device no longer triggers the function. It fails if there is no UI alternative or motion response can't be disabled; it's an exception when motion is essential to the function, as in a step counter.",
    },
  },

  // ─── 원칙 3. 이해의 용이성 (Understandable) ───
  {
    slug: "language-of-page",
    ksNo: "7.1.1",
    serial: 25,
    principle: "understandable",
    name: { ko: "기본 언어 표시", en: "Language of page" },
    wcag: ["3.1.1"],
    autoCoverage: "full",
    howToTest: {
      ko: "페이지 소스에서 <html> 요소에 lang 속성이 있는지, 값이 실제 주 언어와 일치하는지(한국어 페이지는 lang=\"ko\") 확인하세요. 자동 검사가 속성 존재와 형식을 판정하지만, 값이 콘텐츠의 실제 언어와 맞는지는 사람이 확인해야 합니다. 스크린 리더는 이 값으로 발음 엔진을 고르므로 잘못 표기하면 낭독이 통째로 어긋납니다.",
      en: "Check that the <html> element has a lang attribute matching the page's primary language (e.g., lang=\"ko\" for Korean). Automated checks verify presence and format, but whether the value matches the actual content language needs human review — screen readers pick their speech engine from this value.",
    },
  },
  {
    slug: "no-change-of-context-without-request",
    ksNo: "7.2.1",
    serial: 26,
    principle: "understandable",
    name: { ko: "사용자 요구에 따른 실행", en: "No change of context without request" },
    wcag: ["3.2.1", "3.2.2"],
    autoCoverage: "none",
    howToTest: {
      ko: "요소에 초점이 가거나 값을 선택하기만 했는데 새 창이 열리거나 페이지가 이동하는 등 예고 없는 맥락 변화가 있는지 확인하세요. 새 창이 열리는 링크는 사전에 알려야 합니다(예: '새 창 열림' 표시).",
      en: "Check for unexpected context changes, such as a new window opening or the page navigating away, when an element merely receives focus or a value is merely selected. Links that open a new window must say so in advance (for example, an \"opens in a new window\" note).",
    },
  },
  {
    slug: "consistent-help",
    ksNo: "7.2.2",
    serial: 27,
    principle: "understandable",
    name: { ko: "찾기 쉬운 도움 정보", en: "Consistent help" },
    wcag: ["3.2.6"],
    autoCoverage: "none",
    addedIn22: true,
    howToTest: {
      ko: "여러 페이지에 반복해서 제공되는 도움 정보가 각 페이지에서 같은 상대적 순서로 놓여 있는지 확인합니다. 대상은 전화번호·이메일 같은 담당자 연락처, 문의하기 서식·실시간 상담 같은 연락 수단, 자주 묻는 질문 같은 자체 도움말, 챗봇입니다. 같은 사이트의 메인·목록·상세·서식 페이지를 차례로 열어 도움 정보가 다른 콘텐츠를 기준으로 같은 순서에 있는지 비교하고, 화면 폭을 모바일 크기로 줄인 상태에서도 페이지끼리 순서가 같은지 봅니다. 도움 정보를 반드시 제공하라는 항목은 아니며, 사용자가 직접 배치를 바꾼 경우는 예외입니다.",
      en: "Check that help repeated across multiple pages appears in the same order relative to the other page content on every page. Help here means human contact details (phone, email), a contact mechanism (contact form, live chat), self-help options (FAQ, help pages), and chatbots. Open the home, list, detail, and form pages of the same site and compare whether the help sits in the same relative order, then narrow the window to mobile width and compare the pages again at that size. The checkpoint doesn't require help to exist, and a change the user makes to the layout is an exception.",
    },
  },
  {
    slug: "error-identification",
    ksNo: "7.3.1",
    serial: 28,
    principle: "understandable",
    name: { ko: "오류 정정", en: "Error identification & correction" },
    wcag: ["3.3.1", "3.3.3"],
    autoCoverage: "none",
    howToTest: {
      ko: "서식에 일부러 잘못된 값을 넣고 제출해, 오류가 난 항목과 원인을 텍스트로 알려 주고 정정 방법을 안내하는지 확인합니다. 필수 항목 비우기, 형식이 틀린 이메일·전화번호·날짜, 허용 범위를 벗어난 값을 차례로 넣어 보고, 오류 표시가 색이나 아이콘만이 아니라 문장으로 나오는지, 어떻게 고쳐야 하는지(예: 숫자 8자리) 제시하는지 봅니다. 스크린 리더로도 제출해 오류 사실이 안내되는지, 초점이 첫 오류 항목으로 옮겨 가거나 오류 목록에서 해당 항목으로 갈 수 있는지, 이미 입력한 다른 값이 지워지지 않고 남아 있는지 확인합니다. 어느 항목이 왜 틀렸는지 텍스트로 알 수 없으면 실패이며, 비밀번호처럼 보안상 구체적인 정정 방법을 밝힐 수 없는 경우는 예외입니다.",
      en: "Submit forms with deliberately invalid values and check that the field in error and the cause are identified in text, with guidance on how to fix it. Try leaving required fields empty, entering badly formatted email addresses, phone numbers, or dates, and entering out-of-range values, and confirm the error appears as text rather than only as color or an icon, with a correction suggestion (for example, \"8 digits\"). Submit with a screen reader too: the error should be announced, focus should move to the first invalid field or an error summary should link to it, and the other values already entered should not be cleared. It fails if you can't tell from text which field is wrong and why; it's an exception when giving a specific suggestion would compromise security, as with passwords.",
    },
  },
  {
    slug: "labels-for-inputs",
    ksNo: "7.3.2",
    serial: 29,
    principle: "understandable",
    name: { ko: "레이블 제공", en: "Labels for inputs" },
    wcag: ["3.3.2", "1.3.1"],
    autoCoverage: "partial",
    howToTest: {
      ko: "모든 입력 서식에 레이블이 연결되어 있는지는 자동 검사되지만, 레이블 내용이 입력 목적을 정확히 설명하는지, placeholder만으로 레이블을 대신하고 있지 않은지 확인하세요.",
      en: "Automated checks verify that every form input has a label connected, but confirm that the label text accurately describes the input's purpose and that a placeholder isn't standing in for the label.",
    },
  },
  {
    slug: "accessible-authentication",
    ksNo: "7.3.3",
    serial: 30,
    principle: "understandable",
    name: { ko: "접근 가능한 인증", en: "Accessible authentication" },
    wcag: ["3.3.8"],
    autoCoverage: "none",
    addedIn22: true,
    howToTest: {
      ko: "로그인·본인 확인 같은 인증 단계가 비밀번호 기억, 왜곡된 문자 옮겨 적기, 퍼즐·계산 같은 인지 기능 테스트를 대체 수단이나 도움 없이 요구하지 않는지 확인합니다. 아이디·비밀번호 입력란에 붙여넣기가 되는지, 브라우저·비밀번호 관리자의 자동 완성이 동작하는지(autocomplete=\"username\"·\"current-password\" 지정 여부 포함) 시험하고, 인증 코드를 여러 칸으로 나눠 받는다면 한 번에 붙여넣을 수 있는지 봅니다. 문자 CAPTCHA가 있다면 이메일 링크, 간편 인증, 패스키 같은 다른 인증 방법이 함께 제공되는지 확인합니다. 붙여넣기나 자동 완성을 막거나 대체 수단 없이 문자 해독을 요구하면 실패이며, 사진 속 사물 고르기나 사용자가 직접 올린 콘텐츠를 알아보는 방식은 WCAG 3.3.8에서 예외로 봅니다.",
      en: "Check that sign-in and identity verification steps don't require a cognitive function test, such as remembering a password, transcribing distorted characters, or solving a puzzle or calculation, without an alternative or assistance. Test whether you can paste into the username and password fields and whether browser and password manager autofill works (including whether autocomplete=\"username\" and \"current-password\" are set); if a verification code is split across several boxes, confirm it can be pasted in one go. If there is a text CAPTCHA, confirm another method such as an email link, a simplified authentication service, or a passkey is offered alongside it. Blocking paste or autofill, or requiring character transcription with no alternative, fails; recognizing objects in pictures or identifying content the user supplied is an exception under WCAG 3.3.8.",
    },
  },
  {
    slug: "redundant-entry",
    ksNo: "7.3.4",
    serial: 31,
    principle: "understandable",
    name: { ko: "반복 입력 정보", en: "Redundant entry" },
    wcag: ["3.3.7"],
    autoCoverage: "none",
    addedIn22: true,
    howToTest: {
      ko: "여러 단계로 이루어진 절차(회원가입, 주문 등)에서 같은 정보를 다시 입력하도록 요구하는지 확인하세요. 이전에 입력한 정보는 자동 입력되거나 선택 가능해야 합니다.",
      en: "In multi-step processes (sign-up, checkout, and so on), check whether users are asked to enter the same information again. Information entered earlier must be filled in automatically or available to select.",
    },
  },

  // ─── 원칙 4. 견고성 (Robust) ───
  {
    slug: "valid-markup",
    ksNo: "8.1.1",
    serial: 32,
    principle: "robust",
    name: { ko: "마크업 오류 방지", en: "Parsing / valid markup" },
    // 4.1.1(Parsing)은 WCAG 2.2에서 폐기 — 역사적 대응 표기 전용. 역매핑·파생 로직은
    // WCAG_BY_ID 필터로 자동 제외한다. 비우면 'KWCAG 고유 항목' 판별과 충돌하므로 유지.
    wcag: ["4.1.1"],
    autoCoverage: "full",
    howToTest: {
      ko: "자동 검사가 원본 HTML을 표준 파서로 재파싱해 닫는 태그 누락·잘못된 중첩·속성 중복·id 중복을 판정하고, 렌더링된 DOM에서 ARIA 참조 id 중복도 확인합니다. 한계: 파서가 조용히 복구하는 잘못된 중첩(예: p 안의 div)과 닫는 태그 생략이 허용되는 요소(li·td 등)의 오류는 검출되지 않으므로, 전체 문법 점검이 필요하면 W3C Nu HTML Checker(validator.w3.org/nu)를 병행하세요.",
      en: "Automated checks re-parse the source HTML with a standards parser to detect unclosed elements, mis-nesting, duplicate attributes, and duplicate ids, plus ARIA-referenced id duplicates in the rendered DOM. Limitation: nesting the parser recovers silently (e.g., div inside p) is not detected — use the W3C Nu HTML Checker for full syntax when needed.",
    },
  },
  {
    slug: "aria-accessibility",
    ksNo: "8.2.1",
    serial: 33,
    principle: "robust",
    name: { ko: "웹 애플리케이션 접근성 준수", en: "Accessible web applications (ARIA)" },
    wcag: ["4.1.2", "4.1.3"],
    autoCoverage: "partial",
    howToTest: {
      ko: "ARIA 속성 오용은 자동 검사되지만, 커스텀 위젯(탭, 아코디언, 모달 등)이 스크린 리더에서 역할·상태·값을 올바르게 안내하고 키보드 패턴(WAI-ARIA APG)대로 동작하는지는 보조기기로 직접 확인하세요.",
      en: "ARIA misuse is checked automatically, but verify directly with assistive technology that custom widgets (tabs, accordions, modals, and so on) announce their role, state, and value correctly in a screen reader and behave according to the WAI-ARIA APG keyboard patterns.",
    },
  },
];

/** KS X OT0003:2022 공식 번호 → 항목. 사람이 입력한 번호를 풀 때만 쓴다(저장값은 kwcagFromStored) */
export const KWCAG_BY_KSNO: ReadonlyMap<string, KwcagItem> = new Map(KWCAG_ITEMS.map((i) => [i.ksNo, i]));

export const KWCAG_PRINCIPLE_LABEL: Record<KwcagItem["principle"], { ko: string; en: string }> = {
  perceivable: { ko: "인식의 용이성", en: "Perceivable" },
  operable: { ko: "운용의 용이성", en: "Operable" },
  understandable: { ko: "이해의 용이성", en: "Understandable" },
  robust: { ko: "견고성", en: "Robust" },
};

/** 화면 표기의 번호 이름표 — 「검사항목 8」 */
export const KWCAG_NO_PREFIX = { ko: "검사항목", en: "Checkpoint" } as const;

/** 「검사항목 8」 / "Checkpoint 8" — 인증 심사 일련번호 표기 */
export function kwcagNoLabel(item: Pick<KwcagItem, "serial">, locale: string): string {
  return `${locale === "en" ? KWCAG_NO_PREFIX.en : KWCAG_NO_PREFIX.ko} ${item.serial}`;
}

/** 「검사항목 8 텍스트 콘텐츠의 명도 대비」 / "Checkpoint 8 Text contrast" */
export function kwcagLabel(item: Pick<KwcagItem, "serial" | "name">, locale: string): string {
  return `${kwcagNoLabel(item, locale)} ${pickLocale(item.name, locale)}`;
}

/** 여러 항목 — 「검사항목 8·29」 / "Checkpoints 8, 29". 빈 목록이면 빈 문자열 */
export function kwcagNoListLabel(items: readonly Pick<KwcagItem, "serial">[], locale: string): string {
  if (items.length === 0) return "";
  const serials = items.map((i) => i.serial);
  if (locale === "en") return `${serials.length > 1 ? "Checkpoints" : "Checkpoint"} ${serials.join(", ")}`;
  return `${KWCAG_NO_PREFIX.ko} ${serials.join("·")}`;
}
