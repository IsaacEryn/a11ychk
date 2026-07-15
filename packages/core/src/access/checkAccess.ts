/**
 * 봇 차단 검증기 — 사이트가 자동 검사 봇을 어떤 방식으로 차단하는지 진단한다.
 *
 * 진단 항목:
 *  1. robots.txt — a11ychk-bot의 크롤링 허용 여부 (우리는 robots를 존중하므로 차단이면 검사 거부)
 *  2. 봇 UA 요청 — HTTP 상태·챌린지 페이지 여부
 *  3. 브라우저 UA 요청 — 봇 UA와 결과가 다르면 UA 기반 차단으로 판별
 */
import { guardedFetch, SCANNER_USER_AGENT } from "../security/urlGuard";
import { fetchRobots, isPathAllowed } from "../security/robots";
import { normalizeUrl } from "../crawler/collectPages";
import type { AccessCheckResult, AccessVerdict } from "../types";

const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

const BLOCKED_STATUSES = new Set([401, 403, 406, 429, 503]);

/** 응답 본문·헤더에서 봇 방어 챌린지 흔적을 감지 */
export function sniffChallenge(body: string, headers: Headers): string | undefined {
  const b = body.slice(0, 200_000).toLowerCase();
  const server = (headers.get("server") ?? "").toLowerCase();

  if (
    headers.get("cf-mitigated") === "challenge" ||
    b.includes("challenge-platform") ||
    b.includes("_cf_chl") ||
    b.includes("cf-turnstile") ||
    (server.includes("cloudflare") && b.includes("just a moment"))
  ) {
    return "Cloudflare";
  }
  if (b.includes("_incapsula_") || b.includes("incapsula")) return "Imperva Incapsula";
  if (b.includes("perimeterx") || b.includes("px-captcha")) return "HUMAN (PerimeterX)";
  if (b.includes("distil_r_captcha") || b.includes("distilnetworks")) return "Distil";
  if (b.includes("awswaf") || headers.get("x-amzn-waf-action")) return "AWS WAF";
  return undefined;
}

interface ProbeResult {
  status?: number;
  challengeVendor?: string;
  failed: boolean;
}

async function probe(url: string, userAgent: string): Promise<ProbeResult> {
  try {
    const res = await guardedFetch(url, { headers: { "user-agent": userAgent } });
    const body = res.ok || BLOCKED_STATUSES.has(res.status) ? await res.text() : "";
    return { status: res.status, challengeVendor: sniffChallenge(body, res.headers), failed: false };
  } catch {
    return { failed: true };
  }
}

/** 진단 실행. URL 형식·SSRF 오류(UrlGuardError)는 호출자에게 전파된다 */
export async function checkBotAccess(rawUrl: string): Promise<AccessCheckResult> {
  const url = normalizeUrl(rawUrl);
  if (!url) throw new Error(`올바르지 않은 URL: ${rawUrl}`);
  const u = new URL(url);

  // 1) robots.txt
  const robots = await fetchRobots(u.origin);
  const robotsAllowed = isPathAllowed(robots, u.pathname + u.search);

  // 2) 봇 UA 요청
  const bot = await probe(url, SCANNER_USER_AGENT);

  if (bot.failed) {
    return { verdict: robotsAllowed ? "unreachable" : "robots-blocked", robotsAllowed };
  }

  const botBlocked = bot.challengeVendor !== undefined || BLOCKED_STATUSES.has(bot.status ?? 0);

  // 3) 봇이 차단됐다면 브라우저 UA로 대조 (UA 차단 vs 전면 챌린지 구분)
  let browser: ProbeResult | undefined;
  if (botBlocked) {
    browser = await probe(url, BROWSER_UA);
  }

  let verdict: AccessVerdict;
  if (!robotsAllowed) {
    verdict = "robots-blocked";
  } else if (botBlocked) {
    const browserOk = browser && !browser.failed && (browser.status ?? 0) < 400 && !browser.challengeVendor;
    if (browserOk) verdict = "ua-blocked";
    else verdict = bot.challengeVendor || browser?.challengeVendor ? "challenge" : "http-error";
  } else if ((bot.status ?? 0) >= 400) {
    verdict = "http-error";
  } else {
    verdict = "ok";
  }

  return {
    verdict,
    robotsAllowed,
    botStatus: bot.status,
    browserStatus: browser?.status,
    challengeVendor: bot.challengeVendor ?? browser?.challengeVendor,
  };
}
