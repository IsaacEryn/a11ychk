/**
 * 원본 HTML 소스의 마크업 유효성 검사 — KWCAG 8.1.1 (마크업 오류 방지).
 *
 * axe는 파서가 이미 복구한 DOM을 보므로 태그 열고 닫음·중첩 오류를 볼 수 없다.
 * 여기서는 렌더링 전의 원본 응답 본문을 parse5(HTML 표준 파서)로 다시 파싱해
 * 파서가 보고하는 오류 중 **구조 오류만** 위반으로 채택한다 — doctype·문자 참조·
 * 주석 형식 같은 비구조 오류는 8.1.1의 범위(열고 닫음·중첩·속성 중복·id 중복)를
 * 벗어나므로 제외한다(오탐 억제).
 *
 * 한계: 파서가 조용히 복구하는 잘못된 중첩(예: <p> 안의 <div>)은 오류 이벤트가
 * 없어 검출되지 않는다. 이 한계는 카탈로그 howToTest에 명시한다.
 *
 * 순수 함수 — Playwright·네트워크 의존 없음 (단위 테스트 대상).
 */
import { parse, type ParserError } from "parse5";
import type { Finding, FindingNode } from "../types";

export const MARKUP_VALIDITY_RULE = "a11ychk:markup-validity";
export const DUPLICATE_ID_RULE = "a11ychk:duplicate-id";

/** 규칙당 보고 노드 상한 — 보고서 폭주 방지 (custom checks의 캡 관례와 동일) */
const MAX_NODES = 10;

/**
 * 8.1.1이 요구하는 구조 오류만 채택하는 allowlist.
 * parse5는 **토크나이저 수준** 오류만 onParseError로 보고한다(트리 구성 오류 코드는
 * enum에 있으나 실측상 발화하지 않음 — 열고 닫음·중첩 오류는 아래 endTag 위치
 * 검사로 별도 검출한다).
 */
const STRUCTURAL_ERROR_CODES = new Set<string>([
  "duplicate-attribute", // 속성 중복
  "eof-before-tag-name", // 태그 이름 없이 문서 종료 ("<"로 끝남)
  "eof-in-tag", // 태그 중간에 문서 종료
  "missing-end-tag-name", // "</>"
  "non-void-html-element-start-tag-with-trailing-solidus", // <div/> — HTML에서는 닫히지 않음
]);

/** 닫는 태그가 없는 void 요소 — endTag 부재가 정상 */
const VOID_ELEMENTS = new Set([
  "area", "base", "br", "col", "embed", "hr", "img", "input",
  "link", "meta", "param", "source", "track", "wbr",
]);

/** HTML 명세상 닫는 태그 생략이 허용되는 요소 — endTag 부재를 위반으로 보지 않는다 */
const OPTIONAL_END_TAG = new Set([
  "html", "head", "body", "p", "li", "dt", "dd", "rt", "rp",
  "optgroup", "option", "caption", "colgroup",
  "thead", "tbody", "tfoot", "tr", "td", "th",
]);

/** 구조 오류 코드 → 한국어 설명 (failureSummary) */
const ERROR_MESSAGES: Record<string, string> = {
  "duplicate-attribute": "같은 속성이 한 요소에 두 번 이상 선언되었습니다. 브라우저는 첫 값만 사용하므로 나머지는 무시됩니다.",
  "eof-before-tag-name": "태그가 완성되지 않은 채 문서가 끝났습니다.",
  "eof-in-tag": "태그 중간에 문서가 끝났습니다. 잘린 출력이 아닌지 확인하세요.",
  "missing-end-tag-name": "이름 없는 닫는 태그(</>)입니다. 닫으려는 요소 이름을 지정하세요.",
  "non-void-html-element-start-tag-with-trailing-solidus":
    "빈 요소가 아닌 태그에 자기 닫음(/>)을 썼습니다. HTML에서는 무시되어 요소가 닫히지 않으므로 명시적 닫는 태그를 사용하세요.",
};

export interface HtmlValidityResult {
  violations: Finding[];
  /** 위반이 없어 통과로 기록할 규칙 id */
  passes: string[];
}

/** 오류 위치의 원본 소스 발췌 — 보고서에서 위치를 사람이 찾을 수 있게 */
function excerptAt(lines: string[], line: number): string {
  const text = lines[line - 1] ?? "";
  return text.trim().slice(0, 200);
}

function finding(ruleId: string, nodes: FindingNode[]): Finding {
  return { ruleId, impact: "moderate", tags: [], helpUrl: "", nodes };
}

/** parse5 트리 노드 (필요한 필드만) */
interface TreeNode {
  nodeName?: string;
  tagName?: string;
  namespaceURI?: string;
  attrs?: { name: string; value: string }[];
  childNodes?: TreeNode[];
  content?: TreeNode; // <template>
  sourceCodeLocation?: {
    startLine: number;
    startCol: number;
    /** 원본에 닫는 태그가 있을 때만 존재 — 부재 = 생략·암시적 닫힘 */
    endTag?: { startLine: number; startCol: number };
  } | null;
}

const HTML_NS = "http://www.w3.org/1999/xhtml";

interface WalkResult {
  ids: Map<string, { line: number; col: number }[]>;
  /** 닫는 태그가 필요한데 원본에 없는 요소 */
  unclosed: { tagName: string; line: number; col: number }[];
}

/**
 * 트리를 한 번 순회하며 id 수집과 닫는 태그 검사를 함께 수행한다 (반복 순회 —
 * 깊은 문서에서 재귀 스택 오버플로 방지).
 *
 * 닫는 태그 검사: sourceCodeLocation.endTag가 없는 요소는 원본에 닫는 태그가 없이
 * 파서가 암시적으로 닫은 것이다. void 요소·생략 허용 요소·외래 네임스페이스(svg/math
 * — 자기 닫음 허용)·파서 삽입 요소(loc 없음)를 제외하면, 남는 것은 닫는 태그 누락
 * 또는 잘못된 중첩(<b><i>x</b></i>의 i처럼 조기 닫힘)으로 확정할 수 있다.
 */
function walkTree(root: TreeNode): WalkResult {
  const ids = new Map<string, { line: number; col: number }[]>();
  const unclosed: WalkResult["unclosed"] = [];
  const stack: TreeNode[] = [root];
  while (stack.length > 0) {
    const node = stack.pop()!;
    const loc = node.sourceCodeLocation;
    const id = node.attrs?.find((a) => a.name === "id")?.value.trim();
    if (id) {
      const list = ids.get(id) ?? [];
      list.push({ line: loc?.startLine ?? 0, col: loc?.startCol ?? 0 });
      ids.set(id, list);
    }
    if (
      node.tagName &&
      loc &&
      !loc.endTag &&
      node.namespaceURI === HTML_NS &&
      !VOID_ELEMENTS.has(node.tagName) &&
      !OPTIONAL_END_TAG.has(node.tagName)
    ) {
      unclosed.push({ tagName: node.tagName, line: loc.startLine, col: loc.startCol });
    }
    if (node.childNodes) stack.push(...node.childNodes);
    if (node.content) stack.push(node.content);
  }
  return { ids, unclosed };
}

/**
 * 원본 HTML의 마크업 유효성을 검사한다.
 * 반환된 FindingNode.selector는 CSS 선택자가 아니라 원본 소스의 "행:열" 위치다
 * (파서 오류는 DOM 노드가 아니라 소스 위치에 귀속되기 때문).
 */
export function checkHtmlValidity(rawHtml: string): HtmlValidityResult {
  const parseErrors: ParserError[] = [];
  let document: TreeNode;
  try {
    document = parse(rawHtml, {
      sourceCodeLocationInfo: true,
      onParseError: (err) => {
        if (STRUCTURAL_ERROR_CODES.has(err.code)) parseErrors.push(err);
      },
    }) as TreeNode;
  } catch {
    // 파서 자체가 던지면(비정상 입력) 판정하지 않는다 — 위반도 통과도 아님
    return { violations: [], passes: [] };
  }

  const lines = rawHtml.split("\n");
  const violations: Finding[] = [];
  const passes: string[] = [];
  const { ids, unclosed } = walkTree(document);

  // 1) 구조 오류 → a11ychk:markup-validity
  //    (토크나이저 오류 + 닫는 태그 누락·잘못된 중첩)
  const markupNodes: FindingNode[] = parseErrors.map((err) => ({
    selector: `${err.startLine}:${err.startCol}`,
    html: excerptAt(lines, err.startLine),
    failureSummary: ERROR_MESSAGES[err.code] ?? `마크업 구조 오류(${err.code})가 있습니다.`,
  }));
  for (const el of unclosed) {
    markupNodes.push({
      selector: `${el.line}:${el.col}`,
      html: excerptAt(lines, el.line),
      failureSummary: `<${el.tagName}> 요소의 닫는 태그가 없습니다. 닫는 태그를 누락했거나 태그 중첩 순서가 잘못되어 조기에 닫힌 것입니다.`,
    });
  }
  if (markupNodes.length > 0) {
    violations.push(finding(MARKUP_VALIDITY_RULE, markupNodes.slice(0, MAX_NODES)));
  } else {
    passes.push(MARKUP_VALIDITY_RULE);
  }

  // 2) 중복 id → a11ychk:duplicate-id (axe duplicate-id-active/aria는 조작·ARIA 참조
  //    id만 봄 — 여기서는 모든 id의 문서 내 유일성을 본다)
  const dupNodes: FindingNode[] = [];
  for (const [id, locs] of ids) {
    if (locs.length < 2 || dupNodes.length >= MAX_NODES) continue;
    dupNodes.push({
      selector: locs.map((l) => `${l.line}:${l.col}`).join(", "),
      html: excerptAt(lines, locs[1]!.line),
      failureSummary: `id "${id}"가 문서에서 ${locs.length}회 사용되었습니다. id는 문서 안에서 고유해야 합니다.`,
    });
  }
  if (dupNodes.length > 0) violations.push(finding(DUPLICATE_ID_RULE, dupNodes));
  else passes.push(DUPLICATE_ID_RULE);

  return { violations, passes };
}
