/**
 * URL 템플릿 클러스터링 — 반복 콘텐츠(게시판·포스트·상품)를 콘텐츠 fetch 없이 감지한다.
 *
 * 경로 세그먼트를 토큰화해 숫자·날짜·UUID·slug 같은 "가변부"를 플레이스홀더로 치환하면
 * 같은 레이아웃에서 찍어낸 URL이 하나의 템플릿 키로 묶인다(예 `/blog/123`·`/blog/hello`
 * → `/blog/{slug}`). 이 키가 같은 URL 집합이 곧 하나의 "반복 콘텐츠 클러스터"다.
 *
 * IO·Node 의존이 없는 순수 모듈이라 catalog 엔트리(브라우저·확장)에서도 안전하게 쓴다.
 * 참고: WSDM 2010 "Learning URL Patterns for Webpage De-duplication",
 * Cornell "URL Normalization for De-duplication".
 */

/** 목록 페이지네이션·정렬 파라미터 — 같은 템플릿의 다른 페이지를 한 URL로 접기 위해 제거한다. */
export const PAGINATION_PARAMS: ReadonlySet<string> = new Set([
  "page",
  "p",
  "pg",
  "paged",
  "offset",
  "start",
  "from",
  "sort",
  "order",
  "orderby",
  "dir",
  "view",
  "per_page",
  "perpage",
  "limit",
  "size",
]);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const YEAR_RE = /^(?:19|20)\d{2}$/;
const DIGITS_RE = /^\d+$/;
const HEX_RE = /^[0-9a-f]+$/i;

/** hex 문자열(≥12) 또는 하이픈 없는 영문+숫자 혼합 긴 토큰(≥16) → 해시류 식별자로 본다. */
function isHash(seg: string): boolean {
  if (seg.length >= 12 && HEX_RE.test(seg)) return true;
  if (seg.length >= 16 && !seg.includes("-") && /[a-z]/i.test(seg) && /\d/.test(seg)) return true;
  return false;
}

/** 게시글 제목형 slug — 첫 세그먼트(섹션 구분)에는 적용하지 않는다. */
function isSlug(seg: string, index: number): boolean {
  if (index < 1 || seg.length < 8) return false;
  const hyphenCount = (seg.match(/-/g) ?? []).length;
  const alnumMix = /[a-z]/i.test(seg) && /\d/.test(seg);
  return hyphenCount >= 2 || alnumMix;
}

/** 세그먼트 하나를 템플릿 토큰으로 변환(위→아래 우선순위). 가변부가 아니면 소문자 리터럴. */
function segmentToken(seg: string, index: number): string {
  const s = seg.toLowerCase();
  if (UUID_RE.test(s)) return "{uuid}";
  if (DATE_RE.test(s)) return "{date}";
  if (YEAR_RE.test(s)) return "{year}";
  if (DIGITS_RE.test(s)) return "{n}";
  if (isHash(s)) return "{hash}";
  if (isSlug(s, index)) return "{slug}";
  return s;
}

/**
 * 중복 판정용 정규화 URL — 페이지네이션·정렬 파라미터를 제거하고 남은 query 키를 정렬한다.
 * 후행 슬래시·fragment·hostname 정책은 normalizeUrl과 동일하게 유지한다(리다이렉트 회피).
 * 파싱 불가 시 입력을 그대로 돌려준다.
 */
export function normalizeForDedup(rawUrl: string): string {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return rawUrl;
  }
  url.hash = "";
  url.hostname = url.hostname.toLowerCase();
  const kept: [string, string][] = [];
  for (const [key, value] of url.searchParams) {
    if (!PAGINATION_PARAMS.has(key.toLowerCase())) kept.push([key, value]);
  }
  kept.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0));
  url.search = "";
  for (const [key, value] of kept) url.searchParams.append(key, value);
  return url.toString();
}

/**
 * URL의 템플릿 키(경로 기반, query 무시). 같은 키 = 같은 레이아웃의 반복 콘텐츠.
 * 예 `/blog/2024/hello-world` → `/blog/{year}/{slug}`, `/products/1023` → `/products/{n}`.
 * 파싱 불가 시 입력을 그대로 돌려준다.
 */
export function templateKey(rawUrl: string): string {
  let path: string;
  try {
    path = new URL(rawUrl).pathname;
  } catch {
    return rawUrl;
  }
  const segments = path.split("/").filter(Boolean);
  if (segments.length === 0) return "/";
  const tokens = segments.map((seg, i) => segmentToken(seg, i));
  return "/" + tokens.join("/");
}

/** 템플릿 키가 가변부(플레이스홀더)를 포함하는가 — 반복 콘텐츠 후보 판별. */
export function isRepeatingKey(key: string): boolean {
  return key.includes("{");
}
