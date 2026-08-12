import { describe, expect, it } from "vitest";
import {
  DUPLICATE_ID_RULE,
  MARKUP_VALIDITY_RULE,
  checkHtmlValidity,
} from "../src/scanner/htmlValidity";

const wrap = (body: string) => `<!doctype html><html lang="ko"><head><title>t</title></head><body>${body}</body></html>`;

describe("checkHtmlValidity — 구조 오류", () => {
  it("올바른 문서는 두 규칙 모두 통과", () => {
    const r = checkHtmlValidity(wrap("<main id=\"main\"><p>본문</p></main>"));
    expect(r.violations).toEqual([]);
    expect(r.passes).toContain(MARKUP_VALIDITY_RULE);
    expect(r.passes).toContain(DUPLICATE_ID_RULE);
  });

  it("속성 중복을 위반으로 보고한다", () => {
    const r = checkHtmlValidity(wrap('<div class="a" class="b">x</div>'));
    const v = r.violations.find((f) => f.ruleId === MARKUP_VALIDITY_RULE);
    expect(v).toBeDefined();
    expect(v!.nodes[0]!.failureSummary).toContain("속성");
    expect(r.passes).not.toContain(MARKUP_VALIDITY_RULE);
  });

  it("닫히지 않은 요소를 보고한다", () => {
    const r = checkHtmlValidity(wrap("<section><div>x</section>"));
    const v = r.violations.find((f) => f.ruleId === MARKUP_VALIDITY_RULE);
    expect(v).toBeDefined();
    expect(v!.nodes[0]!.failureSummary).toContain("div");
    // 위치는 "행:열" 형식
    expect(v!.nodes[0]!.selector).toMatch(/^\d+:\d+$/);
  });

  it("잘못된 중첩(<b><i>x</b></i>)을 보고한다", () => {
    const r = checkHtmlValidity(wrap("<b><i>x</b></i>"));
    const v = r.violations.find((f) => f.ruleId === MARKUP_VALIDITY_RULE);
    expect(v).toBeDefined();
    expect(v!.nodes[0]!.failureSummary).toContain("i");
  });

  it("닫는 태그 생략이 허용되는 요소(li·p·td)는 위반이 아니다", () => {
    const r = checkHtmlValidity(wrap("<ul><li>a<li>b</ul><p>c<div>d</div><table><tr><td>e</table>"));
    expect(r.violations.find((f) => f.ruleId === MARKUP_VALIDITY_RULE)).toBeUndefined();
  });

  it("svg 내부의 자기 닫음은 위반이 아니다", () => {
    const r = checkHtmlValidity(wrap('<svg viewBox="0 0 1 1"><path d="M0 0"/></svg>'));
    expect(r.violations.find((f) => f.ruleId === MARKUP_VALIDITY_RULE)).toBeUndefined();
  });

  it("doctype 누락 같은 비구조 오류는 위반이 아니다", () => {
    const r = checkHtmlValidity('<html lang="ko"><head><title>t</title></head><body><p>x</p></body></html>');
    expect(r.violations).toEqual([]);
    expect(r.passes).toContain(MARKUP_VALIDITY_RULE);
  });

  it("자기 닫음(/>)을 쓴 비-void 요소를 보고한다", () => {
    const r = checkHtmlValidity(wrap("<div/><p>x</p>"));
    const v = r.violations.find((f) => f.ruleId === MARKUP_VALIDITY_RULE);
    expect(v).toBeDefined();
  });

  it("노드는 규칙당 10개로 캡된다", () => {
    const many = Array.from({ length: 15 }, (_, i) => `<div class="a" class="b">x${i}</div>`).join("");
    const r = checkHtmlValidity(wrap(many));
    const v = r.violations.find((f) => f.ruleId === MARKUP_VALIDITY_RULE);
    expect(v!.nodes.length).toBeLessThanOrEqual(10);
  });
});

describe("checkHtmlValidity — 중복 id", () => {
  it("중복 id를 모아 하나의 위반으로 보고한다", () => {
    const r = checkHtmlValidity(wrap('<p id="x">a</p><p id="x">b</p><p id="y">c</p>'));
    const v = r.violations.find((f) => f.ruleId === DUPLICATE_ID_RULE);
    expect(v).toBeDefined();
    expect(v!.nodes).toHaveLength(1);
    expect(v!.nodes[0]!.failureSummary).toContain('"x"');
    expect(v!.nodes[0]!.failureSummary).toContain("2회");
  });

  it("id가 하나도 없어도 통과로 기록한다 (not-applicable 아님)", () => {
    const r = checkHtmlValidity(wrap("<p>본문</p>"));
    expect(r.passes).toContain(DUPLICATE_ID_RULE);
  });

  it("template 내부의 id도 본다", () => {
    const r = checkHtmlValidity(wrap('<p id="x">a</p><template><span id="x">b</span></template>'));
    const v = r.violations.find((f) => f.ruleId === DUPLICATE_ID_RULE);
    expect(v).toBeDefined();
  });

  it("빈 id는 중복으로 세지 않는다", () => {
    const r = checkHtmlValidity(wrap('<p id="">a</p><p id="">b</p>'));
    expect(r.passes).toContain(DUPLICATE_ID_RULE);
  });
});

describe("checkHtmlValidity — 안전성", () => {
  it("빈 문자열도 예외 없이 처리한다", () => {
    expect(() => checkHtmlValidity("")).not.toThrow();
  });

  it("깊은 중첩(1만 단계)에서 스택 오버플로 없이 동작한다", () => {
    const deep = "<div>".repeat(10_000) + "x";
    expect(() => checkHtmlValidity(deep)).not.toThrow();
  });
});
