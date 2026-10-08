import { describe, expect, it } from "vitest";
import { addInterval, graceUntil, kstDayOfMonth, nextRetryAt, reminderLeadMs } from "../src/lib/billing/period";

describe("addInterval — KST 앵커일 기준", () => {
  it("월간: 같은 날, 같은 시각", () => {
    expect(addInterval("2026-10-15T01:00:00.000Z", "month", 15)).toBe("2026-11-15T01:00:00.000Z");
  });
  it("31일 앵커는 짧은 달에서 말일로, 다음 달엔 다시 31일", () => {
    // 2027-01-31 10:00 KST = 01:00Z
    const feb = addInterval("2027-01-31T01:00:00.000Z", "month", 31);
    expect(feb).toBe("2027-02-28T01:00:00.000Z");
    expect(addInterval(feb, "month", 31)).toBe("2027-03-31T01:00:00.000Z");
  });
  it("윤년 2월 29일", () => {
    expect(addInterval("2028-01-30T01:00:00.000Z", "month", 30)).toBe("2028-02-29T01:00:00.000Z");
  });
  it("KST 자정 근처 — UTC로는 전날이어도 KST 날짜 기준", () => {
    // 2026-10-31 00:30 KST = 2026-10-30T15:30Z → 다음 달은 11-30(말일) 00:30 KST
    expect(addInterval("2026-10-30T15:30:00.000Z", "month", 31)).toBe("2026-11-29T15:30:00.000Z");
  });
  it("연간: 12월 → 다음 해, 2/29 → 2/28", () => {
    expect(addInterval("2026-12-20T01:00:00.000Z", "year", 20)).toBe("2027-12-20T01:00:00.000Z");
    expect(addInterval("2028-02-29T01:00:00.000Z", "year", 29)).toBe("2029-02-28T01:00:00.000Z");
  });
  it("kstDayOfMonth", () => {
    expect(kstDayOfMonth(Date.parse("2026-10-30T15:30:00Z"))).toBe(31);
  });
});

describe("미납 일정", () => {
  const due = "2026-11-15T01:00:00.000Z";
  it("유예는 결제 예정 시각 + 7일", () => {
    expect(graceUntil(due)).toBe("2026-11-22T01:00:00.000Z");
  });
  it("재시도: 실패 1회 → +1일, 2회 → +3일, 3회 → +5일, 4회부터 없음", () => {
    expect(nextRetryAt(due, 1)).toBe("2026-11-16T01:00:00.000Z");
    expect(nextRetryAt(due, 2)).toBe("2026-11-18T01:00:00.000Z");
    expect(nextRetryAt(due, 3)).toBe("2026-11-20T01:00:00.000Z");
    expect(nextRetryAt(due, 4)).toBeNull();
    expect(nextRetryAt(due, 0)).toBeNull();
  });
  it("결제 예정 안내: 월간 7일 전, 연간 30일 전", () => {
    expect(reminderLeadMs("month")).toBe(7 * 86400_000);
    expect(reminderLeadMs("year")).toBe(30 * 86400_000);
  });
});
