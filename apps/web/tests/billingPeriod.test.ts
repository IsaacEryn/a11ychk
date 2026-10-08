import { describe, expect, it } from "vitest";
import {
  CHARGE_LEAD_MS,
  addInterval,
  graceOver,
  graceUntil,
  kstDayOfMonth,
  kstStartOfDay,
  nextRetryAt,
  reminderFrom,
  reminderLeadMs,
  upcomingChargeAt,
} from "../src/lib/billing/period";

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
  it("월간: 12월 → 다음 해 1월(같은 앵커일·같은 시각), 12/31 앵커도 1/31", () => {
    expect(addInterval("2026-12-15T01:00:00.000Z", "month", 15)).toBe("2027-01-15T01:00:00.000Z");
    // 2026-12-31 10:00 KST = 01:00Z
    expect(addInterval("2026-12-31T01:00:00.000Z", "month", 31)).toBe("2027-01-31T01:00:00.000Z");
  });
  it("kstDayOfMonth", () => {
    expect(kstDayOfMonth(Date.parse("2026-10-30T15:30:00Z"))).toBe(31);
  });
  it("입력이 잘못되면 던진다 — 파싱할 수 없는 시각, 1~31 밖이거나 정수가 아닌 앵커일", () => {
    expect(() => addInterval("not-a-date", "month", 15)).toThrow();
    expect(() => addInterval("", "year", 15)).toThrow();
    for (const bad of [0, 32, -1, 15.5, Number.NaN]) {
      expect(() => addInterval("2026-10-15T01:00:00.000Z", "month", bad), String(bad)).toThrow();
    }
    expect(addInterval("2026-10-15T01:00:00.000Z", "month", 1)).toBe("2026-11-01T01:00:00.000Z");
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
  it("유예가 끝났는지 — 저장된 유예 기한, 없으면 기간 끝 + 7일(그 시각부터 끝)", () => {
    const grace = Date.parse("2026-11-22T01:00:00.000Z");
    expect(graceOver({ grace_until: "2026-11-22T01:00:00.000Z", current_period_end: due }, grace - 1)).toBe(false);
    expect(graceOver({ grace_until: "2026-11-22T01:00:00+00:00", current_period_end: due }, grace)).toBe(true);
    expect(graceOver({ grace_until: null, current_period_end: due }, grace - 1)).toBe(false);
    expect(graceOver({ grace_until: null, current_period_end: due }, grace)).toBe(true);
  });
});

describe("결제 예정 안내 시각 — 알리는 결제일의 KST 0시 기준", () => {
  it("kstStartOfDay: 그 시각이 속한 KST 날짜의 0시", () => {
    // 2026-02-27 01:00 KST = 2026-02-26T16:00Z → 2026-02-27 00:00 KST = 2026-02-26T15:00Z
    expect(kstStartOfDay(Date.parse("2026-02-26T16:00:00.000Z"))).toBe(Date.parse("2026-02-26T15:00:00.000Z"));
    // KST 0시 정각은 그대로, 23:59:59.999는 그날 0시
    expect(kstStartOfDay(Date.parse("2026-02-26T15:00:00.000Z"))).toBe(Date.parse("2026-02-26T15:00:00.000Z"));
    expect(kstStartOfDay(Date.parse("2026-02-27T14:59:59.999Z"))).toBe(Date.parse("2026-02-26T15:00:00.000Z"));
  });
  it("월간: 결제일(기간 끝 하루 전)의 KST 0시에서 7일 전 — 그날 10시 크론이 정확히 D-7에 보낸다", () => {
    // 기간 끝 2026-02-28 01:00 KST → 결제일 2026-02-27 → 안내는 2026-02-20 00:00 KST부터
    expect(reminderFrom("2026-02-27T16:00:00.000Z", "month")).toBe(Date.parse("2026-02-19T15:00:00.000Z"));
    // 기간 끝 15:00 KST여도 결제일 날짜 기준이라 같은 날 0시
    expect(reminderFrom("2026-02-28T06:00:00.000Z", "month")).toBe(Date.parse("2026-02-19T15:00:00.000Z"));
  });
  it("연간: 결제일의 KST 0시에서 30일 전", () => {
    // 기간 끝 2027-01-31 01:00 KST → 결제일 2027-01-30 → 안내는 2026-12-31 00:00 KST부터
    expect(reminderFrom("2027-01-30T16:00:00.000Z", "year")).toBe(Date.parse("2026-12-30T15:00:00.000Z"));
  });
});

describe("upcomingChargeAt — 화면의 다음 결제일", () => {
  const END = "2026-02-27T16:00:00.000Z";
  const earliest = Date.parse(END) - CHARGE_LEAD_MS;

  it("가장 이른 청구 시각 전이면 그 시각(기간 끝 하루 전)", () => {
    expect(upcomingChargeAt(END, earliest - 5 * 86_400_000)).toBe(new Date(earliest).toISOString());
  });

  it("이미 지났으면(마지막 날·크론 대기) 지난 날짜가 아니라 지금", () => {
    const now = earliest + 3_600_000;
    expect(upcomingChargeAt(END, now)).toBe(new Date(now).toISOString());
    expect(upcomingChargeAt(END, Date.parse(END) + 3_600_000)).toBe(new Date(Date.parse(END) + 3_600_000).toISOString());
  });
});
