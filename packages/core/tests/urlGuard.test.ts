import { describe, expect, it } from "vitest";
import { assertHttpUrl, isPrivateAddress, UrlGuardError } from "../src/security/urlGuard";

describe("assertHttpUrl", () => {
  it("허용: http/https URL", () => {
    expect(assertHttpUrl("https://example.com/page").hostname).toBe("example.com");
    expect(assertHttpUrl("http://example.com").protocol).toBe("http:");
  });

  it("차단: 비 http 스킴", () => {
    for (const bad of ["file:///etc/passwd", "ftp://example.com", "javascript:alert(1)", "gopher://x"]) {
      expect(() => assertHttpUrl(bad)).toThrow(UrlGuardError);
    }
  });

  it("차단: URL 내 인증 정보", () => {
    expect(() => assertHttpUrl("https://user:pass@example.com")).toThrow(UrlGuardError);
  });

  it("차단: URL 형식 오류", () => {
    expect(() => assertHttpUrl("not a url")).toThrow(UrlGuardError);
  });
});

describe("isPrivateAddress — SSRF 차단 대역", () => {
  const privateIps = [
    "127.0.0.1",
    "127.255.255.254",
    "10.0.0.1",
    "172.16.0.1",
    "172.31.255.255",
    "192.168.1.1",
    "169.254.169.254", // 클라우드 메타데이터
    "0.0.0.0",
    "100.64.0.1", // CGNAT
    "224.0.0.1", // multicast
    "255.255.255.255",
    "::1",
    "::",
    "fc00::1",
    "fd12:3456::1",
    "fe80::1",
    "::ffff:127.0.0.1", // IPv4-mapped loopback
    "::ffff:192.168.0.1",
  ];
  it.each(privateIps)("차단: %s", (ip) => {
    expect(isPrivateAddress(ip)).toBe(true);
  });

  const publicIps = ["1.1.1.1", "8.8.8.8", "93.184.216.34", "172.32.0.1", "172.15.0.1", "2606:4700:4700::1111", "::ffff:8.8.8.8"];
  it.each(publicIps)("허용: %s", (ip) => {
    expect(isPrivateAddress(ip)).toBe(false);
  });

  it("IP가 아닌 문자열은 안전하지 않은 것으로 간주", () => {
    expect(isPrivateAddress("localhost")).toBe(true);
  });
});
