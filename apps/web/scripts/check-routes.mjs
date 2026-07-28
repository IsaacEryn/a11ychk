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

  for (const [path, expected, what] of ROUTES) {
    const res = await fetch(`${BASE}${path}`, { redirect: "manual" });
    const ok = res.status === expected;
    console.log(`  ${ok ? "✓" : "✗"} ${String(res.status).padEnd(3)} ${path.padEnd(30)} ${what}`);
    if (!ok) failures.push(`${path} — ${expected} 기대, ${res.status} 받음 (${what})`);
  }

  console.log("");
  for (const [path, pattern, what] of BODY_CHECKS) {
    const html = await fetch(`${BASE}${path}`).then((r) => r.text());
    const ok = pattern.test(html);
    console.log(`  ${ok ? "✓" : "✗"} ${path.padEnd(34)} ${what}`);
    if (!ok) failures.push(`${path} — ${what}(${pattern})가 응답에 없다`);
  }

  if (failures.length > 0) {
    console.error(`\n실패 ${failures.length}건:`);
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log(`\n${ROUTES.length + BODY_CHECKS.length}건 모두 통과`);
}

main().catch((e) => {
  console.error(e.message ?? e);
  process.exit(1);
});
