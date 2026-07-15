/**
 * 자체 커스텀 검사 — axe가 커버하지 못하는 자동화 가능 성공기준을 보완한다.
 * 페이지 컨텍스트에서 순수 JS로 실행(문자열 평가 — 번들러 변환 영향 없음).
 * 확신 가능한 항목만 위반(violation), 불확실한 휴리스틱은 확인 필요(incomplete)로 분류.
 *
 * 규칙 id는 "a11ychk:" 접두사 — 카탈로그(catalog/rules.ts)에 가이드가 등록돼 있다.
 */
import type { Page } from "playwright-core";
import type { Finding } from "../types";

export interface CustomResult {
  violations: Finding[];
  passes: string[];
  incomplete: string[];
}

/** 현재 뷰포트에서 실행하는 검사 (클릭 핸들러·포커스·미디어) */
const BASE_SCRIPT = `(function(){
  var res = { inlineClickNonInteractive: [], focusSampled: 0, focusNoOutline: 0, focusExamples: [], hasMedia: false };
  try { res.hasMedia = !!document.querySelector('video, audio'); } catch(e){}
  try {
    var NATIVE = /^(A|BUTTON|INPUT|SELECT|TEXTAREA|SUMMARY)$/;
    var INTERACTIVE_ROLE = /^(button|link|checkbox|menuitem|menuitemcheckbox|menuitemradio|tab|switch|radio|option|slider|spinbutton|textbox)$/;
    var clickers = document.querySelectorAll('[onclick]');
    for (var i=0;i<clickers.length && res.inlineClickNonInteractive.length<8;i++){
      var el = clickers[i];
      if (NATIVE.test(el.tagName)) continue;
      var role = el.getAttribute('role');
      var ti = el.getAttribute('tabindex');
      if ((role && INTERACTIVE_ROLE.test(role)) || ti !== null) continue;
      res.inlineClickNonInteractive.push({ selector: cssPath(el), html: el.outerHTML.slice(0,300) });
    }
  } catch(e){}
  try {
    var focusables = document.querySelectorAll('a[href], button:not([disabled]), input:not([type=hidden]):not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex^="-"])');
    var limit = Math.min(focusables.length, 20);
    for (var j=0;j<limit;j++){
      var f = focusables[j];
      var b = getComputedStyle(f);
      var boBefore = b.boxShadow, olwBefore = b.outlineWidth, olsBefore = b.outlineStyle, brBefore = b.borderColor;
      try { f.focus(); } catch(e){ continue; }
      if (document.activeElement !== f) continue;
      res.focusSampled++;
      var a = getComputedStyle(f);
      var outlineVisible = (a.outlineStyle !== 'none' && a.outlineWidth !== '0px');
      var boxShadowChanged = (a.boxShadow !== boBefore && a.boxShadow !== 'none');
      var borderChanged = (a.borderColor !== brBefore);
      var bgChanged = (a.backgroundColor !== b.backgroundColor);
      if (!outlineVisible && !boxShadowChanged && !borderChanged && !bgChanged) {
        res.focusNoOutline++;
        if (res.focusExamples.length < 5) res.focusExamples.push({ selector: cssPath(f), html: f.outerHTML.slice(0,200) });
      }
    }
  } catch(e){}
  function cssPath(el){
    try {
      if (el.id) return '#'+el.id;
      var parts=[], cur=el, depth=0;
      while (cur && cur.nodeType===1 && depth<4){
        var sel=cur.tagName.toLowerCase();
        if (cur.className && typeof cur.className==='string'){ var c=cur.className.trim().split(/\\s+/)[0]; if(c) sel+='.'+c; }
        parts.unshift(sel); cur=cur.parentElement; depth++;
      }
      return parts.join(' > ');
    } catch(e){ return el.tagName ? el.tagName.toLowerCase() : '?'; }
  }
  return res;
})()`;

interface BaseResult {
  inlineClickNonInteractive: { selector: string; html: string }[];
  focusSampled: number;
  focusNoOutline: number;
  focusExamples: { selector: string; html: string }[];
  hasMedia: boolean;
}

function finding(ruleId: string, impact: Finding["impact"], nodes: Finding["nodes"]): Finding {
  return { ruleId, impact, tags: [], helpUrl: "", nodes };
}

export async function runCustomChecks(page: Page): Promise<CustomResult> {
  const violations: Finding[] = [];
  const passes: string[] = [];
  const incomplete: string[] = [];

  // 1) 현재 뷰포트에서 클릭 핸들러·포커스·미디어 검사
  const base = (await page.evaluate(BASE_SCRIPT)) as BaseResult;

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

  // 1.4.10 리플로우 — 320px 폭에서 가로 스크롤 발생 여부 (뷰포트 변경 필요)
  try {
    await page.setViewportSize({ width: 320, height: 800 });
    const overflow = (await page.evaluate(
      "(document.documentElement.scrollWidth - document.documentElement.clientWidth)",
    )) as number;
    if (typeof overflow === "number" && overflow > 16) {
      violations.push(
        finding("a11ychk:reflow", "moderate", [
          {
            selector: "html",
            html: "<html>",
            failureSummary: `320px 폭(400% 확대 상당)에서 가로 스크롤이 발생합니다(약 ${Math.round(overflow)}px 초과). 데이터 표·지도 등 2차원 콘텐츠가 아니라면 반응형으로 개선하세요.`,
          },
        ]),
      );
    } else if (typeof overflow === "number") {
      passes.push("a11ychk:reflow");
    }
  } catch {
    // 뷰포트 변경/평가 실패 — 리플로우 검사 생략
  }

  return { violations, passes, incomplete };
}
