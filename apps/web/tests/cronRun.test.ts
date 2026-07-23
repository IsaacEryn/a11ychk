import { describe, expect, it } from "vitest";
import { isCronStale } from "@/lib/cronRun";

const NOW = Date.parse("2026-07-25T12:00:00Z");
const hoursAgo = (h: number) => new Date(NOW - h * 3600_000).toISOString();

describe("isCronStale — 크론 무실행 판정", () => {
  it("기록이 없으면(null) 오경보를 내지 않는다", () => {
    expect(isCronStale(null, 26, NOW)).toBe(false);
  });

  it("파싱 불가 시각은 stale로 보지 않는다", () => {
    expect(isCronStale("not-a-date", 26, NOW)).toBe(false);
  });

  it("임계 이내면 정상", () => {
    expect(isCronStale(hoursAgo(1), 26, NOW)).toBe(false);
    expect(isCronStale(hoursAgo(25.9), 26, NOW)).toBe(false);
  });

  it("임계(26h) 초과면 stale", () => {
    expect(isCronStale(hoursAgo(26.1), 26, NOW)).toBe(true);
    expect(isCronStale(hoursAgo(72), 26, NOW)).toBe(true);
  });

  it("경계 정확히 26h는 stale 아님 (초과만)", () => {
    expect(isCronStale(hoursAgo(26), 26, NOW)).toBe(false);
  });

  it("미래 시각(시계 오차)은 stale 아님", () => {
    expect(isCronStale(hoursAgo(-1), 26, NOW)).toBe(false);
  });
});
