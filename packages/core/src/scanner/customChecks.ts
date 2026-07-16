/**
 * 자체 커스텀 검사 — axe가 커버하지 못하는 자동화 가능 성공기준을 보완한다.
 * 페이지 컨텍스트에서 순수 JS로 실행(문자열 평가 — 번들러 변환 영향 없음).
 * 확신 가능한 항목만 위반(violation), 불확실한 휴리스틱은 확인 필요(incomplete)로 분류.
 *
 * 규칙 id는 "a11ychk:" 접두사 — 카탈로그(catalog/rules.ts)에 가이드가 등록돼 있다.
 */
import type { Page } from "playwright-core";
import type { Finding } from "../types";
import { customFindingsFromSignals, type CustomResult, type PageCheckSignals } from "./pageChecks";

export type { CustomResult } from "./pageChecks";

/**
 * 현재 뷰포트에서 실행하는 검사 (클릭 핸들러·포커스·미디어·대체텍스트·자동재생·타깃 크기).
 * ⚠️ 반환 형태는 PageCheckSignals 계약 — 크롬 확장의 collectPageSignals(popup.ts)와
 * 동기 유지할 것. 판정 로직은 pageChecks.customFindingsFromSignals에서 공용.
 */
const BASE_SCRIPT = `(function(){
  var res = { inlineClickNonInteractive: [], focusSampled: 0, focusNoOutline: 0, focusExamples: [],
    hasMedia: false, altSampled: 0, altFilename: [], altGeneric: [], autoplay: [], genericLinks: 0,
    smallTargets: [], targetSampled: 0, hasNav: false, skipLinkPresent: false, videoNoTrack: 0, blankNoNotice: 0 };
  try { res.hasMedia = !!document.querySelector('video, audio'); } catch(e){}
  try {
    // 2.4.1 건너뛰기 링크 — 반복 내비게이션 유무 + 상단 앵커 링크
    res.hasNav = !!document.querySelector('nav, [role=navigation]');
    var links0 = document.querySelectorAll('a[href]');
    var SKIP = /건너뛰|본문\\s*바로|바로\\s*가기|skip|main content/i;
    for (var sk=0; sk<links0.length && sk<8; sk++){
      var h0 = (links0[sk].getAttribute('href')||'');
      var t0 = (links0[sk].textContent||'').trim();
      if ((h0.charAt(0)==='#' && h0.length>1) || SKIP.test(t0)) { res.skipLinkPresent = true; break; }
    }
  } catch(e){}
  try {
    // 1.2.2 자막 track 없는 video
    var vids = document.querySelectorAll('video');
    for (var vi=0; vi<vids.length; vi++){
      if (!vids[vi].querySelector('track[kind=captions],track[kind=subtitles]')) res.videoNoTrack++;
    }
  } catch(e){}
  try {
    // 3.2.2 새 창 고지 없는 target=_blank
    var blanks = document.querySelectorAll('a[target=_blank]');
    var NOTICE = /새\\s*창|새\\s*탭|팝업|new\\s*window|opens?\\s*in/i;
    for (var bl=0; bl<blanks.length; bl++){
      var el0 = blanks[bl];
      var txt0 = ((el0.textContent||'') + ' ' + (el0.getAttribute('aria-label')||'') + ' ' + (el0.getAttribute('title')||''));
      if (!NOTICE.test(txt0)) res.blankNoNotice++;
    }
  } catch(e){}
  try {
    // 1.1.1 — alt가 파일명(F30) 또는 의미 없는 일반어인 이미지
    var FILE=/\\.(jpe?g|png|gif|webp|svg|bmp|ico|tiff?)\\s*$/i;
    var GENERIC_ALT=/^(이미지|사진|그림|아이콘|배너|image|img|photo|picture|graphic|icon|banner|untitled|spacer|\\*|-)$/i;
    var imgs = document.querySelectorAll('img[alt]');
    for (var ia=0;ia<imgs.length;ia++){
      var alt=(imgs[ia].getAttribute('alt')||'').trim();
      if (!alt) continue;
      res.altSampled++;
      if (FILE.test(alt) && res.altFilename.length<8) res.altFilename.push({ selector: cssPath(imgs[ia]), html: imgs[ia].outerHTML.slice(0,300), alt: alt });
      else if (GENERIC_ALT.test(alt) && res.altGeneric.length<8) res.altGeneric.push({ selector: cssPath(imgs[ia]), html: imgs[ia].outerHTML.slice(0,300), alt: alt });
    }
  } catch(e){}
  try {
    // 1.4.2 — 음소거 없이 자동 재생되는 미디어
    var med = document.querySelectorAll('video[autoplay], audio[autoplay]');
    for (var m=0;m<med.length && res.autoplay.length<4;m++){
      if (med[m].hasAttribute('muted') || med[m].muted) continue;
      res.autoplay.push({ selector: cssPath(med[m]), html: med[m].outerHTML.slice(0,300) });
    }
  } catch(e){}
  try {
    // 2.4.4 — 목적을 알기 어려운 일반어 링크 텍스트 (맥락 확인 필요)
    var GENERIC_LINK=/^(여기|여기를?\\s*클릭|클릭(하세요)?|더\\s*보기|더보기|자세히(\\s*보기)?|바로\\s*가기|바로가기|here|click\\s*here|click|more|read\\s*more|learn\\s*more|go|link)$/i;
    var as2 = document.querySelectorAll('a[href]');
    for (var l=0;l<as2.length;l++){
      var t2=(as2[l].textContent||'').replace(/\\s+/g,' ').trim();
      if (t2 && GENERIC_LINK.test(t2)) res.genericLinks++;
    }
  } catch(e){}
  try {
    // 2.5.8 — 24×24px 미만 타깃 (문장 안 인라인 링크는 예외라 제외)
    var targets = document.querySelectorAll('a[href], button, input:not([type=hidden]), [role=button]');
    var limit2 = Math.min(targets.length, 60);
    for (var s=0;s<limit2;s++){
      var el2=targets[s];
      var st=getComputedStyle(el2);
      if (st.display==='inline') continue;
      var r=el2.getBoundingClientRect();
      if (r.width<=0 || r.height<=0) continue;
      res.targetSampled++;
      if ((r.width<24 || r.height<24) && res.smallTargets.length<6){
        res.smallTargets.push({ selector: cssPath(el2), html: el2.outerHTML.slice(0,200), size: Math.round(r.width)+'×'+Math.round(r.height) });
      }
    }
  } catch(e){}
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

function finding(ruleId: string, impact: Finding["impact"], nodes: Finding["nodes"]): Finding {
  return { ruleId, impact, tags: [], helpUrl: "", nodes };
}

export async function runCustomChecks(page: Page): Promise<CustomResult> {
  // 1) 현재 뷰포트에서 신호 수집 → 공용 판정 (확장과 동일 로직)
  const base = (await page.evaluate(BASE_SCRIPT)) as PageCheckSignals;
  const { violations, passes, incomplete } = customFindingsFromSignals(base);

  // 1.4.10 리플로우 — 320px 폭에서 가로 스크롤 발생 여부 (뷰포트 변경 필요 — 서버 전용)
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
