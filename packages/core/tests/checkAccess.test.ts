import { describe, expect, it } from "vitest";
import { sniffChallenge } from "../src/access/checkAccess";

function headers(init: Record<string, string> = {}): Headers {
  return new Headers(init);
}

describe("sniffChallenge — 봇 방어 서비스 감지", () => {
  it("Cloudflare 챌린지 (본문 마커)", () => {
    expect(sniffChallenge('<script src="/cdn-cgi/challenge-platform/h/b.js">', headers())).toBe("Cloudflare");
    expect(sniffChallenge('window._cf_chl_opt = {}', headers())).toBe("Cloudflare");
    expect(sniffChallenge('<div class="cf-turnstile"></div>', headers())).toBe("Cloudflare");
  });

  it("Cloudflare 챌린지 (헤더)", () => {
    expect(sniffChallenge("", headers({ "cf-mitigated": "challenge" }))).toBe("Cloudflare");
    expect(sniffChallenge("<title>Just a moment...</title>", headers({ server: "cloudflare" }))).toBe("Cloudflare");
  });

  it("기타 벤더", () => {
    expect(sniffChallenge('src="/_Incapsula_Resource?..."', headers())).toBe("Imperva Incapsula");
    expect(sniffChallenge('id="px-captcha"', headers())).toBe("HUMAN (PerimeterX)");
    expect(sniffChallenge("", headers({ "x-amzn-waf-action": "challenge" }))).toBe("AWS WAF");
  });

  it("일반 페이지는 미감지", () => {
    expect(sniffChallenge("<html><body>안녕하세요 일반 콘텐츠</body></html>", headers())).toBeUndefined();
    // 정상 페이지의 로그인 폼 recaptcha는 챌린지로 오탐하지 않음
    expect(sniffChallenge('<div class="g-recaptcha"></div>', headers())).toBeUndefined();
    // cloudflare 서빙이지만 챌린지 아님
    expect(sniffChallenge("<html>정상 페이지</html>", headers({ server: "cloudflare" }))).toBeUndefined();
  });
});
