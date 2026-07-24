import { describe, expect, it } from "vitest";
import { isBannerActive, type Announcement } from "@/lib/appSettings";

const NOW = Date.parse("2026-07-25T12:00:00Z");
const base: Announcement = {
  id: "a1",
  date: "2026-07-25T00:00:00Z",
  active: true,
  ko: { title: "제목", body: "본문" },
  en: { title: "Title", body: "Body" },
};
const hoursFromNow = (h: number) => new Date(NOW + h * 3600_000).toISOString();

describe("isBannerActive — 배너 노출 판정", () => {
  it("active가 아니면 노출하지 않는다", () => {
    expect(isBannerActive({ ...base, active: false }, NOW)).toBe(false);
  });

  it("만료일이 없으면 계속 노출한다 (관리자가 내릴 때까지)", () => {
    expect(isBannerActive(base, NOW)).toBe(true);
  });

  it("만료 전이면 노출, 만료 후면 미노출", () => {
    expect(isBannerActive({ ...base, expiresAt: hoursFromNow(1) }, NOW)).toBe(true);
    expect(isBannerActive({ ...base, expiresAt: hoursFromNow(-1) }, NOW)).toBe(false);
  });

  it("만료 시각과 정확히 같으면 미노출 (초과가 아니라 도달로 종료)", () => {
    expect(isBannerActive({ ...base, expiresAt: new Date(NOW).toISOString() }, NOW)).toBe(false);
  });

  it("잘못된 만료 값은 무기한으로 관용 처리한다 (배너가 사라지는 실패 대신)", () => {
    expect(isBannerActive({ ...base, expiresAt: "not-a-date" }, NOW)).toBe(true);
  });

  it("비활성이면 만료 전이어도 노출하지 않는다", () => {
    expect(isBannerActive({ ...base, active: false, expiresAt: hoursFromNow(24) }, NOW)).toBe(false);
  });
});
