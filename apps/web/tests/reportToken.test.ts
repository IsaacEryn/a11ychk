import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { signReportToken, verifyReportToken } from "../src/lib/reportToken";

const SCAN_ID = "11111111-2222-3333-4444-555555555555";

beforeEach(() => {
  process.env.INTERNAL_API_SECRET = "test-secret-for-vitest";
});
afterEach(() => {
  vi.useRealTimers();
});

describe("reportToken — PDF용 단기 서명 토큰", () => {
  it("서명한 토큰은 같은 스캔에 대해 검증 통과", () => {
    const token = signReportToken(SCAN_ID);
    expect(verifyReportToken(SCAN_ID, token)).toBe(true);
  });

  it("다른 스캔 ID로는 검증 실패", () => {
    const token = signReportToken(SCAN_ID);
    expect(verifyReportToken("99999999-8888-7777-6666-555555555555", token)).toBe(false);
  });

  it("만료(10분) 후 검증 실패", () => {
    const token = signReportToken(SCAN_ID);
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 11 * 60_000);
    expect(verifyReportToken(SCAN_ID, token)).toBe(false);
  });

  it("서명·만료 변조 시 검증 실패", () => {
    const token = signReportToken(SCAN_ID);
    const [exp, sig] = token.split(".");
    expect(verifyReportToken(SCAN_ID, `${Number(exp) + 60_000}.${sig}`)).toBe(false); // 만료 연장 시도
    expect(verifyReportToken(SCAN_ID, `${exp}.${sig!.slice(0, -2)}xx`)).toBe(false); // 서명 변조
    expect(verifyReportToken(SCAN_ID, "garbage")).toBe(false);
    expect(verifyReportToken(SCAN_ID, "")).toBe(false);
  });

  it("시크릿 미설정이면 발급 자체가 실패", () => {
    delete process.env.INTERNAL_API_SECRET;
    expect(() => signReportToken(SCAN_ID)).toThrow();
    process.env.INTERNAL_API_SECRET = "change-me";
    expect(() => signReportToken(SCAN_ID)).toThrow();
  });
});
