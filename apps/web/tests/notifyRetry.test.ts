import { describe, expect, it } from "vitest";
import { shouldRetryEmailStatus } from "@/lib/notify";

describe("shouldRetryEmailStatus — 이메일 재시도 판정", () => {
  it("5xx는 일시 장애로 보고 재시도한다", () => {
    expect(shouldRetryEmailStatus(500)).toBe(true);
    expect(shouldRetryEmailStatus(502)).toBe(true);
    expect(shouldRetryEmailStatus(503)).toBe(true);
  });

  it("429(레이트리밋)는 재시도한다", () => {
    expect(shouldRetryEmailStatus(429)).toBe(true);
  });

  it("성공·4xx(키·수신자·본문 오류)는 재시도하지 않는다", () => {
    expect(shouldRetryEmailStatus(200)).toBe(false);
    expect(shouldRetryEmailStatus(400)).toBe(false);
    expect(shouldRetryEmailStatus(401)).toBe(false);
    expect(shouldRetryEmailStatus(422)).toBe(false);
  });
});
