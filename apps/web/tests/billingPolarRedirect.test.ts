import { describe, expect, it, vi } from "vitest";
import { isPolarHostedUrl, navigateToPolar } from "../src/lib/billing/polarRedirect";

describe("isPolarHostedUrl — Polar가 호스팅하는 페이지 허용 목록", () => {
  it.each([
    "https://polar.sh/checkout/polar_c_fake",
    "https://sandbox.polar.sh/checkout/polar_c_fake",
    "https://buy.polar.sh/polar_c_fake",
    "https://POLAR.SH/fake-org/portal?customer_session_token=fake",
    "https://a.b.polar.sh/x",
  ])("허용: %s", (url) => {
    expect(isPolarHostedUrl(url)).toBe(true);
  });

  it.each([
    ["http(https 아님)", "http://sandbox.polar.sh/checkout/fake"],
    ["javascript:", "javascript:alert(1)"],
    ["data:", "data:text/html,hi"],
    ["다른 호스트", "https://evil.example/checkout"],
    ["접미만 같음", "https://evilpolar.sh/checkout"],
    ["polar.sh를 앞에 둔 다른 호스트", "https://polar.sh.evil.example/checkout"],
    ["끝 점(.)", "https://sandbox.polar.sh./checkout"],
    ["사용자 정보로 위장", "https://polar.sh@evil.example/checkout"],
    ["사용자 정보가 붙은 Polar 주소", "https://user:pw@polar.sh/checkout"],
    ["포트", "https://polar.sh:8443/checkout"],
    ["상대 경로", "/checkout"],
    ["빈 문자열", ""],
    ["URL이 아님", "not a url"],
  ])("거부: %s", (_why, url) => {
    expect(isPolarHostedUrl(url)).toBe(false);
  });

  it("문자열이 아니거나 지나치게 길면 거부", () => {
    expect(isPolarHostedUrl(undefined)).toBe(false);
    expect(isPolarHostedUrl(null)).toBe(false);
    expect(isPolarHostedUrl({ href: "https://polar.sh/" })).toBe(false);
    expect(isPolarHostedUrl(`https://polar.sh/${"a".repeat(5000)}`)).toBe(false);
  });
});

describe("navigateToPolar — 검사를 통과한 주소로만 이동", () => {
  it("허용 주소면 그 주소로 이동하고 true", () => {
    const assign = vi.fn();
    expect(navigateToPolar("https://sandbox.polar.sh/checkout/polar_c_fake", assign)).toBe(true);
    expect(assign).toHaveBeenCalledExactlyOnceWith("https://sandbox.polar.sh/checkout/polar_c_fake");
  });

  it("거부 주소면 이동하지 않고 false", () => {
    const assign = vi.fn();
    expect(navigateToPolar("https://evil.example/checkout", assign)).toBe(false);
    expect(navigateToPolar("javascript:alert(1)", assign)).toBe(false);
    expect(navigateToPolar(undefined, assign)).toBe(false);
    expect(assign).not.toHaveBeenCalled();
  });
});
