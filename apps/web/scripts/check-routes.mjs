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
  ["/ko/nonexistent", 404, "없는 경로 (catch-all)"],
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
  ["/ko/nonexistent", "catch-all 404 페이지"],
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
      metas.length !== 1 && `meta CSP ${metas.length}개 — 빌드 후처리(csp-static-pages)가 돌았는지 확인`,
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

  if (failures.length > 0) {
    console.error(`\n실패 ${failures.length}건:`);
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log(`\n${ROUTES.length + BODY_CHECKS.length + NONCE_ROUTES.length + STATIC_ROUTES.length + BODY_ABSENT.length}건 모두 통과`);
}

main().catch((e) => {
  console.error(e.message ?? e);
  process.exit(1);
});
