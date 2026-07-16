/**
 * axe-core 규칙 카탈로그.
 *
 * 각 axe 규칙을 WCAG 2.2 성공기준과 KWCAG 2.2 검사항목에 매핑하고,
 * 한국어 제목·개선 가이드(코드 예시 포함)를 제공한다.
 * 오픈소스 기여를 가장 환영하는 영역 — 가이드 개선 PR을 환영합니다.
 *
 * 카탈로그에 없는 규칙이 검출되면 getRuleEntry()가 안전한 기본 항목을 생성한다.
 */
import type { RuleCatalogEntry } from "../types";

export const RULE_CATALOG: RuleCatalogEntry[] = [
  // ───────── 대체 텍스트 (WCAG 1.1.1 / KWCAG 5.1.1) ─────────
  {
    ruleId: "image-alt",
    wcag: ["1.1.1"],
    kwcag: ["5.1.1"],
    level: "A",
    title: { ko: "이미지에 대체 텍스트가 없습니다", en: "Images must have alternative text" },
    guide: {
      ko: "모든 `<img>` 요소에는 이미지의 의미를 전달하는 `alt` 속성이 필요합니다. 스크린 리더 사용자는 alt가 없으면 파일명을 듣거나 이미지의 존재조차 알 수 없습니다.\n\n```html\n<!-- 잘못된 예 -->\n<img src=\"chart.png\">\n\n<!-- 올바른 예: 의미 있는 이미지 -->\n<img src=\"chart.png\" alt=\"2026년 분기별 매출 그래프: 1분기 대비 4분기 32% 증가\">\n\n<!-- 올바른 예: 장식용 이미지는 빈 alt -->\n<img src=\"divider.png\" alt=\"\">\n```\n\n장식 목적의 이미지는 `alt=\"\"`(빈 값)로 지정해 스크린 리더가 건너뛰게 하세요. CSS background-image로 옮기는 것도 방법입니다.",
      en: "Every `<img>` needs an `alt` attribute conveying its meaning; use empty alt for decorative images.",
    },
  },
  {
    ruleId: "input-image-alt",
    wcag: ["1.1.1", "4.1.2"],
    kwcag: ["5.1.1"],
    level: "A",
    title: { ko: "이미지 버튼에 대체 텍스트가 없습니다", en: "Image buttons must have alternate text" },
    guide: {
      ko: "`<input type=\"image\">`는 버튼 기능을 하므로 그 기능을 설명하는 `alt`가 필수입니다.\n\n```html\n<input type=\"image\" src=\"search.png\" alt=\"검색\">\n```",
      en: "Provide alt text describing the button's function for `<input type=\"image\">`.",
    },
  },
  {
    ruleId: "area-alt",
    wcag: ["1.1.1", "2.4.4"],
    kwcag: ["5.1.1"],
    level: "A",
    title: { ko: "이미지 맵 영역에 대체 텍스트가 없습니다", en: "Image map areas must have alternate text" },
    guide: {
      ko: "이미지 맵의 각 `<area>`는 링크 역할을 하므로 목적지를 설명하는 `alt`가 필요합니다.\n\n```html\n<area shape=\"rect\" coords=\"...\" href=\"/seoul\" alt=\"서울 지역 안내\">\n```",
      en: "Each `<area>` acts as a link and needs alt text describing the destination.",
    },
  },
  {
    ruleId: "object-alt",
    wcag: ["1.1.1"],
    kwcag: ["5.1.1"],
    level: "A",
    title: { ko: "object 요소에 대체 콘텐츠가 없습니다", en: "Object elements must have alternate text" },
    guide: {
      ko: "`<object>` 안에 대체 텍스트를 넣거나 `aria-label`을 제공하세요.\n\n```html\n<object data=\"map.svg\" type=\"image/svg+xml\">회사 위치 약도: 지하철 2호선 강남역 3번 출구 도보 5분</object>\n```",
      en: "Provide fallback content inside `<object>` or an aria-label.",
    },
  },
  {
    ruleId: "svg-img-alt",
    wcag: ["1.1.1"],
    kwcag: ["5.1.1"],
    level: "A",
    title: { ko: "img 역할의 SVG에 접근 가능한 이름이 없습니다", en: "SVG images must have an accessible name" },
    guide: {
      ko: "`role=\"img\"`인 SVG에는 `<title>` 요소나 `aria-label`로 이름을 제공하세요.\n\n```html\n<svg role=\"img\" aria-label=\"별점 5점 만점에 4점\">…</svg>\n```",
      en: "Give SVGs with role img an accessible name via <title> or aria-label.",
    },
  },
  {
    ruleId: "role-img-alt",
    wcag: ["1.1.1"],
    kwcag: ["5.1.1"],
    level: "A",
    title: { ko: "role=img 요소에 대체 텍스트가 없습니다", en: "Elements with role img must have alternate text" },
    guide: {
      ko: "`role=\"img\"`를 지정한 요소에는 `aria-label` 또는 `aria-labelledby`로 이미지의 의미를 제공해야 합니다.",
      en: "Elements with role img need aria-label or aria-labelledby.",
    },
  },
  {
    ruleId: "image-redundant-alt",
    wcag: [],
    kwcag: ["5.1.1"],
    level: "BP",
    title: { ko: "이미지 대체 텍스트가 주변 텍스트와 중복됩니다", en: "Alt text duplicates nearby text" },
    guide: {
      ko: "이미지 바로 옆에 같은 텍스트가 있으면 스크린 리더가 같은 내용을 두 번 읽습니다. 이 경우 이미지는 `alt=\"\"`로 처리하세요.",
      en: "If adjacent text repeats the alt, use empty alt to avoid double announcement.",
    },
  },
  {
    ruleId: "server-side-image-map",
    wcag: ["2.1.1"],
    kwcag: ["5.1.1", "6.1.1"],
    level: "A",
    title: { ko: "서버 사이드 이미지 맵을 사용하고 있습니다", en: "Server-side image maps are not accessible" },
    guide: {
      ko: "`<img ismap>` 서버 사이드 이미지 맵은 키보드로 사용할 수 없습니다. 클라이언트 사이드 이미지 맵(`<map>`+`<area>`)이나 일반 링크 목록으로 대체하세요.",
      en: "Replace server-side image maps with client-side maps or plain links.",
    },
  },

  // ───────── 멀티미디어 (KWCAG 5.2.1) ─────────
  {
    ruleId: "video-caption",
    wcag: ["1.2.2"],
    kwcag: ["5.2.1"],
    level: "A",
    title: { ko: "동영상에 자막이 없습니다", en: "Video elements must have captions" },
    guide: {
      ko: "`<video>`에는 `<track kind=\"captions\">`로 자막을 제공해야 합니다.\n\n```html\n<video controls>\n  <source src=\"lecture.mp4\" type=\"video/mp4\">\n  <track kind=\"captions\" src=\"lecture-ko.vtt\" srclang=\"ko\" label=\"한국어\">\n</video>\n```\n\n자막 파일(WebVTT)이 없다면 대본(원고)이라도 페이지에 함께 제공하세요.",
      en: "Provide captions via a track element, or at minimum a transcript.",
    },
  },
  {
    ruleId: "audio-caption",
    wcag: ["1.2.1"],
    kwcag: ["5.2.1"],
    level: "A",
    title: { ko: "오디오에 자막·대본이 없습니다", en: "Audio elements must have captions or transcript" },
    guide: {
      ko: "`<audio>` 콘텐츠에는 대본(transcript) 또는 자막 트랙을 제공해야 청각장애 사용자가 내용을 알 수 있습니다.",
      en: "Provide a transcript or caption track for audio content.",
    },
  },
  {
    ruleId: "no-autoplay-audio",
    wcag: ["1.4.2"],
    kwcag: ["5.4.2"],
    level: "A",
    title: { ko: "소리가 3초 이상 자동 재생됩니다", en: "Audio must not autoplay for more than 3 seconds" },
    guide: {
      ko: "자동 재생되는 소리는 스크린 리더 음성과 겹쳐 페이지 이용을 방해합니다. `autoplay`를 제거하거나, 불가피하면 3초 이내로 제한하고 콘텐츠 최상단에 정지/음소거 버튼을 제공하세요.\n\n```html\n<!-- 권장: 자동 재생 제거 -->\n<video controls muted>…</video>\n```",
      en: "Remove autoplay, or keep under 3 seconds and provide a mute/stop control first in the page.",
    },
  },

  // ───────── 색·대비 (KWCAG 5.3.1, 5.4.1) ─────────
  {
    ruleId: "color-contrast",
    wcag: ["1.4.3"],
    kwcag: ["5.4.1"],
    level: "AA",
    title: { ko: "텍스트와 배경의 명도 대비가 부족합니다", en: "Text must have sufficient color contrast" },
    guide: {
      ko: "일반 텍스트는 배경과 **4.5:1** 이상, 큰 텍스트(24px 이상 또는 굵은 18.7px 이상)는 **3:1** 이상의 명도 대비가 필요합니다. 저시력 사용자와 밝은 야외 환경의 사용자가 텍스트를 읽을 수 있게 합니다.\n\n```css\n/* 잘못된 예: 흰 배경에 연회색 텍스트 (2.3:1) */\ncolor: #aaaaaa; background: #ffffff;\n\n/* 올바른 예 (7.0:1) */\ncolor: #595959; background: #ffffff;\n```\n\n브랜드 색을 유지해야 한다면 텍스트 크기를 키우거나 배경을 어둡게/밝게 조정하세요.",
      en: "Normal text needs 4.5:1 contrast against its background; large text needs 3:1.",
    },
  },
  {
    ruleId: "color-contrast-enhanced",
    wcag: ["1.4.6"],
    kwcag: ["5.4.1"],
    level: "BP",
    title: { ko: "향상된 명도 대비(AAA) 기준에 미달합니다", en: "Text does not meet enhanced (AAA) contrast" },
    guide: {
      ko: "AAA 수준(7:1)은 필수 기준은 아니지만, 본문 텍스트가 이 수준을 충족하면 더 많은 저시력 사용자가 편하게 읽을 수 있습니다.",
      en: "AAA (7:1) is not required but improves readability for low-vision users.",
    },
  },
  {
    ruleId: "link-in-text-block",
    wcag: ["1.4.1"],
    kwcag: ["5.3.1"],
    level: "A",
    title: { ko: "본문 속 링크가 색으로만 구분됩니다", en: "Links must be distinguishable without relying on color" },
    guide: {
      ko: "본문 안의 링크가 색상 차이로만 구분되면 색각 이상 사용자가 링크를 인지할 수 없습니다. 밑줄을 유지하거나, 색상 대비 3:1 이상 + 호버/포커스 시 밑줄 등 추가 단서를 제공하세요.\n\n```css\np a { text-decoration: underline; }\n```",
      en: "Keep underlines on in-text links or add non-color cues.",
    },
  },

  // ───────── 표·구조 (KWCAG 7.3.1, 7.3.2) ─────────
  {
    ruleId: "th-has-data-cells",
    wcag: ["1.3.1"],
    kwcag: ["7.3.2"],
    level: "A",
    title: { ko: "제목 셀(th)에 연결된 데이터 셀이 없습니다", en: "Table headers must refer to data cells" },
    guide: {
      ko: "`<th>`가 실제 데이터 셀과 연결되지 않으면 스크린 리더가 표를 잘못 안내합니다. 표 구조를 점검하고 불필요한 th를 제거하거나 데이터를 채우세요.",
      en: "Ensure each th actually describes data cells in the table.",
    },
  },
  {
    ruleId: "td-headers-attr",
    wcag: ["1.3.1"],
    kwcag: ["7.3.2"],
    level: "A",
    title: { ko: "td의 headers 속성이 잘못된 셀을 참조합니다", en: "td headers attribute must reference cells in the same table" },
    guide: {
      ko: "`headers` 속성은 같은 표 안에 있는 `<th>`의 id만 참조해야 합니다. 복잡한 표는 `scope` 속성 사용이 더 단순하고 안전합니다.\n\n```html\n<th scope=\"col\">이름</th>\n<th scope=\"row\">1분기</th>\n```",
      en: "headers must reference th ids within the same table; prefer scope for simpler tables.",
    },
  },
  {
    ruleId: "scope-attr-valid",
    wcag: ["1.3.1"],
    kwcag: ["7.3.2"],
    level: "BP",
    title: { ko: "scope 속성 값이 올바르지 않습니다", en: "scope attribute must be used correctly" },
    guide: {
      ko: "`scope`는 `<th>`에서만 `col | row | colgroup | rowgroup` 값으로 사용해야 합니다.",
      en: "Use scope only on th with col/row/colgroup/rowgroup values.",
    },
  },
  {
    ruleId: "empty-table-header",
    wcag: ["1.3.1"],
    kwcag: ["7.3.2"],
    level: "BP",
    title: { ko: "표의 제목 셀이 비어 있습니다", en: "Table header cells should not be empty" },
    guide: {
      ko: "빈 `<th>`는 스크린 리더 사용자가 열/행의 의미를 알 수 없게 합니다. 제목 텍스트를 채우거나 제목이 필요 없으면 `<td>`로 바꾸세요.",
      en: "Fill header text or change empty th to td.",
    },
  },
  {
    ruleId: "table-duplicate-name",
    wcag: [],
    kwcag: ["7.3.2"],
    level: "BP",
    title: { ko: "표의 caption과 summary가 중복됩니다", en: "Table caption and summary should differ" },
    guide: {
      ko: "caption(표 제목)과 summary(구조 요약)에 같은 내용이 들어가면 중복 안내됩니다. 서로 다른 정보를 담거나 summary를 제거하세요.",
      en: "Caption and summary should not duplicate each other.",
    },
  },
  {
    ruleId: "list",
    wcag: ["1.3.1"],
    kwcag: ["7.3.1"],
    level: "A",
    title: { ko: "목록(ul/ol) 안에 잘못된 요소가 있습니다", en: "Lists must only contain li elements" },
    guide: {
      ko: "`<ul>`/`<ol>`의 직계 자식은 `<li>`(및 script/template)만 허용됩니다. 다른 요소가 있으면 스크린 리더의 목록 탐색(항목 수 안내 등)이 깨집니다.\n\n```html\n<!-- 잘못된 예 -->\n<ul><div class=\"item\">…</div></ul>\n<!-- 올바른 예 -->\n<ul><li class=\"item\">…</li></ul>\n```",
      en: "Direct children of ul/ol must be li elements.",
    },
  },
  {
    ruleId: "listitem",
    wcag: ["1.3.1"],
    kwcag: ["7.3.1"],
    level: "A",
    title: { ko: "li가 목록 요소 밖에 있습니다", en: "li must be contained in ul or ol" },
    guide: {
      ko: "`<li>`는 반드시 `<ul>`, `<ol>` 또는 `role=\"list\"` 요소의 자식이어야 합니다.",
      en: "li elements must be children of ul, ol, or role=list.",
    },
  },
  {
    ruleId: "definition-list",
    wcag: ["1.3.1"],
    kwcag: ["7.3.1"],
    level: "A",
    title: { ko: "정의 목록(dl)의 구조가 올바르지 않습니다", en: "dl must be structured correctly" },
    guide: {
      ko: "`<dl>`은 `<dt>`(용어)와 `<dd>`(설명)의 짝으로만 구성해야 합니다.",
      en: "dl must contain properly ordered dt/dd pairs.",
    },
  },
  {
    ruleId: "dlitem",
    wcag: ["1.3.1"],
    kwcag: ["7.3.1"],
    level: "A",
    title: { ko: "dt/dd가 dl 밖에 있습니다", en: "dt and dd must be inside a dl" },
    guide: {
      ko: "`<dt>`와 `<dd>`는 반드시 `<dl>` 안에서 사용하세요.",
      en: "dt and dd must be contained in a dl.",
    },
  },
  {
    ruleId: "p-as-heading",
    wcag: ["1.3.1"],
    kwcag: ["7.3.1", "6.4.2"],
    level: "A",
    title: { ko: "굵은 p 요소를 제목처럼 사용하고 있습니다", en: "Styled p elements must not be used as headings" },
    guide: {
      ko: "볼드·큰 글씨 `<p>`는 시각적으로만 제목입니다. 스크린 리더 사용자가 제목 단위로 탐색할 수 있도록 `<h2>`~`<h6>` 요소를 사용하세요.\n\n```html\n<!-- 잘못된 예 -->\n<p style=\"font-weight:bold;font-size:20px\">서비스 안내</p>\n<!-- 올바른 예 -->\n<h2>서비스 안내</h2>\n```",
      en: "Use real heading elements instead of styled paragraphs.",
    },
  },

  // ───────── 키보드·초점 (KWCAG 6.1.x) ─────────
  {
    ruleId: "scrollable-region-focusable",
    wcag: ["2.1.1"],
    kwcag: ["6.1.1"],
    level: "A",
    title: { ko: "스크롤 영역에 키보드로 접근할 수 없습니다", en: "Scrollable regions must be keyboard accessible" },
    guide: {
      ko: "내부 스크롤이 있는 영역은 키보드 사용자가 스크롤할 수 있어야 합니다. 영역에 `tabindex=\"0\"`과 적절한 role, 접근 가능한 이름을 부여하세요.\n\n```html\n<div class=\"code-block\" tabindex=\"0\" role=\"region\" aria-label=\"코드 예시\">…</div>\n```",
      en: "Give scrollable containers tabindex 0 and an accessible name.",
    },
  },
  {
    ruleId: "frame-focusable-content",
    wcag: ["2.1.1"],
    kwcag: ["6.1.1"],
    level: "A",
    title: { ko: "tabindex=-1인 프레임 안에 초점 가능한 콘텐츠가 있습니다", en: "Frames with focusable content must not have tabindex=-1" },
    guide: {
      ko: "`tabindex=\"-1\"`이 지정된 `<iframe>` 내부의 링크·버튼에는 키보드로 도달할 수 없습니다. tabindex를 제거하세요.",
      en: "Remove tabindex=-1 from frames containing focusable content.",
    },
  },
  {
    ruleId: "nested-interactive",
    wcag: ["4.1.2"],
    kwcag: ["6.1.1", "8.2.1"],
    level: "A",
    title: { ko: "인터랙티브 요소가 중첩되어 있습니다", en: "Interactive controls must not be nested" },
    guide: {
      ko: "버튼 안의 링크처럼 조작 요소가 중첩되면 스크린 리더와 키보드 동작이 예측 불가능해집니다. 하나의 요소로 합치거나 형제 요소로 분리하세요.\n\n```html\n<!-- 잘못된 예 -->\n<button><a href=\"/detail\">자세히</a></button>\n<!-- 올바른 예 -->\n<a class=\"button-style\" href=\"/detail\">자세히</a>\n```",
      en: "Do not nest interactive elements; merge or separate them.",
    },
  },
  {
    ruleId: "tabindex",
    wcag: ["2.4.3"],
    kwcag: ["6.1.2"],
    level: "BP",
    title: { ko: "tabindex에 양수 값을 사용하고 있습니다", en: "Avoid positive tabindex values" },
    guide: {
      ko: "`tabindex=\"1\"` 이상 값은 초점 순서를 마크업 순서와 다르게 만들어 유지보수와 예측을 어렵게 합니다. `0`(초점 가능) 또는 `-1`(스크립트 초점용)만 사용하고, 순서는 DOM 순서로 제어하세요.",
      en: "Use only tabindex 0 or -1; control order via DOM order.",
    },
  },
  {
    ruleId: "accesskeys",
    wcag: ["2.1.4"],
    kwcag: ["6.1.4"],
    level: "BP",
    title: { ko: "accesskey 값이 중복되었습니다", en: "accesskey values must be unique" },
    guide: {
      ko: "중복된 `accesskey`는 어떤 요소가 실행될지 예측할 수 없게 합니다. 값을 고유하게 하거나, 보조기기 단축키와 충돌하기 쉬우므로 accesskey 자체를 제거하는 것을 권장합니다.",
      en: "Make accesskey values unique, or better, remove them.",
    },
  },

  // ───────── 시간제한·움직임 (KWCAG 6.2.x, 6.3.1) ─────────
  {
    ruleId: "meta-refresh",
    wcag: ["2.2.1"],
    kwcag: ["6.2.1"],
    level: "A",
    title: { ko: "meta refresh로 페이지가 자동 새로고침/이동됩니다", en: "Timed refresh must not exist" },
    guide: {
      ko: "`<meta http-equiv=\"refresh\">`는 사용자가 읽는 도중 페이지를 강제로 바꿉니다. 서버 리다이렉트(301/302)를 사용하거나, 새로고침이 꼭 필요하면 사용자가 제어할 수 있는 버튼으로 제공하세요.",
      en: "Use server-side redirects instead of meta refresh.",
    },
  },
  {
    ruleId: "blink",
    wcag: ["2.2.2"],
    kwcag: ["6.2.2", "6.3.1"],
    level: "A",
    title: { ko: "blink 요소를 사용하고 있습니다", en: "blink elements are not allowed" },
    guide: {
      ko: "`<blink>`는 폐기된 요소이며 깜빡임은 주의력 결핍·광과민성 사용자에게 심각한 방해가 됩니다. 제거하세요.",
      en: "Remove blink elements entirely.",
    },
  },
  {
    ruleId: "marquee",
    wcag: ["2.2.2"],
    kwcag: ["6.2.2"],
    level: "A",
    title: { ko: "marquee 요소를 사용하고 있습니다", en: "marquee elements are not allowed" },
    guide: {
      ko: "`<marquee>`는 폐기된 요소이며 흐르는 텍스트는 정지할 수 없어 저시력·인지 장애 사용자가 읽을 수 없습니다. 정적 텍스트나 정지 버튼이 있는 CSS 애니메이션으로 대체하세요.",
      en: "Replace marquee with static text or pausable animation.",
    },
  },

  // ───────── 탐색·제목·링크 (KWCAG 6.4.x) ─────────
  {
    ruleId: "bypass",
    wcag: ["2.4.1"],
    kwcag: ["6.4.1"],
    level: "A",
    title: { ko: "반복 영역을 건너뛸 수단이 없습니다", en: "Page must have a means to bypass repeated blocks" },
    guide: {
      ko: "키보드·스크린 리더 사용자가 모든 페이지에서 GNB 메뉴를 다 지나야 본문에 도달하지 않도록, 첫 번째 초점으로 '본문 바로가기' 링크를 제공하세요.\n\n```html\n<body>\n  <a href=\"#main\" class=\"skip-link\">본문 바로가기</a>\n  …\n  <main id=\"main\" tabindex=\"-1\">…</main>\n</body>\n```\n\n```css\n.skip-link { position: absolute; left: -9999px; }\n.skip-link:focus { left: 8px; top: 8px; }\n```",
      en: "Provide a skip link as the first focusable element, or landmarks/headings.",
    },
  },
  {
    ruleId: "skip-link",
    wcag: ["2.4.1"],
    kwcag: ["6.4.1"],
    level: "BP",
    title: { ko: "건너뛰기 링크의 대상이 존재하지 않습니다", en: "Skip link target must exist and be focusable" },
    guide: {
      ko: "건너뛰기 링크의 href가 가리키는 id가 실제로 존재하고 초점을 받을 수 있어야 합니다. 대상 요소에 `tabindex=\"-1\"`을 추가하면 안전합니다.",
      en: "Ensure the skip link target exists and can receive focus.",
    },
  },
  {
    ruleId: "document-title",
    wcag: ["2.4.2"],
    kwcag: ["6.4.2"],
    level: "A",
    title: { ko: "문서에 title이 없습니다", en: "Documents must have a title" },
    guide: {
      ko: "`<title>`은 스크린 리더가 페이지 진입 시 가장 먼저 읽는 정보이며 탭 전환·북마크에서 페이지를 식별하는 수단입니다. 페이지 내용을 구체적으로 설명하는 고유한 제목을 제공하세요.\n\n```html\n<title>검사 결과 보고서 - A11Y Check</title>\n```",
      en: "Provide a descriptive, unique document title.",
    },
  },
  {
    ruleId: "frame-title",
    wcag: ["4.1.2"],
    kwcag: ["6.4.2"],
    level: "A",
    title: { ko: "iframe에 title이 없습니다", en: "Frames must have a title attribute" },
    guide: {
      ko: "스크린 리더는 title 없는 iframe을 \"프레임\"이라고만 읽어 내용물을 알 수 없습니다.\n\n```html\n<iframe src=\"map.html\" title=\"오시는 길 지도\"></iframe>\n```",
      en: "Give every iframe a descriptive title attribute.",
    },
  },
  {
    ruleId: "frame-title-unique",
    wcag: ["4.1.2"],
    kwcag: ["6.4.2"],
    level: "BP",
    title: { ko: "iframe title이 중복됩니다", en: "Frame titles should be unique" },
    guide: {
      ko: "한 페이지에 같은 title의 iframe이 여러 개면 구별할 수 없습니다. 각 프레임의 내용을 반영한 고유한 title을 지정하세요.",
      en: "Make each frame title unique and descriptive.",
    },
  },
  {
    ruleId: "link-name",
    wcag: ["2.4.4", "4.1.2"],
    kwcag: ["6.4.3"],
    level: "A",
    title: { ko: "링크에 인식 가능한 텍스트가 없습니다", en: "Links must have discernible text" },
    guide: {
      ko: "아이콘만 있는 링크, 빈 링크는 스크린 리더가 \"링크\"라고만 읽습니다. 텍스트를 넣거나 `aria-label`을 제공하세요.\n\n```html\n<!-- 잘못된 예 -->\n<a href=\"/cart\"><svg>…</svg></a>\n<!-- 올바른 예 -->\n<a href=\"/cart\" aria-label=\"장바구니\"><svg aria-hidden=\"true\">…</svg></a>\n```",
      en: "Icon-only or empty links need text or aria-label.",
    },
  },
  {
    ruleId: "identical-links-same-purpose",
    wcag: [],
    kwcag: ["6.4.3"],
    level: "BP",
    title: { ko: "같은 이름의 링크가 서로 다른 곳으로 이동합니다", en: "Identical link names should serve the same purpose" },
    guide: {
      ko: "같은 텍스트(예: \"자세히 보기\")의 링크가 서로 다른 목적지를 가지면 스크린 리더의 링크 목록에서 구별할 수 없습니다. 각 링크에 대상이 드러나는 텍스트 또는 aria-label을 부여하세요 (예: \"공지사항 자세히 보기\").",
      en: "Links with the same accessible name should go to the same destination; otherwise differentiate names.",
    },
  },
  {
    ruleId: "heading-order",
    wcag: [],
    kwcag: ["6.4.2", "7.3.1"],
    level: "BP",
    title: { ko: "제목 레벨이 건너뛰어졌습니다", en: "Heading levels should only increase by one" },
    guide: {
      ko: "h1 다음에 h3가 오는 식으로 레벨을 건너뛰면 스크린 리더 사용자가 문서 구조를 파악하기 어렵습니다. 제목은 계층 순서대로(h1→h2→h3) 사용하고, 크기는 CSS로 조정하세요.",
      en: "Do not skip heading levels; style size with CSS instead.",
    },
  },
  {
    ruleId: "empty-heading",
    wcag: ["1.3.1"],
    kwcag: ["6.4.2"],
    level: "BP",
    title: { ko: "제목 요소가 비어 있습니다", en: "Headings should not be empty" },
    guide: {
      ko: "빈 제목은 스크린 리더의 제목 탐색을 방해합니다. 텍스트를 채우거나 요소를 제거하세요.",
      en: "Fill in heading text or remove the element.",
    },
  },
  {
    ruleId: "page-has-heading-one",
    wcag: [],
    kwcag: ["6.4.2"],
    level: "BP",
    title: { ko: "페이지에 h1 제목이 없습니다", en: "Page should contain a level-one heading" },
    guide: {
      ko: "h1은 페이지의 주제를 알려주는 최상위 제목입니다. 페이지마다 내용을 대표하는 h1을 하나 제공하세요.",
      en: "Provide one h1 that represents the page's main topic.",
    },
  },

  // ───────── 포인터·레이블과 네임 (KWCAG 6.5.x) ─────────
  {
    ruleId: "target-size",
    wcag: ["2.5.8"],
    kwcag: ["6.1.3"],
    level: "AA",
    title: { ko: "터치·클릭 대상 크기가 너무 작습니다", en: "Touch targets must have sufficient size" },
    guide: {
      ko: "조작 요소는 최소 **24×24 CSS px** 크기이거나 인접 요소와 충분한 간격이 있어야 합니다. 손떨림이 있는 사용자, 모바일 사용자가 잘못 누르는 것을 방지합니다.\n\n```css\n.icon-button { min-width: 24px; min-height: 24px; padding: 8px; }\n```",
      en: "Interactive targets need at least 24×24 CSS px or adequate spacing.",
    },
  },
  {
    ruleId: "label-content-name-mismatch",
    wcag: ["2.5.3"],
    kwcag: ["6.5.3"],
    level: "A",
    title: { ko: "화면에 보이는 레이블이 접근 가능한 이름에 포함되지 않습니다", en: "Visible label must be part of the accessible name" },
    guide: {
      ko: "버튼에 \"검색\"이 보이는데 `aria-label=\"찾기\"`로 지정하면 음성 인식 사용자가 \"검색 클릭\"이라고 말해도 동작하지 않습니다. 접근 가능한 이름이 보이는 텍스트로 시작하도록 맞추세요.\n\n```html\n<!-- 잘못된 예 -->\n<button aria-label=\"찾기\">검색</button>\n<!-- 올바른 예 -->\n<button aria-label=\"검색 (전체 게시글 대상)\">검색</button>\n```",
      en: "Ensure the accessible name contains the visible label text.",
    },
  },

  // ───────── 언어 (KWCAG 7.1.1) ─────────
  {
    ruleId: "html-has-lang",
    wcag: ["3.1.1"],
    kwcag: ["7.1.1"],
    level: "A",
    title: { ko: "html 요소에 lang 속성이 없습니다", en: "html element must have a lang attribute" },
    guide: {
      ko: "`lang`이 없으면 스크린 리더가 어떤 언어 엔진으로 읽을지 알 수 없어 한국어를 영어 발음으로 읽는 등의 문제가 생깁니다.\n\n```html\n<html lang=\"ko\">\n```",
      en: "Declare the page language on the html element.",
    },
  },
  {
    ruleId: "html-lang-valid",
    wcag: ["3.1.1"],
    kwcag: ["7.1.1"],
    level: "A",
    title: { ko: "html lang 속성 값이 올바르지 않습니다", en: "html lang attribute must be valid" },
    guide: {
      ko: "`lang` 값은 유효한 BCP 47 언어 코드여야 합니다 (한국어: `ko`, 영어: `en`).",
      en: "Use a valid BCP 47 language code (e.g., ko, en).",
    },
  },
  {
    ruleId: "html-xml-lang-mismatch",
    wcag: ["3.1.1"],
    kwcag: ["7.1.1"],
    level: "A",
    title: { ko: "lang과 xml:lang 값이 서로 다릅니다", en: "lang and xml:lang must match" },
    guide: {
      ko: "두 속성이 다른 언어를 가리키면 보조기기 동작이 갈립니다. 같은 값으로 통일하세요.",
      en: "Make lang and xml:lang identical.",
    },
  },
  {
    ruleId: "valid-lang",
    wcag: ["3.1.2"],
    kwcag: ["7.1.1"],
    level: "AA",
    title: { ko: "부분 콘텐츠의 lang 값이 올바르지 않습니다", en: "lang attribute values must be valid" },
    guide: {
      ko: "본문 중 외국어 구간에 지정한 `lang` 값이 유효한 언어 코드인지 확인하세요.\n\n```html\n<p>이 기능은 <span lang=\"en\">Progressive Enhancement</span> 방식입니다.</p>\n```",
      en: "Ensure lang values on inline elements are valid codes.",
    },
  },

  // ───────── 서식·레이블 (KWCAG 7.4.1) ─────────
  {
    ruleId: "label",
    wcag: ["4.1.2"],
    kwcag: ["7.4.1"],
    level: "A",
    title: { ko: "입력 서식에 레이블이 없습니다", en: "Form elements must have labels" },
    guide: {
      ko: "레이블 없는 입력 필드는 스크린 리더가 \"편집창\"이라고만 읽어 무엇을 입력해야 할지 알 수 없습니다.\n\n```html\n<!-- 권장: label 요소 연결 -->\n<label for=\"email\">이메일</label>\n<input id=\"email\" type=\"email\" autocomplete=\"email\">\n\n<!-- 시각적 레이블을 둘 수 없는 경우 -->\n<input type=\"search\" aria-label=\"사이트 검색\">\n```\n\n`placeholder`는 입력을 시작하면 사라지므로 레이블 대용이 될 수 없습니다.",
      en: "Associate a label element (or aria-label) with every input; placeholder is not a label.",
    },
  },
  {
    ruleId: "select-name",
    wcag: ["4.1.2"],
    kwcag: ["7.4.1"],
    level: "A",
    title: { ko: "select 요소에 접근 가능한 이름이 없습니다", en: "Select elements must have an accessible name" },
    guide: {
      ko: "`<select>`에도 `<label>` 또는 `aria-label`로 이름을 제공해야 합니다.",
      en: "Provide a label or aria-label for select elements.",
    },
  },
  {
    ruleId: "label-title-only",
    wcag: [],
    kwcag: ["7.4.1"],
    level: "BP",
    title: { ko: "title 속성만으로 레이블을 제공하고 있습니다", en: "Form elements should have a visible label" },
    guide: {
      ko: "`title` 속성은 마우스 오버 시에만 보이고 일부 보조기기는 읽지 않습니다. 눈에 보이는 `<label>`을 제공하세요.",
      en: "Provide a visible label instead of relying on the title attribute.",
    },
  },
  {
    ruleId: "form-field-multiple-labels",
    wcag: ["3.3.2"],
    kwcag: ["7.4.1"],
    level: "BP",
    title: { ko: "하나의 입력에 여러 label이 연결되었습니다", en: "Form fields should not have multiple labels" },
    guide: {
      ko: "여러 label이 연결되면 보조기기마다 읽는 내용이 달라집니다. label은 하나만 연결하고 부가 설명은 `aria-describedby`로 제공하세요.",
      en: "Use one label per field; add descriptions via aria-describedby.",
    },
  },
  {
    ruleId: "autocomplete-valid",
    wcag: ["1.3.5"],
    kwcag: ["7.4.4"],
    level: "AA",
    title: { ko: "autocomplete 속성 값이 올바르지 않습니다", en: "autocomplete attribute must be valid" },
    guide: {
      ko: "사용자 정보를 수집하는 입력에는 표준 `autocomplete` 값을 지정해 브라우저·보조기기가 자동 입력을 도울 수 있게 하세요. 반복 입력 부담을 줄여줍니다.\n\n```html\n<input type=\"text\" name=\"name\" autocomplete=\"name\">\n<input type=\"tel\" name=\"phone\" autocomplete=\"tel\">\n```",
      en: "Use valid autocomplete tokens so browsers can autofill user data.",
    },
  },

  // ───────── 버튼·컨트롤 이름 (KWCAG 7.4.1 / 8.2.1) ─────────
  {
    ruleId: "button-name",
    wcag: ["4.1.2"],
    kwcag: ["7.4.1", "6.5.3"],
    level: "A",
    title: { ko: "버튼에 인식 가능한 텍스트가 없습니다", en: "Buttons must have discernible text" },
    guide: {
      ko: "아이콘만 있는 버튼은 스크린 리더가 \"버튼\"이라고만 읽습니다.\n\n```html\n<!-- 잘못된 예 -->\n<button><svg>…</svg></button>\n<!-- 올바른 예 -->\n<button aria-label=\"메뉴 열기\"><svg aria-hidden=\"true\">…</svg></button>\n```",
      en: "Icon-only buttons need aria-label or visually hidden text.",
    },
  },
  {
    ruleId: "input-button-name",
    wcag: ["4.1.2"],
    kwcag: ["7.4.1"],
    level: "A",
    title: { ko: "input 버튼에 텍스트가 없습니다", en: "Input buttons must have discernible text" },
    guide: {
      ko: "`<input type=\"button|submit|reset\">`에는 `value` 속성으로 버튼 이름을 제공하세요.\n\n```html\n<input type=\"submit\" value=\"신청하기\">\n```",
      en: "Provide a value attribute for input buttons.",
    },
  },
  {
    ruleId: "summary-name",
    wcag: ["4.1.2"],
    kwcag: ["7.4.1"],
    level: "A",
    title: { ko: "summary 요소에 접근 가능한 이름이 없습니다", en: "summary elements must have an accessible name" },
    guide: {
      ko: "접기/펼치기(`<details>`)의 `<summary>`에 무엇이 펼쳐지는지 알 수 있는 텍스트를 제공하세요.",
      en: "Give summary elements descriptive text.",
    },
  },

  // ───────── 마크업 유효성 (KWCAG 8.1.1) ─────────
  {
    ruleId: "duplicate-id-active",
    wcag: ["4.1.1"],
    kwcag: ["8.1.1"],
    level: "A",
    title: { ko: "조작 가능한 요소의 id가 중복됩니다", en: "IDs of active elements must be unique" },
    guide: {
      ko: "id가 중복되면 label 연결, aria 참조, 스크립트가 잘못된 요소를 가리킵니다. 모든 id를 고유하게 만드세요.",
      en: "Ensure every id in the document is unique.",
    },
  },
  {
    ruleId: "duplicate-id-aria",
    wcag: ["4.1.1"],
    kwcag: ["8.1.1"],
    level: "A",
    title: { ko: "ARIA가 참조하는 id가 중복됩니다", en: "IDs used in ARIA must be unique" },
    guide: {
      ko: "`aria-labelledby` 등이 참조하는 id가 중복되면 보조기기가 어떤 요소를 읽을지 보장되지 않습니다. id를 고유하게 만드세요.",
      en: "IDs referenced by ARIA attributes must be unique.",
    },
  },

  // ───────── ARIA (KWCAG 8.2.1) ─────────
  {
    ruleId: "aria-allowed-attr",
    wcag: ["4.1.2"],
    kwcag: ["8.2.1"],
    level: "A",
    title: { ko: "해당 role에 허용되지 않는 ARIA 속성이 있습니다", en: "ARIA attributes must be allowed for the element's role" },
    guide: {
      ko: "요소의 role이 지원하지 않는 aria-* 속성은 무시되거나 오동작합니다. WAI-ARIA 명세에서 해당 role이 지원하는 속성인지 확인하고 제거·수정하세요.",
      en: "Remove ARIA attributes not supported by the element's role.",
    },
  },
  {
    ruleId: "aria-required-attr",
    wcag: ["4.1.2"],
    kwcag: ["8.2.1"],
    level: "A",
    title: { ko: "role에 필수인 ARIA 속성이 누락되었습니다", en: "Required ARIA attributes must be provided" },
    guide: {
      ko: "예: `role=\"checkbox\"`에는 `aria-checked`가 필수입니다. 해당 role의 필수 속성을 추가하세요.\n\n```html\n<div role=\"checkbox\" aria-checked=\"false\" tabindex=\"0\">약관 동의</div>\n```",
      en: "Add the ARIA attributes required by the role (e.g., aria-checked for checkbox).",
    },
  },
  {
    ruleId: "aria-required-children",
    wcag: ["1.3.1"],
    kwcag: ["8.2.1"],
    level: "A",
    title: { ko: "role에 필수인 자식 요소가 없습니다", en: "Certain ARIA roles must contain particular children" },
    guide: {
      ko: "예: `role=\"list\"`는 `role=\"listitem\"` 자식이, `role=\"tablist\"`는 `role=\"tab\"` 자식이 필요합니다. 구조를 명세대로 맞추세요.",
      en: "Provide the child roles the parent role requires (e.g., tablist → tab).",
    },
  },
  {
    ruleId: "aria-required-parent",
    wcag: ["1.3.1"],
    kwcag: ["8.2.1"],
    level: "A",
    title: { ko: "role에 필수인 부모 요소가 없습니다", en: "Certain ARIA roles must be contained by particular parents" },
    guide: {
      ko: "예: `role=\"tab\"`은 `role=\"tablist\"` 안에, `role=\"option\"`은 `role=\"listbox\"` 안에 있어야 합니다.",
      en: "Place the role inside its required parent role.",
    },
  },
  {
    ruleId: "aria-roles",
    wcag: ["4.1.2"],
    kwcag: ["8.2.1"],
    level: "A",
    title: { ko: "존재하지 않는 role 값을 사용하고 있습니다", en: "ARIA roles must be valid" },
    guide: {
      ko: "오타이거나 폐기된 role은 무시됩니다. WAI-ARIA 명세의 유효한 role 이름인지 확인하세요.",
      en: "Use only valid role values from the WAI-ARIA spec.",
    },
  },
  {
    ruleId: "aria-valid-attr",
    wcag: ["4.1.2"],
    kwcag: ["8.2.1"],
    level: "A",
    title: { ko: "존재하지 않는 ARIA 속성을 사용하고 있습니다", en: "ARIA attributes must be valid names" },
    guide: {
      ko: "`aria-lable`처럼 오타가 난 속성은 조용히 무시되어 접근성이 제공되지 않습니다. 속성 이름을 확인하세요.",
      en: "Fix misspelled aria-* attribute names.",
    },
  },
  {
    ruleId: "aria-valid-attr-value",
    wcag: ["4.1.2"],
    kwcag: ["8.2.1"],
    level: "A",
    title: { ko: "ARIA 속성 값이 올바르지 않습니다", en: "ARIA attributes must have valid values" },
    guide: {
      ko: "예: `aria-hidden=\"yes\"`(잘못) → `aria-hidden=\"true\"`, 존재하지 않는 id를 참조하는 `aria-labelledby` 등. 명세에 맞는 값·실존하는 id인지 확인하세요.",
      en: "Ensure attribute values match the spec and referenced ids exist.",
    },
  },
  {
    ruleId: "aria-hidden-body",
    wcag: ["4.1.2"],
    kwcag: ["8.2.1"],
    level: "A",
    title: { ko: "body에 aria-hidden이 지정되어 있습니다", en: "aria-hidden must not be on the document body" },
    guide: {
      ko: "`<body aria-hidden=\"true\">`는 페이지 전체를 보조기기에서 숨깁니다. 제거하세요.",
      en: "Remove aria-hidden from the body element.",
    },
  },
  {
    ruleId: "aria-hidden-focus",
    wcag: ["4.1.2"],
    kwcag: ["8.2.1"],
    level: "A",
    title: { ko: "aria-hidden 요소 안에 초점 가능한 요소가 있습니다", en: "aria-hidden elements must not contain focusable elements" },
    guide: {
      ko: "보조기기에는 숨겨졌지만 Tab으로는 도달 가능한 '유령 초점'이 생깁니다. 내부 초점 요소에 `tabindex=\"-1\"`을 주거나 `inert` 속성을 사용하세요.\n\n```html\n<div aria-hidden=\"true\" inert>…</div>\n```",
      en: "Use inert or tabindex=-1 so hidden content can't receive focus.",
    },
  },
  {
    ruleId: "aria-input-field-name",
    wcag: ["4.1.2"],
    kwcag: ["8.2.1", "7.4.1"],
    level: "A",
    title: { ko: "ARIA 입력 필드에 접근 가능한 이름이 없습니다", en: "ARIA input fields must have an accessible name" },
    guide: {
      ko: "`role=\"textbox\"`, `role=\"combobox\"` 등 커스텀 입력 위젯에 `aria-label` 또는 `aria-labelledby`로 이름을 제공하세요.",
      en: "Name custom ARIA input widgets via aria-label/labelledby.",
    },
  },
  {
    ruleId: "aria-toggle-field-name",
    wcag: ["4.1.2"],
    kwcag: ["8.2.1", "7.4.1"],
    level: "A",
    title: { ko: "ARIA 토글 필드에 접근 가능한 이름이 없습니다", en: "ARIA toggle fields must have an accessible name" },
    guide: {
      ko: "`role=\"checkbox\"`, `role=\"switch\"` 등 토글 위젯에 이름을 제공하세요.",
      en: "Name ARIA toggle widgets (checkbox, switch, radio).",
    },
  },
  {
    ruleId: "aria-command-name",
    wcag: ["4.1.2"],
    kwcag: ["8.2.1"],
    level: "A",
    title: { ko: "ARIA 버튼·링크·메뉴항목에 이름이 없습니다", en: "ARIA commands must have an accessible name" },
    guide: {
      ko: "`role=\"button|link|menuitem\"` 요소에 텍스트 또는 aria-label을 제공하세요.",
      en: "Provide text or aria-label for ARIA command roles.",
    },
  },
  {
    ruleId: "aria-meter-name",
    wcag: ["1.1.1"],
    kwcag: ["8.2.1"],
    level: "A",
    title: { ko: "meter 요소에 접근 가능한 이름이 없습니다", en: "ARIA meter nodes must have an accessible name" },
    guide: { ko: "`role=\"meter\"`가 무엇을 측정하는지 aria-label로 알려주세요 (예: \"저장 공간 사용량\").", en: "Label what the meter measures." },
  },
  {
    ruleId: "aria-progressbar-name",
    wcag: ["1.1.1"],
    kwcag: ["8.2.1"],
    level: "A",
    title: { ko: "진행 표시줄에 접근 가능한 이름이 없습니다", en: "ARIA progressbar nodes must have an accessible name" },
    guide: { ko: "`role=\"progressbar\"`가 어떤 작업의 진행률인지 aria-label로 알려주세요 (예: \"파일 업로드 진행률\").", en: "Label what the progressbar tracks." },
  },
  {
    ruleId: "aria-tooltip-name",
    wcag: ["4.1.2"],
    kwcag: ["8.2.1"],
    level: "A",
    title: { ko: "툴팁 요소에 접근 가능한 이름이 없습니다", en: "ARIA tooltip nodes must have an accessible name" },
    guide: { ko: "`role=\"tooltip\"` 요소에 내용 텍스트를 제공하세요.", en: "Tooltips need text content." },
  },
  {
    ruleId: "aria-dialog-name",
    wcag: ["4.1.2"],
    kwcag: ["8.2.1"],
    level: "BP",
    title: { ko: "다이얼로그에 접근 가능한 이름이 없습니다", en: "ARIA dialog nodes must have an accessible name" },
    guide: {
      ko: "모달이 열릴 때 스크린 리더가 무슨 창인지 알 수 있도록 `aria-labelledby`로 제목과 연결하세요.\n\n```html\n<div role=\"dialog\" aria-modal=\"true\" aria-labelledby=\"dlg-title\">\n  <h2 id=\"dlg-title\">회원 탈퇴 확인</h2>\n</div>\n```",
      en: "Connect dialogs to their heading via aria-labelledby.",
    },
  },
  {
    ruleId: "aria-text",
    wcag: ["4.1.2"],
    kwcag: ["8.2.1"],
    level: "BP",
    title: { ko: "role=text 안에 초점 가능한 요소가 있습니다", en: "role=text must not contain focusable descendants" },
    guide: { ko: "`role=\"text\"`는 자식의 의미를 모두 제거합니다. 내부에 링크·버튼이 있다면 role을 제거하세요.", en: "Remove role=text when it contains focusable children." },
  },
  {
    ruleId: "aria-treeitem-name",
    wcag: ["4.1.2"],
    kwcag: ["8.2.1"],
    level: "BP",
    title: { ko: "트리 항목에 접근 가능한 이름이 없습니다", en: "ARIA treeitem nodes must have an accessible name" },
    guide: { ko: "`role=\"treeitem\"` 요소에 텍스트 또는 aria-label을 제공하세요.", en: "Name treeitem nodes." },
  },
  {
    ruleId: "aria-conditional-attr",
    wcag: ["4.1.2"],
    kwcag: ["8.2.1"],
    level: "A",
    title: { ko: "요소 상태와 맞지 않는 ARIA 속성이 있습니다", en: "ARIA attributes must be used as specified for the element's state" },
    guide: { ko: "예: 네이티브 `<input type=\"checkbox\">`에 `aria-checked`를 중복 지정하면 실제 상태와 어긋날 수 있습니다. 네이티브 상태를 그대로 쓰고 중복 ARIA를 제거하세요.", en: "Remove ARIA that duplicates or contradicts native element state." },
  },
  {
    ruleId: "aria-deprecated-role",
    wcag: ["4.1.2"],
    kwcag: ["8.2.1"],
    level: "BP",
    title: { ko: "폐기된 ARIA role을 사용하고 있습니다", en: "Deprecated ARIA roles must not be used" },
    guide: { ko: "`directory` 등 폐기된 role은 최신 명세의 대체 role로 교체하세요.", en: "Replace deprecated roles with current equivalents." },
  },
  {
    ruleId: "aria-prohibited-attr",
    wcag: ["4.1.2"],
    kwcag: ["8.2.1"],
    level: "A",
    title: { ko: "해당 요소에 금지된 ARIA 속성이 있습니다", en: "ARIA attributes must not be prohibited for the role" },
    guide: { ko: "예: 일반 `<div>`(role 없음)에는 `aria-label`이 효과가 없습니다. 적절한 role을 부여하거나 다른 방식으로 이름을 제공하세요.", en: "Add an appropriate role or remove the prohibited attribute." },
  },
  {
    ruleId: "aria-braille-equivalent",
    wcag: ["4.1.2"],
    kwcag: ["8.2.1"],
    level: "A",
    title: { ko: "점자 레이블에 대응하는 일반 레이블이 없습니다", en: "aria-braille attributes require a non-braille equivalent" },
    guide: { ko: "`aria-braillelabel`을 쓰려면 일반 `aria-label`(또는 접근 가능한 이름)이 먼저 있어야 합니다.", en: "Provide a standard accessible name alongside braille attributes." },
  },
  {
    ruleId: "presentation-role-conflict",
    wcag: ["4.1.2"],
    kwcag: ["8.2.1"],
    level: "BP",
    title: { ko: "presentation role이 다른 속성과 충돌합니다", en: "presentation role conflicts with other attributes" },
    guide: { ko: "`role=\"presentation\"`(또는 none) 요소에 tabindex나 aria 속성이 있으면 role이 무시됩니다. 장식용이면 다른 속성을 제거하고, 의미가 있다면 presentation role을 제거하세요.", en: "Remove conflicting attributes or the presentation role." },
  },
  {
    ruleId: "aria-allowed-role",
    wcag: [],
    kwcag: ["8.2.1"],
    level: "BP",
    title: { ko: "요소에 허용되지 않는 role이 지정되었습니다", en: "ARIA role should be appropriate for the element" },
    guide: { ko: "예: `<li role=\"button\">`처럼 요소 의미와 어긋나는 role은 혼란을 만듭니다. 가능하면 시맨틱 요소(`<button>`)를 직접 사용하세요.", en: "Prefer native semantic elements over conflicting roles." },
  },

  // ───────── 뷰포트·기타 ─────────
  {
    ruleId: "meta-viewport",
    wcag: ["1.4.4"],
    kwcag: [],
    level: "AA",
    title: { ko: "화면 확대(줌)가 차단되어 있습니다", en: "Zooming must not be disabled" },
    guide: {
      ko: "`user-scalable=no` 또는 `maximum-scale=1`은 저시력 사용자의 화면 확대를 막습니다.\n\n```html\n<!-- 잘못된 예 -->\n<meta name=\"viewport\" content=\"width=device-width, user-scalable=no\">\n<!-- 올바른 예 -->\n<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">\n```",
      en: "Remove user-scalable=no and maximum-scale restrictions.",
    },
  },
  {
    ruleId: "meta-viewport-large",
    wcag: [],
    kwcag: [],
    level: "BP",
    title: { ko: "충분한 배율(5배)까지 확대할 수 없습니다", en: "Users should be able to zoom up to 500%" },
    guide: { ko: "maximum-scale을 5 이상으로 허용해 저시력 사용자가 충분히 확대할 수 있게 하세요.", en: "Allow zoom up to at least 5x." },
  },
  {
    ruleId: "css-orientation-lock",
    wcag: ["1.3.4"],
    kwcag: [],
    level: "AA",
    title: { ko: "화면 방향이 세로 또는 가로로 고정되어 있습니다", en: "Content must not be locked to one orientation" },
    guide: { ko: "CSS로 특정 방향에서만 콘텐츠를 표시하면 거치대에 기기를 고정한 사용자가 이용할 수 없습니다. 가로·세로 모두 지원하세요.", en: "Support both portrait and landscape orientations." },
  },
  {
    ruleId: "avoid-inline-spacing",
    wcag: ["1.4.12"],
    kwcag: [],
    level: "AA",
    title: { ko: "인라인 스타일이 텍스트 간격 조정을 막습니다", en: "Inline text spacing must be adjustable" },
    guide: { ko: "`style` 속성에 `!important`로 지정된 letter-spacing/line-height 등은 사용자의 가독성 스타일 재정의를 막습니다. 인라인 `!important`를 제거하세요.", en: "Remove !important from inline text spacing styles." },
  },
  {
    ruleId: "region",
    wcag: [],
    kwcag: ["6.4.1"],
    level: "BP",
    title: { ko: "랜드마크에 포함되지 않은 콘텐츠가 있습니다", en: "All content should be contained by landmarks" },
    guide: {
      ko: "모든 콘텐츠를 `<header>`, `<nav>`, `<main>`, `<footer>` 등 랜드마크 영역 안에 배치하면 스크린 리더 사용자가 영역 단위로 빠르게 이동할 수 있습니다.",
      en: "Place all content inside landmark regions (header/nav/main/footer).",
    },
  },
  {
    ruleId: "landmark-one-main",
    wcag: [],
    kwcag: ["6.4.1"],
    level: "BP",
    title: { ko: "main 랜드마크가 없거나 여러 개입니다", en: "Page should have exactly one main landmark" },
    guide: { ko: "페이지의 핵심 콘텐츠를 감싸는 `<main>`을 정확히 하나 제공하세요.", en: "Provide exactly one main element." },
  },
  {
    ruleId: "landmark-unique",
    wcag: [],
    kwcag: ["6.4.1"],
    level: "BP",
    title: { ko: "같은 종류의 랜드마크를 구별할 수 없습니다", en: "Landmarks should be unique" },
    guide: { ko: "`<nav>`가 여러 개면 `aria-label`로 구별하세요 (예: \"주 메뉴\", \"페이지 내 목차\").", en: "Differentiate repeated landmarks with aria-label." },
  },
  {
    ruleId: "landmark-no-duplicate-banner",
    wcag: [],
    kwcag: ["6.4.1"],
    level: "BP",
    title: { ko: "banner 랜드마크가 여러 개입니다", en: "Page should not have more than one banner landmark" },
    guide: { ko: "최상위 `<header>`(banner)는 페이지에 하나만 두세요.", en: "Keep a single top-level header." },
  },
  {
    ruleId: "landmark-no-duplicate-contentinfo",
    wcag: [],
    kwcag: ["6.4.1"],
    level: "BP",
    title: { ko: "contentinfo 랜드마크가 여러 개입니다", en: "Page should not have more than one contentinfo landmark" },
    guide: { ko: "최상위 `<footer>`(contentinfo)는 페이지에 하나만 두세요.", en: "Keep a single top-level footer." },
  },
  {
    ruleId: "duplicate-banner",
    wcag: [],
    kwcag: ["6.4.1"],
    level: "BP",
    title: { ko: "banner 영역이 중복되었습니다", en: "Banner landmark duplicated" },
    guide: { ko: "최상위 header는 하나만 유지하세요.", en: "Keep one banner landmark." },
  },
  {
    ruleId: "frame-tested",
    wcag: [],
    kwcag: [],
    level: "BP",
    title: { ko: "iframe 내부는 검사되지 않았습니다", en: "Frames were not tested" },
    guide: { ko: "iframe 내부 문서는 이번 자동 검사 범위에 포함되지 않았습니다. 프레임 내부 페이지를 별도로 검사하세요.", en: "Scan the framed document separately." },
  },

  // ───────── A11Y Check 자체 규칙 (axe 미커버 SC 보완) ─────────
  {
    ruleId: "a11ychk:reflow",
    wcag: ["1.4.10"],
    kwcag: [],
    level: "AA",
    title: { ko: "320px 폭에서 가로 스크롤이 발생합니다", en: "Horizontal scrolling occurs at 320px width" },
    guide: {
      ko: "화면을 400%까지 확대(320 CSS px 폭 상당)해도 가로 스크롤 없이 콘텐츠가 다시 배치(리플로우)되어야 합니다. 저시력 사용자가 확대해서 볼 때 좌우로 스크롤하지 않게 하기 위함입니다.\n\n```css\n/* 고정 폭 대신 반응형 단위 사용 */\n.container { max-width: 100%; }\nimg, table, pre { max-width: 100%; }\n```\n\n데이터 표·지도처럼 2차원 배치가 본질적으로 필요한 콘텐츠는 예외입니다.",
      en: "Content must reflow without horizontal scrolling at 320 CSS px (≈400% zoom), except for 2D content like data tables or maps.",
    },
  },
  {
    ruleId: "a11ychk:keyboard-clickable",
    wcag: ["2.1.1"],
    kwcag: ["6.1.1"],
    level: "A",
    title: { ko: "클릭은 되지만 키보드로 조작할 수 없는 요소가 있습니다", en: "Clickable element is not keyboard operable" },
    guide: {
      ko: "`onclick`이 붙었지만 키보드 초점을 받지 못하는 `<div>`·`<span>` 등이 있습니다. 키보드 사용자가 실행할 수 없습니다. 가능하면 `<button>`을 쓰고, 불가피하면 `tabindex=\"0\"`·`role`·키보드 이벤트를 함께 제공하세요.\n\n```html\n<!-- 잘못된 예 -->\n<div onclick=\"submit()\">전송</div>\n<!-- 올바른 예 -->\n<button type=\"button\" onclick=\"submit()\">전송</button>\n```",
      en: "Elements with onclick but no keyboard focus/handler can't be operated by keyboard. Prefer <button>, or add tabindex, role, and key handlers.",
    },
  },
  {
    ruleId: "a11ychk:focus-visible",
    wcag: ["2.4.7"],
    kwcag: ["6.1.2"],
    level: "AA",
    title: { ko: "키보드 초점 표시가 보이지 않을 수 있습니다", en: "Keyboard focus indicator may not be visible" },
    guide: {
      ko: "키보드로 초점을 옮겼을 때 어떤 요소에 있는지 시각적으로 보여야 합니다. `outline: none`으로 기본 표시를 제거하고 대체 스타일을 주지 않으면 키보드 사용자가 위치를 알 수 없습니다.\n\n```css\n/* outline을 없앴다면 반드시 대체 표시 제공 */\na:focus-visible, button:focus-visible {\n  outline: 3px solid #0b5d54;\n  outline-offset: 2px;\n}\n```\n\n실제로 Tab 키로 이동하며 초점 표시가 뚜렷한지 확인하세요.",
      en: "Keyboard focus must be visibly indicated. If you remove the default outline, provide a clear alternative (outline, box-shadow, etc.).",
    },
  },
  {
    ruleId: "a11ychk:page-title-unique",
    wcag: ["2.4.2"],
    kwcag: ["6.4.2"],
    level: "A",
    title: { ko: "여러 페이지의 제목이 모두 동일합니다", en: "Multiple pages share the same title" },
    guide: {
      ko: "표본으로 검사한 여러 페이지의 `<title>`이 전부 같습니다. 각 페이지는 내용을 구분할 수 있는 고유한 제목을 가져야 합니다(예: \"회사소개 - OO대학교\", \"입학안내 - OO대학교\"). 스크린 리더·탭·북마크에서 페이지를 식별하는 핵심 정보입니다.",
      en: "Sampled pages all share the same <title>. Each page needs a unique, descriptive title.",
    },
  },
  {
    ruleId: "a11ychk:consistent-navigation",
    wcag: ["3.2.3"],
    kwcag: [],
    level: "AA",
    title: { ko: "페이지마다 내비게이션 순서가 다릅니다", en: "Navigation order differs across pages" },
    guide: {
      ko: "여러 페이지에서 반복되는 내비게이션(주 메뉴 등)은 상대적 순서를 일관되게 유지해야 합니다. 페이지마다 메뉴 순서가 바뀌면 사용자가 예측하기 어렵습니다. 공통 레이아웃/템플릿으로 내비게이션을 렌더링하세요.",
      en: "Repeated navigation must keep a consistent relative order across pages. Render it from a shared layout/template.",
    },
  },
  {
    ruleId: "a11ychk:multiple-ways",
    wcag: ["2.4.5"],
    kwcag: [],
    level: "AA",
    title: { ko: "페이지를 찾는 방법이 하나뿐입니다", en: "Only one way to locate pages" },
    guide: {
      ko: "사이트 내에서 페이지를 찾는 방법이 두 가지 이상 제공되어야 합니다(예: 주 메뉴 + 검색, 또는 메뉴 + 사이트맵). 표본에서 내비게이션 외에 검색·사이트맵을 찾지 못했습니다. 검색 기능이나 사이트맵 링크를 제공하세요.",
      en: "Provide at least two ways to find pages (e.g., navigation + search, or navigation + sitemap).",
    },
  },
  {
    ruleId: "a11ychk:alt-quality",
    wcag: ["1.1.1"],
    kwcag: ["5.1.1"],
    level: "A",
    title: { ko: "대체 텍스트가 파일명이거나 의미 없는 값입니다", en: "Alt text is a filename or meaningless value" },
    guide: {
      ko: "대체 텍스트는 '있는 것'만으로는 부족하고 이미지의 의미를 전달해야 합니다. 파일명(예: `photo01.jpg`)이나 \"이미지\"·\"사진\" 같은 일반어는 스크린 리더 사용자에게 아무 정보도 주지 못합니다(WCAG 실패 사례 F30).\n\n```html\n<!-- 잘못된 예 -->\n<img src=\"chart.png\" alt=\"chart.png\">\n<img src=\"banner.jpg\" alt=\"이미지\">\n<!-- 올바른 예 -->\n<img src=\"chart.png\" alt=\"2025년 분기별 매출 추이 — 4분기 32% 증가\">\n```\n\n장식 목적의 이미지라면 `alt=\"\"`(빈 값)로 두어 스크린 리더가 건너뛰게 하세요.",
      en: "Alt text must convey the image's meaning. Filenames (F30) or generic words like \"image\" give screen-reader users no information. Use empty alt for decorative images.",
    },
  },
  {
    ruleId: "a11ychk:autoplay",
    wcag: ["1.4.2"],
    kwcag: ["5.4.2"],
    level: "A",
    title: { ko: "소리가 자동으로 재생됩니다", en: "Audio plays automatically" },
    guide: {
      ko: "페이지 진입 시 3초 이상 소리가 자동 재생되면 스크린 리더 음성과 겹쳐 사용자가 페이지를 이용할 수 없습니다. `autoplay`를 제거하는 것이 가장 좋고, 유지해야 한다면 `muted`를 함께 지정하고 화면 앞부분에 정지/음량 조절 수단을 제공하세요.\n\n```html\n<!-- 잘못된 예 -->\n<video autoplay src=\"intro.mp4\"></video>\n<!-- 개선 예 -->\n<video autoplay muted playsinline src=\"intro.mp4\"></video>\n```",
      en: "Auto-playing audio over 3s conflicts with screen readers. Remove autoplay, or add muted and provide a pause/volume control early in the page.",
    },
  },
  {
    ruleId: "a11ychk:link-text",
    wcag: ["2.4.4"],
    kwcag: ["6.4.3"],
    level: "A",
    title: { ko: "링크 텍스트만으로 목적을 알기 어렵습니다", en: "Link text may not describe its purpose" },
    guide: {
      ko: "\"여기\", \"더보기\", \"클릭\" 같은 일반어 링크가 발견되었습니다. 링크 목록만 훑어 듣는 스크린 리더 사용자는 무엇에 대한 링크인지 알 수 없습니다. 주변 문장·목록 항목에서 목적을 알 수 있으면 통과이므로 직접 확인하세요.\n\n개선 방법: 링크 텍스트 자체를 구체적으로 바꾸거나(\"채용 공고 더보기\"), 시각 디자인을 유지해야 하면 `aria-label`이나 숨김 텍스트로 보완하세요.\n\n```html\n<a href=\"/jobs\">더보기<span class=\"sr-only\"> — 채용 공고</span></a>\n```",
      en: "Generic link text (\"here\", \"more\") was found. It passes if the surrounding sentence or list item provides context — verify manually, or make the text specific / add aria-label.",
    },
  },
  {
    ruleId: "a11ychk:target-size",
    wcag: ["2.5.8"],
    kwcag: ["6.1.3"],
    level: "AA",
    title: { ko: "클릭·터치 대상이 24×24px보다 작습니다", en: "Target smaller than 24×24 px" },
    guide: {
      ko: "버튼·링크 등 조작 대상은 최소 24×24 CSS px이어야 합니다(WCAG 2.2 신설). 작은 대상은 손떨림이 있거나 터치 기기를 쓰는 사용자가 누르기 어렵습니다. 단, 주변에 충분한 간격(24px 원 안에 다른 타깃이 없음)이 있거나 문장 속 인라인 링크면 예외이므로 직접 확인하세요.\n\n```css\n.icon-button { min-width: 24px; min-height: 24px; }\n/* 시각 크기를 못 키우면 히트 영역만 확장 */\n.icon-button { position: relative; }\n.icon-button::after { content: \"\"; position: absolute; inset: -6px; }\n```",
      en: "Interactive targets need ≥24×24 CSS px (WCAG 2.2), unless spacing or inline-text exceptions apply — verify flagged elements manually.",
    },
  },
  {
    ruleId: "a11ychk:skip-link",
    wcag: ["2.4.1"],
    kwcag: ["6.4.1"],
    level: "A",
    title: { ko: "반복 영역을 건너뛰는 링크가 없습니다", en: "No skip-to-content link found" },
    guide: {
      ko: "메뉴 등 여러 페이지에서 반복되는 영역을 건너뛰고 본문으로 바로 이동하는 링크가 필요합니다. 키보드·스크린 리더 사용자가 매 페이지에서 메뉴를 모두 지나치지 않도록 합니다. 페이지 최상단에 본문(main)으로 가는 링크를 두세요.\n\n```html\n<body>\n  <a href=\"#main\" class=\"skip-link\">본문 바로가기</a>\n  <nav>…</nav>\n  <main id=\"main\">…</main>\n```\n\n```css\n/* 평소 숨겼다가 초점 시 표시 */\n.skip-link { position:absolute; left:-9999px; }\n.skip-link:focus { left:8px; top:8px; }\n```\n\n건너뛰기 링크가 있는데 감지되지 않았을 수 있으니 직접 확인하세요.",
      en: "Provide a link at the top of the page to skip repeated navigation and jump to main content, shown on focus. Verify manually if one exists but wasn't detected.",
    },
  },
  {
    ruleId: "a11ychk:captions-track",
    wcag: ["1.2.2"],
    kwcag: ["5.2.1"],
    level: "A",
    title: { ko: "동영상에 자막 트랙이 없습니다", en: "Video has no captions track" },
    guide: {
      ko: "소리가 있는 동영상에는 청각장애 사용자를 위한 자막이 필요합니다. `<video>`에 `<track kind=\"captions\">`를 추가하세요. 이미 별도(하드/외부) 자막이 있다면 통과이므로 직접 확인하세요.\n\n```html\n<video controls>\n  <source src=\"intro.mp4\" type=\"video/mp4\">\n  <track kind=\"captions\" src=\"intro.ko.vtt\" srclang=\"ko\" label=\"한국어\" default>\n</video>\n```",
      en: "Video with audio needs captions. Add <track kind=\"captions\">, or verify manually if captions are provided another way.",
    },
  },
  {
    ruleId: "a11ychk:new-window",
    wcag: ["3.2.2"],
    kwcag: ["7.2.1"],
    level: "A",
    title: { ko: "새 창으로 열리는 링크에 안내가 없습니다", en: "Link opens a new window without notice" },
    guide: {
      ko: "`target=\"_blank\"`로 새 창(탭)이 열리는 링크는 사용자가 예측할 수 있도록 미리 알려야 합니다. 갑작스러운 새 창은 스크린 리더 사용자에게 특히 혼란을 줍니다. 링크 텍스트나 숨김 텍스트로 \"새 창 열림\"을 알리고, `rel=\"noopener\"`도 함께 지정하세요.\n\n```html\n<a href=\"…\" target=\"_blank\" rel=\"noopener\">\n  자료실<span class=\"sr-only\"> (새 창 열림)</span>\n</a>\n```",
      en: "Links opening a new window (target=_blank) should warn users in advance (e.g., hidden \"(opens in new window)\" text) and use rel=noopener.",
    },
  },
];

export const RULE_BY_ID: ReadonlyMap<string, RuleCatalogEntry> = new Map(RULE_CATALOG.map((r) => [r.ruleId, r]));

/** axe 태그 목록에서 WCAG 성공기준 번호 추출 (예: wcag143 → 1.4.3) */
export function wcagFromTags(tags: string[]): string[] {
  const out: string[] = [];
  for (const tag of tags) {
    const m = tag.match(/^wcag(\d)(\d)(\d{1,2})$/);
    if (m) out.push(`${m[1]}.${m[2]}.${m[3]}`);
  }
  return out;
}

/**
 * 카탈로그 조회 — 미등록 규칙이면 axe 태그에서 WCAG를 추출해 기본 항목 생성.
 * 새 axe 버전이 규칙을 추가해도 보고서가 깨지지 않게 하는 안전망.
 */
export function getRuleEntry(ruleId: string, tags: string[] = []): RuleCatalogEntry {
  const found = RULE_BY_ID.get(ruleId);
  if (found) return found;
  const wcag = wcagFromTags(tags);
  return {
    ruleId,
    wcag,
    kwcag: [],
    level: tags.includes("wcag2aa") || tags.some((t) => /^wcag2\d+aa$/.test(t)) ? "AA" : tags.includes("best-practice") ? "BP" : "A",
    title: { ko: `접근성 규칙 위반: ${ruleId}`, en: `Accessibility rule violation: ${ruleId}` },
    guide: {
      ko: "이 규칙은 아직 한국어 가이드가 준비되지 않았습니다. 위반 요약과 axe-core 도움말 링크를 참고해 주세요. (가이드 기여를 환영합니다: github.com/a11ychk)",
      en: "No localized guide yet — see the axe-core help link.",
    },
  };
}
