/**
 * 라우트 응답 회귀 점검 — 빌드해서 띄운 앱에 실제로 요청을 보내 확인한다.
 *
 * 왜 있나: 없는 주소가 404 대신 200을 반환하던 적이 있었다(soft 404). 화면에는
 * 404가 잘 나와서 아무도 몰랐고, 구글이 오타 URL까지 크롤링하고 있었다. 원인은
 * [locale] 바로 아래 loading.tsx였다 — 그 아래가 전부 Suspense 경계에 들어가면
 * 셸이 200으로 먼저 나가고, 그 뒤엔 notFound()로도 상태 코드를 못 바꾼다.
 *
 * 유닛 테스트로는 이런 게 안 잡힌다. 렌더 결과가 아니라 **응답**을 봐야 한다.
 *
 * 사용법: 앱을 띄운 뒤 `node scripts/check-routes.mjs [baseUrl]`
 */
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

const BASE = process.argv[2] ?? "http://127.0.0.1:3210";
const READY_TIMEOUT_MS = 90_000;

/** [경로, 기대 상태코드, 이 검사가 지키려는 것, 메서드(없으면 GET)] */
const ROUTES = [
  ["/ko", 200, "한국어 홈"],
  ["/en", 200, "영문 홈"],
  ["/ko/about", 200, "정적 공개 페이지"],
  ["/ko/bot", 200, "크롤러 안내(검사 UA가 가리키는 주소)"],
  ["/ko/guide", 200, "가이드 허브"],
  ["/ko/guide/alternative-text", 200, "가이드 항목 상세(슬러그 해석)"],
  ["/ko/directory", 200, "DB를 읽는 공개 페이지"],
  ["/robots.txt", 200, "robots"],
  ["/sitemap.xml", 200, "sitemap"],

  // 아래 넷이 이 스크립트의 존재 이유다. 200이 나오면 soft 404가 돌아온 것이다.
  ["/ko/nonexistent", 404, "없는 경로 (global-not-found)"],
  ["/en/nonexistent", 404, "없는 경로 (영문)"],
  ["/ko/guide/nope", 404, "없는 슬러그 (동적 라우트의 notFound)"],
  ["/ko/dashboard/nope", 404, "차단 구간 하위의 없는 경로"],

  // AI 스킬·MCP 딥링크 — 랜딩 프리필은 200, 비로그인 /scan 딥링크는 로그인으로 리다이렉트
  ["/ko?url=https%3A%2F%2Fexample.com", 200, "딥링크 프리필 (랜딩)"],
  ["/ko/scan?url=https%3A%2F%2Fexample.com", 307, "딥링크 /scan (비로그인 → 로그인, next 보존)"],

  // 디렉터리 상세 — 미등재 호스트는 목록 기준 그대로 404
  ["/ko/directory/nonexistent-host.example", 404, "디렉터리 미등재 호스트"],

  // 프록시 matcher 과잉 포함 — HTML이 아닌 경로가 프록시를 타면 로케일 리다이렉트를
  // 맞고 죽는다. /site는 사용자가 자기 사이트에 붙여 둔 배지 링크의 진입점이라
  // 307(→ /ko/site/...)이 나오면 그 링크들이 전부 404가 된 것이다.
  ["/site/nonexistent-host.example", 302, "배지 리졸버 (프록시 미통과)"],
  ["/site/nonexistent-host.example?view=report", 302, "배지 리졸버 보고서 직행 (디렉터리 상세의 전체 보고서 링크)"],
  ["/sample/bad.html", 200, "public 정적 파일 (프록시 미통과)"],

  // 프록시를 건너뛰는 없는 주소 — 404로 끝나야 한다. 2026-11에 전부 500이었다: 이런 주소는 [locale]에
  // locale 값으로 걸리고, 정적 라우트의 notFound()가 넘어간 global-not-found가 요청 헤더를 읽다가 Next가 던졌다.
  // favicon·apple-touch-icon은 봇만이 아니라 브라우저와 iOS가 관례로 요청하는 주소다.
  ["/favicon.ico", 404, "확장자로 끝나는 없는 주소 (브라우저 관례 요청)"],
  ["/apple-touch-icon.png", 404, "확장자로 끝나는 없는 주소 (iOS 관례 요청)"],
  ["/sftp-config.json", 404, "확장자로 끝나는 없는 주소 (봇 탐색)"],
  ["/api", 404, "프록시 제외 접두어 자체"],
  ["/auth", 404, "프록시 제외 접두어 자체"],
  // 제외 접두어와 글자만 겹치는 주소는 다른 오타 URL처럼 프록시를 거친다(로케일 리다이렉트 뒤 404)
  ["/sites", 307, "제외 접두어와 글자만 겹침 (프록시 통과)"],
  ["/joinus", 307, "제외 접두어와 글자만 겹침 (프록시 통과)"],
  ["/sites/about", 307, "글자만 겹치는 접두어 + 정적 페이지 이름"],
  // 로케일로 시작하지만 확장자 때문에 프록시를 건너뛰는 없는 가이드 슬러그 — 상태코드는 원래 404였고,
  // 서버가 오류를 남기는지는 맨 끝의 서버 로그 검사가 본다
  ["/ko/guide/x.png", 404, "확장자가 붙은 없는 가이드 슬러그 (프록시 미통과)"],
  ["/api/scans/x", 404, "동적 route handler 접두어 아래의 없는 주소"],
  ["/api/scans/x/report", 404, "동적 route handler 접두어 아래의 없는 주소 (loading.tsx가 있는 페이지 모양)"],
  ["/_next/static/nope.js", 404, "없는 빌드 산출물"],
  // 없는 주소를 돌려보내는 rewrite(next.config.ts)가 route handler를 삼키면 안 된다
  ["/auth/callback", 307, "인증 콜백 (rewrite 미적용)"],
  ["/join/abc", 307, "초대 링크 (rewrite 미적용)"],
  ["/demo", 302, "데모 진입 (rewrite 미적용)"],
  ["/api/badge/example.com", 200, "배지 이미지 (rewrite 미적용)"],

  // 결제 모드 게이트 — 기본 빌드(BILLING_MODE 없음)에서는 결제 화면·토스 리다이렉트가 없어야 한다
  ["/ko/billing/checkout", 404, "결제 꺼짐(BILLING_MODE 없음)이면 결제 화면 없음"],
  ["/api/billing/toss/callback", 404, "결제 꺼짐이면 토스 콜백 없음"],
  ["/api/billing/toss/fail", 404, "결제 꺼짐이면 토스 실패 주소 없음"],
  ["/api/billing/webhooks/polar", 404, "결제 꺼짐이면 Polar 웹훅 없음(GET)"],
  ["/api/billing/webhooks/polar", 404, "결제 꺼짐이면 Polar 웹훅 없음(POST)", "POST"],
  ["/api/billing/polar/return", 404, "결제 꺼짐이면 Polar 결제창 복귀 주소 없음"],
  // 결제 관리는 마이페이지 아래라 마이페이지와 같다 — mypage/loading.tsx의 Suspense 경계 때문에 셸이 200으로 먼저 나가고
  // 비로그인 리다이렉트는 본문(meta refresh)으로 간다. 리다이렉트 대상은 아래 BODY_CHECKS가 본다
  ["/ko/mypage", 200, "마이페이지 (비로그인 → 본문 리다이렉트)"],
  ["/ko/mypage/billing", 200, "결제 관리 (비로그인 → 본문 리다이렉트)"],
];

/**
 * CSP — 페이지 종류마다 정책이 다르다(lib/security/cspPolicy.mjs 머리말).
 *
 * CSP 헤더는 프록시에서만 부여되므로 matcher가 어긋나면 그 경로만 조용히 정책 없이 나간다. 화면도 콘솔도
 * 멀쩡해서 눈에 띄지 않는다. 점이 든 경로(디렉터리 상세)는 실제로 이 구멍에 빠진 적이 있어 특히 지킨다.
 *
 * 두 목록 모두 "응답 HTML의 인라인 스크립트가 실효 정책(헤더 + meta)을 전부 통과하는지"를 직접 계산한다.
 * 정적 페이지 목록과 빌드 결과가 어긋나거나(nonce 헤더 + nonce 없는 HTML), 레이아웃 스크립트가 바뀌었는데
 * 해시가 안 따라오면 여기서 막힌 스크립트 수로 드러난다.
 */
/** 요청마다 렌더되는 페이지 — nonce 정책 */
const NONCE_ROUTES = [
  ["/ko/nonexistent", "없는 경로 404 (global-not-found)"],
  ["/ko/guide/nope", "없는 가이드 슬러그(런타임 404)"],
  ["/ko/directory/nonexistent-host.example", "점이 든 경로"],
  ["/ko/login", "로그인"],
];
/** 빌드 때 만든 HTML — 헤더는 바깥 한계, 인라인 스크립트는 HTML의 meta 해시 정책이 허용 */
const STATIC_ROUTES = [
  ["/ko", "로케일 홈"],
  ["/en", "영문 홈"],
  ["/ko?url=https%3A%2F%2Fexample.com", "홈 딥링크(검색어가 붙어도 정적)"],
  ["/ko/about", "소개"],
  ["/ko/guide", "가이드 허브"],
  ["/ko/guide/alternative-text", "동적 세그먼트(가이드 항목)"],
  ["/en/guide/text-contrast", "가이드 항목(영문)"],
];

const INLINE_JS_TYPES = new Set(["", "text/javascript", "application/javascript", "module"]);

/** 응답 HTML의 실행되는 인라인 스크립트 — [nonce 속성, sha256 출처 표현] */
function inlineScripts(html) {
  const out = [];
  for (const [, attrs, body] of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    if (/\ssrc\s*=/i.test(attrs)) continue;
    const type = /\stype\s*=\s*"([^"]*)"/i.exec(attrs)?.[1]?.trim().toLowerCase() ?? "";
    if (!INLINE_JS_TYPES.has(type)) continue;
    const nonce = /\snonce\s*=\s*"([^"]*)"/i.exec(attrs)?.[1] ?? null;
    out.push([nonce, `'sha256-${createHash("sha256").update(body, "utf8").digest("base64")}'`]);
  }
  return out;
}

/** 정책 문자열의 script-src 출처 목록(없으면 null) */
function scriptSources(policy) {
  const d = policy
    .split(";")
    .map((x) => x.trim())
    .find((x) => x.startsWith("script-src "));
  return d ? d.split(/\s+/).slice(1) : null;
}

/** CSP3 규칙대로 인라인 스크립트 허용 여부 — nonce·해시가 하나라도 있으면 'unsafe-inline'은 무시된다 */
function allowsInline(sources, nonce, hash) {
  if (nonce && sources.includes(`'nonce-${nonce}'`)) return true;
  if (sources.includes(hash)) return true;
  const strict = sources.some((s) => /^'(nonce|sha256|sha384|sha512)-/.test(s));
  return !strict && sources.includes("'unsafe-inline'");
}

/** 응답의 인라인 스크립트 중 막히는 수 — 정책이 여러 개면 모두 통과해야 실행된다 */
function blockedInline(html, policies) {
  const lists = policies.map(scriptSources);
  if (lists.some((l) => l === null)) return { blocked: -1, total: 0 };
  const scripts = inlineScripts(html);
  const blocked = scripts.filter(([nonce, hash]) => !lists.every((l) => allowsInline(l, nonce, hash))).length;
  return { blocked, total: scripts.length };
}

const metaPolicies = (html) =>
  [...html.matchAll(/<meta http-equiv="Content-Security-Policy" content="([^"]*)"\/?>/gi)].map((m) => m[1]);

/**
 * 응답에 들어 있어야 하는 것 — 조용히 빠져도 화면상 티가 안 나는 축이라 같이 본다.
 *
 * hreflang을 대소문자 무시로 찾는 이유: React는 hrefLang 프로퍼티를 그대로 직렬화해서
 * 원본 HTML에는 `hrefLang=`으로 찍힌다. HTML 속성명은 대소문자를 가리지 않으므로
 * 브라우저와 검색엔진은 hreflang으로 읽는다. 주소는 빌드 시점 NEXT_PUBLIC_SITE_URL에
 * 따라 달라지므로 호스트는 보지 않는다.
 */
const BODY_CHECKS = [
  ["/ko", /rel="canonical"/i, "canonical"],
  ["/ko", /hreflang="x-default"/i, "hreflang x-default"],
  ["/ko", /"@type":"FAQPage"/, "FAQ 구조화 데이터"],
  ["/ko/guide/alternative-text", /"@type":"HowTo"/, "가이드 항목 구조화 데이터"],
  // SEO 회귀 — sitemap에서 로그인 게이트 제거·x-default 유지, 허브 ItemList, 가이드 상호 링크
  ["/sitemap.xml", /x-default/, "sitemap x-default"],
  ["/ko/guide", /"@type":"ItemList"/, "가이드 허브 ItemList"],
  // KWCAG 번호 표기 — 공식 순서의 일련번호와 KS X OT0003:2022 번호를 함께 싣는다
  ["/ko/guide/table-structure", /KWCAG 2\.2 검사항목 3(?!\d)/, "가이드 상세 — 일련번호"],
  ["/ko/guide/table-structure", /KS X OT0003 5\.3\.1(?!\d)/, "가이드 상세 — 공식 번호"],
  ["/en/guide/text-contrast", /Checkpoint 8(?!\d)/, "가이드 상세(en) — 일련번호"],
  // 공유 카드 — 페이지마다 자기 og:url을 낸다(없으면 전 페이지가 홈 미리보기를 공유하던 회귀)
  ["/ko/about", /property="og:url" content="[^"]*\/ko\/about"/, "og:url 자기 경로(정적 페이지)"],
  ["/ko/guide/alternative-text", /property="og:url" content="[^"]*\/ko\/guide\/alternative-text"/, "og:url 자기 경로(가이드 항목)"],
  ["/en", /property="og:image" content="[^"]*\/opengraph-image-en\.png"/, "영문 OG 이미지"],
  ["/en/guide", /rel="canonical" href="[^"]*\/en\/guide"/, "영문 canonical"],
  ["/en/guide", /hreflang="ko" href="[^"]*\/ko\/guide"/i, "영문 페이지의 hreflang 짝"],
  // 색인 거부 — 요금제(시행 전)·로그인
  ["/ko/pricing", /<meta name="robots" content="noindex/, "요금제 noindex"],
  ["/ko/login", /<meta name="robots" content="noindex/, "로그인 noindex"],
  // breadcrumb 구조화 데이터가 화면처럼 홈에서 시작
  ["/ko/guide/alternative-text", /"@type":"ListItem","position":1,"name":"홈"/, "가이드 항목 breadcrumb 홈"],
  // 비로그인 결제 관리 → 로그인, 돌아올 주소 보존(결제 모드와 무관하게 로그인이 먼저)
  ["/ko/mypage/billing", /\/ko\/login\?next=%2Fko%2Fmypage%2Fbilling/, "결제 관리 비로그인 → 로그인(next 보존)"],
  // 프록시를 안 거친 없는 주소도 오류 껍데기가 아니라 lang 있는 404 문서로 나간다
  ["/apple-touch-icon.png", /<html\b[^>]*\blang="ko"/, "프록시 미통과 404 문서의 lang"],
];

/** sitemap.xml에 있으면 안 되는 것 — 로그인 게이트 주소를 색인 요청하지 않는다 */
const BODY_ABSENT = [
  ["/sitemap.xml", /\/ko\/scan</, "sitemap에 /scan 없음"],
  // 하위 페이지·404가 홈 제목을 물려받지 않는다
  ["/ko/about", /property="og:title" content="웹접근성 점검 도구 —/, "하위 페이지 og:title이 홈 제목 아님"],
  ["/ko/nonexistent", /<title>웹접근성 점검 도구 —/, "404 title이 홈 제목 아님"],
  // noindex 페이지는 canonical을 내지 않는다(신호 충돌)
  ["/ko/login", /rel="canonical"/, "로그인에 canonical 없음"],
  ["/ko/pricing", /rel="canonical"/, "요금제에 canonical 없음"],
];

/**
 * 404 화면이 서버 HTML에서 완성돼 나오는지 — [경로, lang, 제목 앞부분(앱 이름 앞까지)].
 *
 * 렌더 중에 던진 notFound()는 동적 렌더에서 서버가 잡지 못해 lang도 본문도 없는
 * <html id="__next_error__"> 껍데기로 나간다. 브라우저는 JS로 다시 그리니 화면만 봐서는
 * 모르고, 원본 HTML을 읽는 검색엔진·스크린 리더 이전 단계·JS 없는 환경에서만 드러난다.
 * 그래서 없는 주소는 global-not-found가 그리게 했고, 여기서 그 결과를 지킨다.
 */
const NOT_FOUND_DOCS = [
  ["/ko/nonexistent", "ko", "페이지를 찾을 수 없습니다"],
  ["/en/nonexistent", "en", "Page not found"],
  // 없는 가이드 슬러그는 프록시가 /{locale}/__404__로 돌려 같은 화면이 된다(isUnknownGuidePath)
  ["/ko/guide/nope", "ko", "페이지를 찾을 수 없습니다"],
];

/**
 * 숨긴 관리자 경로와 견줄 오타 URL. 두 응답에는 각자 자기 요청 경로가 실린다(라우터 상태의
 * URL, hreflang 헤더). 그래서 두 세그먼트 이름을 양쪽 응답에서 똑같이 지우고 비교한다.
 * 한쪽 이름만 지우면 본문 메시지에 원래 있는 "/admin/*" 같은 낱말이 한쪽에서만 바뀐다.
 *
 * x-middleware-rewrite는 비교에서 뺀다. next start는 rewrite 대상을 이 응답 헤더로 내보내지만
 * Vercel은 지워서 내보낸다 — 이 검사는 운영과 같은 조건인 상태코드·본문·나머지 헤더를 본다.
 */
const MASK_PAIR = ["/ko/admin", "/ko/adnin"];
const MASK_IGNORED_HEADERS = new Set(["date", "x-middleware-rewrite"]);

/**
 * 빌드 결과에서 만드는 검사 — 주소를 손으로 적으면 정적 페이지나 route handler가 늘 때 따라가지 못한다.
 *
 * 프록시는 route handler·플랫폼 접두어로 시작하는 주소를 건너뛴다. 그 뒤에 [locale] 아래 정적 페이지 이름이
 * 붙으면(/api/about은 locale이 "api"인 소개 페이지다) 정적 라우트에 걸려 500이 났다.
 * 이 목록은 src/proxy.ts의 matcher가 건너뛰는 접두어와 같아야 한다 — matcher에 접두어를 더하면 여기에도 더한다.
 */
const SKIPPED_PREFIXES = ["api", "auth", "demo", "join", "site", "_next", "_vercel"];

/** 빌드 산출물(.next)의 파일 — 스크립트 위치 기준이라 어디서 실행해도 같다. 없으면 null */
async function readBuildFile(name) {
  try {
    return await readFile(new URL(`../.next/${name}`, import.meta.url), "utf8");
  } catch {
    return null;
  }
}

/** Next 런타임은 라우트를 대소문자 구분 없이 맞춘다(caseSensitiveRoutes 미사용) */
const routeRegex = (r) => new RegExp(r.regex, "i");

/** [locale] 정적 라우트마다 하나씩, 로케일을 프록시 제외 접두어로 바꾼 주소 — 실제 라우트와 겹치는 것은 뺀다 */
function shadowedStaticPaths(prerender, routes) {
  const outsideLocale = [...routes.staticRoutes, ...routes.dynamicRoutes]
    .filter((r) => !r.page.startsWith("/[locale]"))
    .map(routeRegex);
  const restBySource = new Map();
  for (const [path, info] of Object.entries(prerender.routes)) {
    // 홈("/[locale]")은 /api·/auth 자체라 ROUTES가 본다
    if (!info.srcRoute?.startsWith("/[locale]/") || restBySource.has(info.srcRoute)) continue;
    restBySource.set(info.srcRoute, path.split("/").slice(2).join("/"));
  }
  return [...restBySource.values()]
    .flatMap((rest) => SKIPPED_PREFIXES.map((prefix) => `/${prefix}/${rest}`))
    .filter((path) => !outsideLocale.some((re) => re.test(path)));
}

/**
 * 없는 주소용 rewrite에 걸리는 동적 route handler — rewrite(afterFiles)는 정적 라우트 다음, 동적 라우트보다
 * 먼저 적용된다. 그래서 [locale] 밖의 동적 라우트는 next.config.ts의 제외 접두어에 들어 있어야 한다.
 */
function swallowedHandlers(routes) {
  const rewrites = (routes.rewrites?.afterFiles ?? []).map(routeRegex);
  return routes.dynamicRoutes
    .filter((r) => !r.page.startsWith("/[locale]"))
    .map((r) => r.page.replace(/\[[^\]]+\]/g, "x"))
    .filter((sample) => rewrites.some((re) => re.test(sample)));
}

/**
 * 요청을 다 보낸 뒤 서버 로그에 남은 오류 — 상태코드만으로는 안 보이는 것을 잡는다. 없는 주소가 404로 나가면서도
 * 서버가 처리되지 않은 오류를 남기면 instrumentation이 그것을 기록하고 관리자에게 메일을 보낸다.
 * ROUTES_SERVER_LOG에 `next start`의 출력 파일 경로를 주면 본다.
 */
async function serverLogErrors(path) {
  // 마지막 요청의 로그가 파일에 닿을 시간을 준다
  await new Promise((r) => setTimeout(r, 1000));
  const lines = (await readFile(path, "utf8")).split("\n").filter((line) => /⨯|\bError\b/.test(line));
  const counts = new Map();
  for (const line of lines) counts.set(line.trim(), (counts.get(line.trim()) ?? 0) + 1);
  return [...counts].map(([line, n]) => `${line} (${n}번)`);
}

async function fetchNormalized(path) {
  const res = await fetch(`${BASE}${path}`, { redirect: "manual" });
  const nonce = (res.headers.get("content-security-policy") ?? "").match(/'nonce-([^']+)'/)?.[1];
  const segments = new RegExp(MASK_PAIR.map((p) => p.split("/").pop()).join("|"), "g");
  const normalize = (text) => (nonce ? text.split(nonce).join("NONCE") : text).replace(segments, "SEG");
  const headers = [...res.headers]
    .filter(([key]) => !MASK_IGNORED_HEADERS.has(key))
    .map(([key, value]) => `${key}: ${normalize(value)}`)
    .sort();
  return { status: res.status, headers, body: normalize(await res.text()) };
}

async function waitForReady() {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE}/ko`, { redirect: "manual" });
      if (res.status > 0) return;
    } catch {
      // 아직 안 떴다 — 다시 시도
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`${BASE} 가 ${READY_TIMEOUT_MS / 1000}초 안에 뜨지 않았다`);
}

async function main() {
  await waitForReady();
  const failures = [];

  for (const [path, expected, what, method = "GET"] of ROUTES) {
    const res = await fetch(`${BASE}${path}`, { method, redirect: "manual", ...(method === "POST" ? { body: "{}" } : {}) });
    const ok = res.status === expected;
    const label = method === "GET" ? path : `${method} ${path}`;
    console.log(`  ${ok ? "✓" : "✗"} ${String(res.status).padEnd(3)} ${label.padEnd(30)} ${what}`);
    if (!ok) failures.push(`${label} — ${expected} 기대, ${res.status} 받음 (${what})`);
  }

  // 딥링크 리다이렉트가 next에 ?url= 을 보존하는지 — 상태 코드만으로는 파라미터
  // 소실(과거 next 없는 redirect 버그)이 안 잡힌다
  {
    const res = await fetch(`${BASE}/ko/scan?url=https%3A%2F%2Fexample.com`, { redirect: "manual" });
    const loc = res.headers.get("location") ?? "";
    const ok = loc.includes("next=") && loc.includes(encodeURIComponent("url=https"));
    console.log(`  ${ok ? "✓" : "✗"} ${"/ko/scan?url= → login".padEnd(34)} next에 딥링크 보존`);
    if (!ok) failures.push(`/ko/scan?url= 리다이렉트가 next에 url을 보존하지 않음 (location: ${loc})`);
  }

  // 빌드 결과에서 만드는 검사 — 다른 서버를 상대로 돌릴 때처럼 .next가 없으면 건너뛴다
  console.log("");
  let derived = 0;
  const [buildId, prerenderJson, routesJson] = await Promise.all(
    ["BUILD_ID", "prerender-manifest.json", "routes-manifest.json"].map(readBuildFile),
  );
  // 띄운 서버가 이 .next로 만든 것인지 — 다른 빌드의 매니페스트로 검사하면 통과해도 뜻이 없다
  const sameBuild = buildId && (await fetch(`${BASE}/ko`).then((r) => r.text())).includes(buildId.trim());
  if (sameBuild && prerenderJson && routesJson) {
    const [prerender, routesManifest] = [JSON.parse(prerenderJson), JSON.parse(routesJson)];
    const hasRewrite = (routesManifest.rewrites?.afterFiles ?? []).length > 0;
    derived++;
    console.log(`  ${hasRewrite ? "✓" : "✗"} ${"없는 주소 rewrite".padEnd(34)} 빌드에 들어 있음`);
    if (!hasRewrite) failures.push("없는 주소를 404로 보내는 rewrite(next.config.ts)가 빌드에 없다");
    for (const path of shadowedStaticPaths(prerender, routesManifest)) {
      const res = await fetch(`${BASE}${path}`, { redirect: "manual" });
      const ok = res.status === 404;
      derived++;
      console.log(`  ${ok ? "✓" : "✗"} ${String(res.status).padEnd(3)} ${path.padEnd(30)} 프록시 제외 접두어 + 정적 페이지 이름`);
      if (!ok) failures.push(`${path} — 404 기대, ${res.status} 받음 (프록시 제외 접두어 + 정적 페이지 이름)`);
    }
    // 점이 든 가이드 슬러그는 rewrite가 404로 보낸다(next.config.ts) — 실제 슬러그에 점이 생기면 그 페이지가 사라진다
    const dotted = Object.keys(prerender.routes).filter((p) => /^\/[^/]+\/guide\/[^/]*\.[^/]*$/.test(p));
    derived++;
    console.log(`  ${dotted.length === 0 ? "✓" : "✗"} ${"가이드 슬러그".padEnd(34)} 점이 든 슬러그 없음`);
    for (const p of dotted) failures.push(`${p} — 가이드 슬러그에 점이 있다 (next.config.ts의 rewrite가 404로 보낸다)`);
    const swallowed = swallowedHandlers(routesManifest);
    derived++;
    console.log(`  ${swallowed.length === 0 ? "✓" : "✗"} ${"[locale] 밖 동적 라우트".padEnd(34)} 없는 주소 rewrite에 걸리지 않음`);
    for (const sample of swallowed) {
      failures.push(`${sample} — 동적 route handler가 없는 주소 rewrite에 걸린다 (next.config.ts의 제외 접두어에 넣을 것)`);
    }
  } else {
    console.log(`  - ${".next 매니페스트".padEnd(34)} 이 서버의 빌드 결과가 없어 빌드 결과 기반 검사를 건너뜀`);
  }

  console.log("");
  for (const [path, pattern, what] of BODY_CHECKS) {
    const html = await fetch(`${BASE}${path}`).then((r) => r.text());
    const ok = pattern.test(html);
    console.log(`  ${ok ? "✓" : "✗"} ${path.padEnd(34)} ${what}`);
    if (!ok) failures.push(`${path} — ${what}(${pattern})가 응답에 없다`);
  }

  console.log("");
  for (const [path, what] of NONCE_ROUTES) {
    const res = await fetch(`${BASE}${path}`, { redirect: "manual" });
    const csp = res.headers.get("content-security-policy") ?? "";
    const html = await res.text();
    const nonce = csp.match(/'nonce-([^']+)'/)?.[1];
    // 헤더에 nonce가 있어도 렌더러까지 전달이 끊기면 Next 스크립트가 막힌다 — 본문의 nonce 속성까지 본다
    const { blocked, total } = blockedInline(html, [csp]);
    const problems = [
      !nonce && "CSP nonce 헤더 없음 — 프록시 matcher에서 빠졌는지 확인",
      nonce && !html.includes(`nonce="${nonce}"`) && "응답 CSP의 nonce가 본문 script 태그에 없다 (요청 헤더 전달 경로 확인)",
      metaPolicies(html).length > 0 && "동적 페이지에 정적 페이지용 meta CSP가 있다",
      blocked !== 0 && `인라인 스크립트 ${total}개 중 ${blocked < 0 ? "?" : blocked}개가 정책에 막힌다`,
    ].filter(Boolean);
    console.log(`  ${problems.length === 0 ? "✓" : "✗"} ${path.padEnd(34)} CSP nonce, 인라인 ${total}개 통과 (${what})`);
    for (const p of problems) failures.push(`${path} — ${p} (${what})`);
  }

  for (const [path, what] of STATIC_ROUTES) {
    const res = await fetch(`${BASE}${path}`, { redirect: "manual" });
    const csp = res.headers.get("content-security-policy") ?? "";
    const html = await res.text();
    const metas = metaPolicies(html);
    const { blocked, total } = blockedInline(html, [csp, ...metas]);
    const problems = [
      res.status !== 200 && `상태 ${res.status}`,
      !csp.includes("script-src") && "CSP 헤더 없음 — 프록시 matcher에서 빠졌는지 확인",
      /'nonce-|'strict-dynamic'|'sha256-/.test(csp) && "정적 페이지 헤더에 nonce·해시·strict-dynamic — meta 정책과 겹쳐 RSC 스크립트가 막힌다",
      metas.length !== 1 && `meta CSP ${metas.length}개 — 빌드 어댑터(csp-adapter)가 돌았는지 확인`,
      metas.some((m) => m.includes("'unsafe-inline'")) && "meta 정책에 'unsafe-inline'",
      // 정적 HTML을 그대로 내보냈는지 — 요청마다 렌더됐다면 이 페이지의 CPU 절감이 사라진 것이다
      // (Next가 이 헤더를 두 번 실어 "1, 1"로 합쳐 오기도 한다)
      !/\b1\b/.test(res.headers.get("x-nextjs-prerender") ?? "") && "프리렌더 응답이 아니다(x-nextjs-prerender 없음) — 요청마다 렌더되고 있다",
      blocked !== 0 && `인라인 스크립트 ${total}개 중 ${blocked < 0 ? "?" : blocked}개가 정책에 막힌다`,
    ].filter(Boolean);
    console.log(`  ${problems.length === 0 ? "✓" : "✗"} ${path.padEnd(34)} 정적 + 해시 CSP, 인라인 ${total}개 통과 (${what})`);
    for (const p of problems) failures.push(`${path} — ${p} (${what})`);
  }

  console.log("");
  for (const [path, pattern, what] of BODY_ABSENT) {
    const html = await fetch(`${BASE}${path}`).then((r) => r.text());
    const ok = !pattern.test(html);
    console.log(`  ${ok ? "✓" : "✗"} ${path.padEnd(34)} ${what}`);
    if (!ok) failures.push(`${path} — ${what} 위반 (${pattern} 발견)`);
  }

  console.log("");
  for (const [path, lang, title] of NOT_FOUND_DOCS) {
    const res = await fetch(`${BASE}${path}`);
    const nonce = (res.headers.get("content-security-policy") ?? "").match(/'nonce-([^']+)'/)?.[1];
    const html = await res.text();
    const checks = [
      [new RegExp(`<html\\b[^>]*\\blang="${lang}"`).test(html), `<html lang="${lang}">`],
      // 프록시를 안 거친 요청용 이중 언어 화면("… · Page not found — …")과 구별하려고 앱 이름 앞 구분자까지 본다
      [html.includes(`<title>${title} — `), `로케일 제목(${title})`],
      [/<h1\b/.test(html), "본문(h1)이 서버 HTML에 있음"],
      [/<main id="main"/.test(html) && html.includes('class="skip-link"'), "로케일 문서 골격(건너뛰기 링크·main)"],
      [!html.includes('id="__next_error__"'), "오류 껍데기(__next_error__) 아님"],
      [!!nonce && html.includes(`nonce="${nonce}"`), "nonce가 렌더러까지 전달됨"],
    ];
    for (const [ok, what] of checks) {
      console.log(`  ${ok ? "✓" : "✗"} ${path.padEnd(34)} 404 ${what}`);
      if (!ok) failures.push(`${path} — 404 문서: ${what} 실패`);
    }
  }

  // 숨긴 관리자 경로는 오타 URL과 구별되면 안 된다. 슬러그가 설정돼 있어야 /admin이 숨으므로
  // ADMIN_PATH_SLUG가 있을 때만 본다(CI의 이 단계는 자리표시자 슬러그로 띄운다).
  if (process.env.ADMIN_PATH_SLUG) {
    const [masked, typo] = await Promise.all(MASK_PAIR.map(fetchNormalized));
    const headerDiff = [
      ...masked.headers.filter((h) => !typo.headers.includes(h)).map((h) => `숨긴 경로에만: ${h}`),
      ...typo.headers.filter((h) => !masked.headers.includes(h)).map((h) => `오타 URL에만: ${h}`),
    ];
    const same = [
      [masked.status === 404 && typo.status === 404, `상태코드 (${masked.status} / ${typo.status})`],
      [headerDiff.length === 0, `헤더${headerDiff.length ? ` — ${headerDiff.join("; ")}` : ""}`],
      [masked.body === typo.body, "본문"],
    ];
    for (const [ok, what] of same) {
      console.log(`  ${ok ? "✓" : "✗"} ${MASK_PAIR.join(" ↔ ").padEnd(34)} 숨긴 경로와 오타 URL — ${what} 일치`);
      if (!ok) failures.push(`/ko/admin이 오타 URL과 구별된다 — ${what}`);
    }
  } else {
    console.log(`  - ${MASK_PAIR.join(" ↔ ").padEnd(34)} ADMIN_PATH_SLUG가 없어 숨긴 경로 비교를 건너뜀`);
  }

  // 위의 요청들이 서버에 오류를 남기지 않았는지 — 맨 끝에 본다
  if (process.env.ROUTES_SERVER_LOG) {
    const errors = await serverLogErrors(process.env.ROUTES_SERVER_LOG);
    derived++;
    console.log(`  ${errors.length === 0 ? "✓" : "✗"} ${"서버 로그".padEnd(34)} 처리되지 않은 오류 없음`);
    for (const e of errors) failures.push(`서버 로그에 오류가 남았다 — ${e}`);
  } else {
    console.log(`  - ${"서버 로그".padEnd(34)} ROUTES_SERVER_LOG가 없어 서버 로그 검사를 건너뜀`);
  }

  if (failures.length > 0) {
    console.error(`\n실패 ${failures.length}건:`);
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log(`\n${ROUTES.length + derived + BODY_CHECKS.length + NONCE_ROUTES.length + STATIC_ROUTES.length + BODY_ABSENT.length}건 모두 통과`);
}

main().catch((e) => {
  console.error(e.message ?? e);
  process.exit(1);
});
