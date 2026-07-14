/**
 * SSRF 방어 계층.
 *
 * 사용자가 입력한 URL을 서버에서 fetch/렌더링하기 전에 반드시 이 모듈을 거친다.
 * - http/https 스킴만 허용
 * - 호스트네임을 DNS로 resolve한 뒤 사설·루프백·링크로컬·메타데이터 대역이면 차단
 * - redirect는 매 hop마다 재검증 (DNS rebinding·open redirect 우회 방지)
 */
import { lookup } from "node:dns/promises";
import net from "node:net";

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
  const [a = 0, b = 0] = parts;
  if (a === 0 || a === 10 || a === 127) return true; // this-net, private, loopback
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT 100.64/10
  if (a === 169 && b === 254) return true; // link-local (클라우드 메타데이터 169.254.169.254 포함)
  if (a === 172 && b >= 16 && b <= 31) return true; // private 172.16/12
  if (a === 192 && b === 168) return true; // private
  if (a === 192 && b === 0) return true; // 192.0.0/24, 192.0.2/24 문서용
  if (a === 198 && (b === 18 || b === 19)) return true; // benchmark
  if (a === 198 && b === 51) return true; // 198.51.100/24 문서용
  if (a === 203 && b === 0) return true; // 203.0.113/24 문서용
  if (a >= 224) return true; // multicast + reserved
  return false;
}

function isPrivateV6(ip: string): boolean {
  const lower = ip.toLowerCase();
  // IPv4-mapped (::ffff:1.2.3.4) 는 v4 규칙으로 판정
  const v4 = lower.match(/(?:^|:)((?:\d{1,3}\.){3}\d{1,3})$/);
  if (v4?.[1]) return isPrivateV4(v4[1]);
  const normalized = lower === "::" ? "::" : lower;
  if (normalized === "::" || normalized === "::1") return true; // unspecified, loopback
  if (lower.startsWith("fc") || lower.startsWith("fd")) return true; // ULA fc00::/7
  if (lower.startsWith("fe8") || lower.startsWith("fe9") || lower.startsWith("fea") || lower.startsWith("feb"))
    return true; // link-local fe80::/10
  if (lower.startsWith("ff")) return true; // multicast
  return false;
}

/**
 * 호스트네임을 resolve해 모든 결과 IP가 공개 대역인지 확인.
 * 하나라도 사설 대역이면 차단 (DNS rebinding 대비 전체 검사).
 */
export async function assertPublicHost(url: URL): Promise<void> {
  const hostname = url.hostname.replace(/^\[|\]$/g, ""); // IPv6 literal 대괄호 제거
  if (net.isIP(hostname)) {
    if (isPrivateAddress(hostname)) {
      throw new UrlGuardError(`사설/내부 네트워크 주소는 검사할 수 없습니다: ${hostname}`, "private-address");
    }
    return;
  }
  if (hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local") || hostname.endsWith(".internal")) {
    throw new UrlGuardError(`내부 호스트네임은 검사할 수 없습니다: ${hostname}`, "private-address");
  }
  let addresses: { address: string }[];
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
}

/** 형식 + DNS 검증을 모두 수행한 뒤 정규화된 URL 반환 */
export async function assertPublicHttpUrl(raw: string): Promise<URL> {
  const url = assertHttpUrl(raw);
  await assertPublicHost(url);
  return url;
}

export const SCANNER_USER_AGENT = "Mozilla/5.0 (compatible; a11ychk-bot/0.1; +https://a11ychk.com/bot)";

/**
 * SSRF-safe fetch. redirect를 수동으로 따라가며 매 hop을 재검증한다.
 */
export async function guardedFetch(rawUrl: string, init: RequestInit = {}): Promise<Response> {
  let current = rawUrl;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const url = await assertPublicHttpUrl(current);
    let res: Response;
    try {
      res = await fetch(url, {
        ...init,
        redirect: "manual",
        headers: { "user-agent": SCANNER_USER_AGENT, ...init.headers },
        signal: init.signal ?? AbortSignal.timeout(15_000),
      });
    } catch (e) {
      throw new UrlGuardError(`요청에 실패했습니다: ${url.hostname} (${(e as Error).message})`, "fetch-failed");
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
