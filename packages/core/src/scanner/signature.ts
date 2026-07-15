/**
 * 페이지 시그니처 추출 — 사이트 수준 성공기준(제목 유일성·일관된 내비게이션·
 * 여러 방법 등, WCAG-EM Phase C) 판정을 위한 페이지별 특징과,
 * 점검자 확증용 수집 자료(대체 텍스트·폼 레이블·모호한 링크 텍스트)를 모은다.
 * 페이지 컨텍스트에서 순수 JS로 실행(문자열 평가).
 */
import type { Page } from "playwright-core";
import type { PageSignature } from "../types";

const SIGNATURE_SCRIPT = `(function(){
  function txt(el){ return (el.textContent||'').replace(/\\s+/g,' ').trim().slice(0,60); }
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
  var nav = document.querySelector('nav, [role=navigation]');
  var navLinks = [];
  if (nav){
    var as = nav.querySelectorAll('a[href]');
    for (var i=0;i<as.length && navLinks.length<40;i++){ var t=txt(as[i]); if(t) navLinks.push(t); }
  }
  var hasSearch = !!document.querySelector('input[type=search], [role=search], form[action*=search], input[name*=search i], input[id*=search i], input[name*=검색], input[placeholder*=검색]');
  var hasSitemap = false;
  var links = document.querySelectorAll('a[href]');
  for (var j=0;j<links.length;j++){
    var h=(links[j].getAttribute('href')||'').toLowerCase();
    var tt=txt(links[j]);
    if (h.indexOf('sitemap')>=0 || /sitemap|사이트\\s*맵/i.test(tt)) { hasSitemap=true; break; }
  }

  // ── 확인용 수집 자료 (값이 '있는' 경우만 — 없는 건 axe가 위반으로 잡는다) ──
  var review = { alts: [], labels: [], genericLinks: [] };
  try {
    var imgs = document.querySelectorAll('img[alt]');
    for (var a=0;a<imgs.length && review.alts.length<8;a++){
      var alt=(imgs[a].getAttribute('alt')||'').trim();
      if (alt) review.alts.push({ selector: cssPath(imgs[a]), text: alt.slice(0,120) });
    }
  } catch(e){}
  try {
    var ctrls = document.querySelectorAll('input:not([type=hidden]), select, textarea');
    for (var b=0;b<ctrls.length && review.labels.length<8;b++){
      var el=ctrls[b], label='';
      if (el.labels && el.labels.length>0) label=txt(el.labels[0]);
      if (!label) label=(el.getAttribute('aria-label')||'').trim();
      if (!label && el.getAttribute('title')) label=(el.getAttribute('title')||'').trim();
      if (label) review.labels.push({ selector: cssPath(el), text: label.slice(0,120) });
    }
  } catch(e){}
  try {
    var GENERIC=/^(여기|여기를?\\s*클릭|클릭(하세요)?|더\\s*보기|더보기|자세히(\\s*보기)?|바로\\s*가기|바로가기|here|click\\s*here|click|more|read\\s*more|learn\\s*more|go|link)$/i;
    for (var g=0;g<links.length && review.genericLinks.length<8;g++){
      var lt=txt(links[g]);
      if (lt && GENERIC.test(lt)) review.genericLinks.push({ selector: cssPath(links[g]), text: lt });
    }
  } catch(e){}

  return {
    title: (document.title||'').trim(),
    navLinks: navLinks,
    hasSearch: hasSearch,
    hasSitemap: hasSitemap,
    hasMedia: !!document.querySelector('video, audio'),
    review: review
  };
})()`;

export async function extractPageSignature(page: Page): Promise<PageSignature> {
  const raw = (await page.evaluate(SIGNATURE_SCRIPT)) as Omit<PageSignature, "url">;
  return { url: page.url(), ...raw };
}
