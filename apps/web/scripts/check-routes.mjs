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
const BASE = process.argv[2] ?? "http://127.0.0.1:3210";
const READY_TIMEOUT_MS = 90_000;

/** [경로, 기대 상태코드, 이 검사가 지키려는 것] */
const ROUTES = [
  ["/ko", 200, "한국어 홈"],
  ["/en", 200, "영문 홈"],
  ["/ko/about", 200, "정적 공개 페이지"],
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
  ["/sample/bad.html", 200, "public 정적 파일 (프록시 미통과)"],
];

/**
 * CSP 헤더가 반드시 붙어야 하는 경로 — CSP는 프록시에서만 부여되므로 matcher가
 * 어긋나면 그 경로만 조용히 정책 없이 나간다. 화면도 콘솔도 멀쩡해서 눈에 띄지 않는다.
 * 점이 든 경로(디렉터리 상세)는 실제로 이 구멍에 빠진 적이 있어 특히 지킨다.
 */
const CSP_ROUTES = [
  ["/ko", "로케일 홈"],
  ["/ko/nonexistent", "catch-all 404 페이지"],
  ["/ko/guide/alternative-text", "동적 세그먼트"],
  ["/ko/directory/nonexistent-host.example", "점이 든 경로"],
];

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
];

/** sitemap.xml에 있으면 안 되는 것 — 로그인 게이트 주소를 색인 요청하지 않는다 */
const BODY_ABSENT = [["/sitemap.xml", /\/ko\/scan</, "sitemap에 /scan 없음"]];

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

  for (const [path, expected, what] of ROUTES) {
    const res = await fetch(`${BASE}${path}`, { redirect: "manual" });
    const ok = res.status === expected;
    console.log(`  ${ok ? "✓" : "✗"} ${String(res.status).padEnd(3)} ${path.padEnd(30)} ${what}`);
    if (!ok) failures.push(`${path} — ${expected} 기대, ${res.status} 받음 (${what})`);
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
  for (const [path, what] of CSP_ROUTES) {
    const res = await fetch(`${BASE}${path}`, { redirect: "manual" });
    const csp = res.headers.get("content-security-policy") ?? "";
    const ok = csp.includes("script-src") && /'nonce-[^']+'/.test(csp);
    console.log(`  ${ok ? "✓" : "✗"} ${path.padEnd(34)} CSP nonce (${what})`);
    if (!ok) failures.push(`${path} — CSP nonce 헤더 없음 (${what}) — 프록시 matcher에서 빠졌는지 확인`);
  }

  // 헤더에 nonce가 있어도 렌더러까지 전달이 끊기면 인라인 스크립트가 막힌다.
  // 응답 CSP의 nonce와 본문의 nonce 속성이 같은 값인지 확인해 배관 전체를 본다.
  {
    const res = await fetch(`${BASE}/ko`);
    const nonce = (res.headers.get("content-security-policy") ?? "").match(/'nonce-([^']+)'/)?.[1];
    const html = await res.text();
    const ok = !!nonce && html.includes(`nonce="${nonce}"`);
    console.log(`  ${ok ? "✓" : "✗"} ${"/ko".padEnd(34)} nonce가 렌더러까지 전달됨`);
    if (!ok) failures.push("/ko — 응답 CSP의 nonce가 본문 script 태그에 없다 (요청 헤더 전달 경로 확인)");
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
  console.log(`\n${ROUTES.length + BODY_CHECKS.length + CSP_ROUTES.length}건 모두 통과`);
}

main().catch((e) => {
  console.error(e.message ?? e);
  process.exit(1);
});
