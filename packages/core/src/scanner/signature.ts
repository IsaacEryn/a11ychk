/**
 * 페이지 시그니처 추출 — 사이트 수준 성공기준(제목 유일성·일관된 내비게이션·
 * 여러 방법 등, WCAG-EM Phase C) 판정을 위한 페이지별 특징을 수집한다.
 * 페이지 컨텍스트에서 순수 JS로 실행(문자열 평가).
 */
import type { Page } from "playwright-core";
import type { PageSignature } from "../types";

const SIGNATURE_SCRIPT = `(function(){
  function txt(el){ return (el.textContent||'').replace(/\\s+/g,' ').trim().slice(0,60); }
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
  return {
    title: (document.title||'').trim(),
    navLinks: navLinks,
    hasSearch: hasSearch,
    hasSitemap: hasSitemap,
    hasMedia: !!document.querySelector('video, audio')
  };
})()`;

export async function extractPageSignature(page: Page): Promise<PageSignature> {
  const raw = (await page.evaluate(SIGNATURE_SCRIPT)) as Omit<PageSignature, "url">;
  return { url: page.url(), ...raw };
}
