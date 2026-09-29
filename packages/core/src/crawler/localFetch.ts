/**
 * 로컬 도구(MCP)용 fetch — SSRF 가드 없이 리다이렉트를 직접 따라간다.
 * 서버에서 사용자 입력 URL을 가져오는 경로는 반드시 guardedFetch를 쓸 것.
 *
 * undici fetch의 자동 추적(redirect: "follow")은 Location으로 만든 URL에 fragment가 없으면
 * `location.hash = …` setter를 부른다. ada 3.x(Node 24.7·25.6 등)에서는 `http://%EA%B0%80xn--.com/`
 * 같은 Location이 다시 해석되지 않는 href를 만들고, 그 setter가 프로세스를 abort시킨다(try/catch로
 * 못 잡는다). 크롤 대상의 루트나 sitemap.xml이 그런 주소로 리다이렉트하기만 해도 MCP 서버가 죽었다.
 * 그래서 manual로 받아 hop마다 URL.canParse로 거르고, 나머지 규칙(최대 20회, 상대 경로 해석,
 * UTF-8 원문 Location 해독, http(s)만 허용, 최종 주소가 res.url)은 undici의 자동 추적과 맞춘다.
 */
import { fetch as undiciFetch } from "undici";

const MAX_REDIRECTS = 20;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

/** Location을 UTF-8 원문 바이트로 보내는 사이트가 있어, 브라우저·undici처럼 UTF-8로 다시 읽는다. */
function decodeLocation(value: string): string {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code > 0x7e || code < 0x20) return Buffer.from(value, "latin1").toString("utf8");
  }
  return value;
}

export async function localFetch(rawUrl: string): Promise<Response> {
  let current = rawUrl;
  for (let hop = 0; ; hop++) {
    const res = (await undiciFetch(current, { redirect: "manual" })) as unknown as Response;
    const location = res.headers.get("location");
    if (!REDIRECT_STATUSES.has(res.status) || location === null) return res;
    // 본문은 쓰지 않는다 — 소켓을 붙잡지 않도록 버린다
    await res.body?.cancel();
    if (hop >= MAX_REDIRECTS) throw new TypeError(`리다이렉트가 ${MAX_REDIRECTS}번을 넘었습니다: ${rawUrl}`);
    const next = new URL(decodeLocation(location), current);
    if (next.protocol !== "http:" && next.protocol !== "https:") {
      throw new TypeError(`http(s)가 아닌 주소로 리다이렉트합니다: ${next.protocol}`);
    }
    if (!URL.canParse(next.href)) throw new TypeError(`다시 해석되지 않는 주소로 리다이렉트합니다: ${next.href}`);
    current = next.href;
  }
}
