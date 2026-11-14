import { createHash } from "node:crypto";
import type { NextRequest } from "next/server";
import { KWCAG_SLUGS } from "@a11ychk/core/catalog";
import { routing } from "@/i18n/routing";
import { layoutInlineScripts } from "@/lib/inlineScripts";
import { buildCsp, isStaticPagePath, scriptHosts } from "./cspPolicy.mjs";

/**
 * 콘텐츠 보안 정책 — script-src에서 'unsafe-inline'이 실제로 쓰이는 일이 없게 한다.
 *
 * CSP 헤더는 오직 프록시에서만 부여된다(next.config.ts의 headers()는 정적 헤더 담당).
 * 프록시 matcher가 어떤 HTML 경로를 빠뜨리면 그 페이지만 CSP 없이 나가므로,
 * matcher를 손볼 때는 HTML을 반환하는 경로가 빠지지 않는지 함께 확인할 것.
 *
 * 페이지 종류별 정책은 cspPolicy.mjs 머리말 참고. 요약하면 동적 페이지는 nonce, 정적 페이지는 빌드 어댑터가
 * HTML에 박은 해시(meta)가 스크립트를 허용한다.
 */

const hash = (s: string) => `'sha256-${createHash("sha256").update(s, "utf8").digest("base64")}'`;

// nonce를 뺀 나머지는 프로세스 수명 동안 고정이다(NEXT_PUBLIC_*은 빌드 시 인라인되고 NODE_ENV도 바뀌지
// 않는다). 모든 요청이 지나는 자리라 한 번만 조립해 둔다.
const ENV = {
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_GTM_ID: process.env.NEXT_PUBLIC_GTM_ID,
  BILLING_MODE: process.env.BILLING_MODE,
};
const isDev = process.env.NODE_ENV === "development";
const HOSTS = scriptHosts(ENV).join(" ");

const NONCE_MARK = "__NONCE__";
const [DYNAMIC_HEAD, DYNAMIC_TAIL] = buildCsp(
  // strict-dynamic: nonce·해시로 허용한 스크립트가 로드한 후속 스크립트(Next 청크·Turnstile api.js·gtm.js)까지 신뢰.
  // 해시는 레이아웃의 nonce 없는 인라인 스크립트(테마·로그인 힌트, GTM) — 레이아웃이 요청 헤더를 읽지 않아야
  // 정적 페이지가 나오므로 nonce를 달 수 없다.
  // 'self'·host·'unsafe-inline'은 strict-dynamic 미지원 구형 브라우저용 폴백(지원 브라우저는 무시).
  `'self' 'nonce-${NONCE_MARK}' 'strict-dynamic' ${layoutInlineScripts().map(hash).join(" ")}${isDev ? " 'unsafe-eval'" : ""} 'unsafe-inline' ${HOSTS}`,
  ENV,
).split(NONCE_MARK);

/**
 * 정적 페이지의 헤더 정책 — 스크립트의 "바깥 한계"만 정한다.
 *
 * 실제 허용 목록은 빌드 어댑터가 HTML에 박은 meta 정책(인라인 스크립트 해시)이다. 브라우저는 두 정책을
 * 모두 통과한 스크립트만 실행하므로 인라인은 meta의 해시에 든 것만 돈다. 여기에 해시나 nonce를 하나라도
 * 넣으면 이 정책의 'unsafe-inline'이 꺼져 RSC 페이로드 스크립트가 막히고, meta가 해시를 담당하므로
 * 넣을 이유도 없다. strict-dynamic도 넣지 않는다 — 'self'가 무시되어 Next 청크가 막힌다.
 *
 * meta는 frame-ancestors를 담을 수 없어 나머지 지시어는 이 헤더가 계속 맡는다.
 */
export const STATIC_PAGE_CSP = buildCsp(`'self' 'unsafe-inline' ${HOSTS}`, ENV);

const GUIDE_SLUGS: ReadonlySet<string> = new Set(KWCAG_SLUGS);

/**
 * 빌드 때 만든 HTML을 그대로 내보내는 경로인지. 개발 서버는 모든 페이지를 요청마다 렌더하므로 항상 아니다.
 *
 * 목록(cspPolicy.mjs의 STATIC_PAGE_PATHS)과 실제 빌드 결과가 어긋나면 빌드 어댑터가 실패한다 — 정적으로 만들어진
 * 페이지에 nonce 헤더를 붙이면 그 HTML의 스크립트가 전부 막히기 때문이다.
 */
export function isStaticPage(pathname: string): boolean {
  if (process.env.NODE_ENV !== "production") return false;
  return isStaticPagePath(pathname, { locales: routing.locales, guideSlugs: GUIDE_SLUGS });
}

/**
 * 없는 가이드 슬러그(/{locale}/guide/{모르는 슬러그})인지 — 프록시가 다른 오타 주소와 같은 로케일 404로 돌린다.
 *
 * 가이드 항목은 빌드 때 전부 만들어 두므로(dynamicParams = false) 모르는 슬러그에는 Next가 미리 만든 루트 404
 * HTML을 내보낸다. 로케일 레이아웃 밖이라 lang·제목이 없고, 정적 HTML이라 nonce가 없어 nonce 정책 아래에서
 * 스크립트가 전부 막힌다.
 */
export function isUnknownGuidePath(pathname: string): boolean {
  const m = /^\/([^/]+)\/guide\/([^/]+)$/.exec(pathname);
  return !!m && (routing.locales as readonly string[]).includes(m[1]) && !GUIDE_SLUGS.has(m[2]);
}

/**
 * nonce를 넣은 CSP를 요청 헤더에 실어 렌더러로 넘긴다 — 응답에 실을 CSP 문자열을 돌려준다(동적 페이지 전용).
 *
 * 응답을 만들기 전에 불러야 한다. next-intl 미들웨어가 이 시점의 요청 헤더를
 * 직렬화해 렌더러에 전달하고, Next는 CSP 요청 헤더에서 nonce를 읽어 자기 스크립트에
 * 자동 부여한다. 레이아웃의 인라인 스크립트는 nonce 대신 해시로 허용된다.
 */
export function attachCspToRequest(request: NextRequest): string {
  // 128비트 난수를 그대로 base64로 — UUID 문자열을 다시 인코딩하면 같은 엔트로피가
  // 48자로 늘어나고, 그 길이가 인라인 스크립트 태그마다 반복된다
  const nonce = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16))));
  const csp = DYNAMIC_HEAD + nonce + DYNAMIC_TAIL;
  request.headers.set("content-security-policy", csp);
  return csp;
}
