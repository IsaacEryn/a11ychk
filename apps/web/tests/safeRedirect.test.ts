import { describe, expect, it } from "vitest";
import { sanitizeNextPath } from "../src/lib/safeRedirect";

describe("sanitizeNextPath — open redirect 가드 (auth callback/confirm)", () => {
  it("내부 경로는 그대로 통과", () => {
    expect(sanitizeNextPath("/ko/dashboard")).toBe("/ko/dashboard");
    expect(sanitizeNextPath("/en/scans/abc/report?x=1")).toBe("/en/scans/abc/report?x=1");
  });

  it("protocol-relative(//host)·백슬래시 변형은 차단", () => {
    expect(sanitizeNextPath("//evil.com")).toBe("/ko/dashboard");
    expect(sanitizeNextPath("//evil.com/ko")).toBe("/ko/dashboard");
    expect(sanitizeNextPath("/\\evil.com")).toBe("/ko/dashboard");
  });

  it("절대 URL·스킴·빈 값은 fallback", () => {
    expect(sanitizeNextPath("https://evil.com")).toBe("/ko/dashboard");
    expect(sanitizeNextPath("javascript:alert(1)")).toBe("/ko/dashboard");
    expect(sanitizeNextPath("")).toBe("/ko/dashboard");
    expect(sanitizeNextPath(null)).toBe("/ko/dashboard");
    expect(sanitizeNextPath(undefined)).toBe("/ko/dashboard");
  });

  it("fallback 지정 가능", () => {
    expect(sanitizeNextPath("//evil.com", "/en")).toBe("/en");
  });
});
