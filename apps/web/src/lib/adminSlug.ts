/**
 * 관리자 경로 슬러그 — ADMIN_PATH_SLUG env가 설정되면 배포별 비밀 경로
 * `/{locale}/{slug}/**`가 내부 `/{locale}/admin/**` 라우트로 서빙되고,
 * `/admin` 직접 접근은 404가 된다. 미설정(로컬 개발·포크)이면 기존 /admin 그대로.
 *
 * 주의: proxy(미들웨어)와 서버 컴포넌트가 함께 쓰므로 "server-only" import 금지.
 * 슬러그 값은 절대 NEXT_PUBLIC_·robots.txt·클라이언트 번들에 싣지 말 것 —
 * 클라이언트에는 서버가 계산한 경로 문자열(prop)만 전달한다.
 */

/** 슬러그로 쓸 수 없는 세그먼트 — 기존 라우트·matcher 제외 경로와의 충돌 방지 */
const RESERVED = new Set([
  "admin",
  "api",
  "auth",
  "billing",
  "demo",
  "join",
  "ko",
  "en",
  "login",
  "dashboard",
  "mypage",
  "scan",
  "scans",
  "site",
  "_next",
  "_vercel",
]);

/**
 * 형식: 소문자 영숫자+하이픈 4~64자. 점(.)은 금지 — 프록시 matcher가 정적 파일을
 * 확장자로 거르므로, 슬러그 끝이 확장자처럼 보이면 미들웨어가 실행되지 않는다.
 */
const SLUG_RE = /^[a-z0-9][a-z0-9-]{3,63}$/;

const INVALID_MESSAGE = "ADMIN_PATH_SLUG가 유효하지 않습니다. 소문자 영숫자·하이픈 4~64자(점 금지)이며 예약 경로와 겹칠 수 없습니다.";

/** 잘못된 슬러그를 이 프로세스에서 이미 기록했는지 — 매 요청 기록하지 않는다 */
let reportedInvalid = false;

/**
 * 던지지 않는 판정 — 프록시(매 요청)·헤더(매 페이지)가 쓴다. 슬러그가 잘못됐으면(형식·예약어) slug는 null, invalid는 true:
 * 호출부는 관리자 경로를 닫는다(슬러그 경로도 /admin도 404). 그대로 던지면 관리자 경로가 아니라 사이트 전체가 500이 된다.
 * 처음 한 번만 기록하고, 기록에는 슬러그 값을 넣지 않는다.
 */
export function readAdminSlug(): { slug: string | null; invalid: boolean } {
  const slug = process.env.ADMIN_PATH_SLUG;
  if (!slug) return { slug: null, invalid: false };
  if (!SLUG_RE.test(slug) || RESERVED.has(slug)) {
    if (!reportedInvalid) {
      reportedInvalid = true;
      console.error(`${INVALID_MESSAGE} 관리자 경로를 닫고 계속합니다.`);
    }
    return { slug: null, invalid: true };
  }
  return { slug, invalid: false };
}

/** 슬러그 — 잘못됐으면 던진다(설정 검증용). 요청 경로에서는 readAdminSlug를 쓴다 */
export function getAdminSlug(): string | null {
  const slug = process.env.ADMIN_PATH_SLUG;
  if (!slug) return null;
  if (!SLUG_RE.test(slug) || RESERVED.has(slug)) throw new Error(INVALID_MESSAGE);
  return slug;
}

/**
 * next-intl Link용 로케일 무접두 관리자 기준 경로 (예: "/console-x7k2" | "/admin").
 * 슬러그가 잘못됐으면 "/admin" — 프록시가 그 경로를 404로 가리므로 관리자 영역은 닫힌 채 나머지 화면은 그려진다.
 */
export function adminBase(): string {
  const { slug } = readAdminSlug();
  return slug ? `/${slug}` : "/admin";
}

/** 로케일 포함 절대 경로 (redirect·메일 링크용, 예: "/ko/console-x7k2") */
export function adminBasePath(locale: string): string {
  return `/${locale}${adminBase()}`;
}

const LOCALES = ["ko", "en"] as const;

/**
 * 외부(슬러그) 경로 → 내부 /admin 경로. 매치되지 않으면 null.
 * "/ko/console-x7k2" → "/ko/admin", "/ko/console-x7k2/users" → "/ko/admin/users"
 */
export function slugToInternal(pathname: string, slug: string): string | null {
  for (const locale of LOCALES) {
    const prefix = `/${locale}/${slug}`;
    if (pathname === prefix) return `/${locale}/admin`;
    if (pathname.startsWith(`${prefix}/`)) return `/${locale}/admin${pathname.slice(prefix.length)}`;
  }
  return null;
}

/** 내부 관리자 라우트 경로인지 (/admin, /ko/admin/**, /en/admin/**) — 직접 접근 차단 판정용 */
export function isInternalAdminPath(pathname: string): boolean {
  if (pathname === "/admin" || pathname.startsWith("/admin/")) return true;
  for (const locale of LOCALES) {
    const prefix = `/${locale}/admin`;
    if (pathname === prefix || pathname.startsWith(`${prefix}/`)) return true;
  }
  return false;
}

/** 요청 외부 경로가 관리자 영역인지 (무활동 쿠키 슬라이딩 판정용 — slug 유무 모두 대응, 잘못된 슬러그면 닫혀 있어 false) */
export function isExternalAdminPath(pathname: string): boolean {
  const { slug, invalid } = readAdminSlug();
  if (invalid) return false;
  if (!slug) return isInternalAdminPath(pathname);
  return slugToInternal(pathname, slug) !== null;
}
