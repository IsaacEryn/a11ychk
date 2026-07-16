/**
 * SSRF 방어 계층.
 *
 * 사용자가 입력한 URL을 서버에서 fetch/렌더링하기 전에 반드시 이 모듈을 거친다.
 * - http/https 스킴만 허용
 * - 호스트네임을 DNS로 resolve한 뒤 사설·루프백·링크로컬·메타데이터 대역이면 차단
 * - guardedFetch는 검증한 IP를 연결에 고정(pin)해 DNS rebinding TOCTOU를 차단
 * - redirect는 매 hop마다 재검증·재고정
 */
import { lookup } from "node:dns/promises";
import net from "node:net";
import { Agent, fetch as undiciFetch } from "undici";

export class UrlGuardError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "invalid-url"
      | "bad-scheme"
      | "private-address"
      | "resolve-failed"
      | "too-many-redirects"
      | "fetch-failed",
  ) {
    super(message);
    this.name = "UrlGuardError";
  }
}

const MAX_REDIRECTS = 3;

/** 형식 검증만 수행 (네트워크 없음). 실패 시 throw. */
export function assertHttpUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new UrlGuardError(`올바른 URL 형식이 아닙니다: ${raw}`, "invalid-url");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new UrlGuardError(`http/https만 허용됩니다: ${url.protocol}`, "bad-scheme");
  }
  if (url.username || url.password) {
    throw new UrlGuardError("URL에 인증 정보를 포함할 수 없습니다", "invalid-url");
  }
  return url;
}

/** IPv4/IPv6 주소가 공개 인터넷 대역이 아니면 true */
export function isPrivateAddress(ip: string): boolean {
  if (net.isIPv4(ip)) return isPrivateV4(ip);
  if (net.isIPv6(ip)) return isPrivateV6(ip);
  return true; // IP가 아니면 안전하지 않은 것으로 간주
}

function isPrivateV4(ip: string): boolean {
  const parts = ip.split(".").map(Number);
  const [a = 0, b = 0, c = 0] = parts;
  if (a === 0 || a === 10 || a === 127) return true; // this-net, private, loopback
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT 100.64/10
  if (a === 169 && b === 254) return true; // link-local (클라우드 메타데이터 169.254.169.254 포함)
  if (a === 172 && b >= 16 && b <= 31) return true; // private 172.16/12
  if (a === 192 && b === 168) return true; // private
  if (a === 192 && b === 0 && c === 0) return true; // 192.0.0.0/24 IETF 프로토콜 할당
  if (a === 192 && b === 0 && c === 2) return true; // 192.0.2.0/24 문서용(TEST-NET-1)
  if (a === 198 && (b === 18 || b === 19)) return true; // benchmark 198.18.0.0/15
  if (a === 198 && b === 51 && c === 100) return true; // 198.51.100.0/24 문서용(TEST-NET-2)
  if (a === 203 && b === 0 && c === 113) return true; // 203.0.113.0/24 문서용(TEST-NET-3)
  if (a >= 224) return true; // multicast + reserved
  return false;
}

/**
 * IPv6 문자열을 16비트 그룹 8개로 전개. ('::' 압축, 말미 dotted-quad 지원)
 * 파싱 실패 시 null.
 */
function expandV6(ip: string): number[] | null {
  let body = ip.toLowerCase();
  // zone index(%eth0) 제거
  const zone = body.indexOf("%");
  if (zone !== -1) body = body.slice(0, zone);

  // 말미 IPv4 dotted-quad를 16비트 hex 2그룹으로 치환 후 일반 파싱
  const v4m = body.match(/((?:\d{1,3}\.){3}\d{1,3})$/);
  if (v4m?.[1]) {
    const oct = v4m[1].split(".").map(Number);
    if (oct.length !== 4 || oct.some((n) => Number.isNaN(n) || n > 255)) return null;
    const hi = (((oct[0] ?? 0) << 8) | (oct[1] ?? 0)).toString(16);
    const lo = (((oct[2] ?? 0) << 8) | (oct[3] ?? 0)).toString(16);
    body = body.slice(0, body.length - v4m[1].length) + `${hi}:${lo}`;
  }

  const halves = body.split("::");
  if (halves.length > 2) return null;
  const parse = (s: string): number[] | null => {
    if (s === "") return [];
    const groups = s.split(":").map((g) => (g === "" ? NaN : parseInt(g, 16)));
    if (groups.some((n) => Number.isNaN(n) || n < 0 || n > 0xffff)) return null;
    return groups;
  };
  const head = parse(halves[0] ?? "");
  const tail = halves.length === 2 ? parse(halves[1] ?? "") : [];
  if (head === null || tail === null) return null;
  const full =
    halves.length === 2
      ? [...head, ...Array(Math.max(0, 8 - head.length - tail.length)).fill(0), ...tail]
      : head;
  return full.length === 8 ? full : null;
}

function isPrivateV6(ip: string): boolean {
  const g = expandV6(ip);
  if (!g) return true; // 파싱 불가 → 안전하지 않은 것으로 간주
  const embeddedV4 = (hi: number, lo: number) => `${hi >> 8}.${hi & 0xff}.${lo >> 8}.${lo & 0xff}`;
  const allZeroTo = (n: number) => g.slice(0, n).every((x) => x === 0);

  // unspecified(::), loopback(::1) — 전개형 포함
  if (allZeroTo(7) && ((g[7] ?? 0) === 0 || (g[7] ?? 0) === 1)) return true;
  // IPv4-mapped ::ffff:0:0/96 · IPv4-compatible ::/96 — hex형(::ffff:c0a8:1) 포함
  if (allZeroTo(5) && ((g[5] === 0xffff) || g[5] === 0)) {
    return isPrivateV4(embeddedV4(g[6] ?? 0, g[7] ?? 0));
  }
  // NAT64 64:ff9b::/96 — 임베디드 v4로 판정
  if (g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every((x) => x === 0)) {
    return isPrivateV4(embeddedV4(g[6] ?? 0, g[7] ?? 0));
  }
  // 6to4 2002::/16 — 2002:AABB:CCDD → v4 AABB.CCDD
  if (g[0] === 0x2002) return isPrivateV4(embeddedV4(g[1] ?? 0, g[2] ?? 0));
  const top = g[0] ?? 0;
  if ((top & 0xfe00) === 0xfc00) return true; // ULA fc00::/7
  if ((top & 0xffc0) === 0xfe80) return true; // link-local fe80::/10
  if ((top & 0xff00) === 0xff00) return true; // multicast ff00::/8
  return false;
}

/**
 * 호스트네임을 resolve해 모든 결과 IP가 공개 대역인지 확인하고,
 * 검증을 통과한 주소 목록을 반환한다 (연결 고정용).
 * 하나라도 사설 대역이면 차단 (DNS rebinding 대비 전체 검사).
 */
export async function assertPublicHost(url: URL): Promise<{ address: string; family: 4 | 6 }[]> {
  const hostname = url.hostname.replace(/^\[|\]$/g, ""); // IPv6 literal 대괄호 제거
  if (net.isIP(hostname)) {
    if (isPrivateAddress(hostname)) {
      throw new UrlGuardError(`사설/내부 네트워크 주소는 검사할 수 없습니다: ${hostname}`, "private-address");
    }
    return [{ address: hostname, family: net.isIPv6(hostname) ? 6 : 4 }];
  }
  if (hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local") || hostname.endsWith(".internal")) {
    throw new UrlGuardError(`내부 호스트네임은 검사할 수 없습니다: ${hostname}`, "private-address");
  }
  let addresses: { address: string; family: number }[];
  try {
    addresses = await lookup(hostname, { all: true, verbatim: true });
  } catch {
    throw new UrlGuardError(`호스트를 찾을 수 없습니다: ${hostname}`, "resolve-failed");
  }
  if (addresses.length === 0) {
    throw new UrlGuardError(`호스트를 찾을 수 없습니다: ${hostname}`, "resolve-failed");
  }
  for (const { address } of addresses) {
    if (isPrivateAddress(address)) {
      throw new UrlGuardError(`사설/내부 네트워크로 해석되는 주소는 검사할 수 없습니다: ${hostname}`, "private-address");
    }
  }
  return addresses.map((a) => ({ address: a.address, family: a.family === 6 ? 6 : 4 }));
}

/** 형식 + DNS 검증을 모두 수행한 뒤 정규화된 URL 반환 */
export async function assertPublicHttpUrl(raw: string): Promise<URL> {
  const url = assertHttpUrl(raw);
  await assertPublicHost(url);
  return url;
}

export const SCANNER_USER_AGENT = "Mozilla/5.0 (compatible; a11ychk-bot/0.1; +https://a11ychk.com/bot)";

/**
 * SSRF-safe fetch.
 * - redirect를 수동으로 따라가며 매 hop을 재검증한다.
 * - 검증 시점에 확인한 IP를 undici 커스텀 lookup으로 연결에 고정해,
 *   fetch가 자체 DNS 조회를 다시 하며 생기는 rebinding TOCTOU를 차단한다.
 *   (TLS SNI/Host 헤더는 원래 호스트네임 유지)
 */
export async function guardedFetch(rawUrl: string, init: RequestInit = {}): Promise<Response> {
  let current = rawUrl;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const url = assertHttpUrl(current);
    const vetted = await assertPublicHost(url);
    const pinned = vetted[0]!;

    // 검증된 IP만 반환하는 lookup — undici가 재조회해도 같은 주소로만 연결
    const agent = new Agent({
      connect: {
        lookup(
          _hostname: string,
          opts: { all?: boolean },
          cb: (err: Error | null, result: string | { address: string; family: number }[], family?: number) => void,
        ) {
          if (opts?.all) cb(null, vetted.map((v) => ({ address: v.address, family: v.family })));
          else cb(null, pinned.address, pinned.family);
        },
      } as never,
    });

    let res: Response;
    try {
      res = (await undiciFetch(url.toString(), {
        ...(init as Parameters<typeof undiciFetch>[1]),
        dispatcher: agent,
        redirect: "manual",
        headers: { "user-agent": SCANNER_USER_AGENT, ...(init.headers as Record<string, string>) },
        signal: init.signal ?? AbortSignal.timeout(15_000),
      })) as unknown as Response;
    } catch (e) {
      throw new UrlGuardError(`요청에 실패했습니다: ${url.hostname} (${(e as Error).message})`, "fetch-failed");
    } finally {
      // 소켓 누수 방지 — 응답 본문은 이미 버퍼링되거나 스트림 참조가 유지된다
      void agent.close().catch(() => {});
    }
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get("location");
      if (!location) return res;
      current = new URL(location, url).toString();
      continue;
    }
    return res;
  }
  throw new UrlGuardError(`redirect가 너무 많습니다 (최대 ${MAX_REDIRECTS}회)`, "too-many-redirects");
}
