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
 * 형식: 소문자 영숫자+하이픈 4~64자. 점(.)은 금지 — proxy matcher가
 * `.*\..*`(정적 파일)를 제외하므로 점이 있으면 미들웨어 자체가 실행되지 않는다.
 */
const SLUG_RE = /^[a-z0-9][a-z0-9-]{3,63}$/;

export function getAdminSlug(): string | null {
  const slug = process.env.ADMIN_PATH_SLUG;
  if (!slug) return null;
  if (!SLUG_RE.test(slug) || RESERVED.has(slug)) {
    throw new Error(
      "ADMIN_PATH_SLUG가 유효하지 않습니다. 소문자 영숫자·하이픈 4~64자(점 금지)이며 예약 경로와 겹칠 수 없습니다.",
    );
  }
  return slug;
}

/** next-intl Link용 로케일 무접두 관리자 기준 경로 (예: "/console-x7k2" | "/admin") */
export function adminBase(): string {
  const slug = getAdminSlug();
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

/** 요청 외부 경로가 관리자 영역인지 (무활동 쿠키 슬라이딩 판정용 — slug 유무 모두 대응) */
export function isExternalAdminPath(pathname: string): boolean {
  const slug = getAdminSlug();
  if (!slug) return isInternalAdminPath(pathname);
  return slugToInternal(pathname, slug) !== null;
}
