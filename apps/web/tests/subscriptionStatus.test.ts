import { describe, expect, it } from "vitest";
import { RENEWAL_GRACE_MS, isSubscriptionEntitled } from "../src/lib/entitlements";
import { displayStatus } from "../src/app/[locale]/admin/billing/subscriptionStatus";

const NOW = Date.parse("2026-03-10T00:00:00.000Z");
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const at = (t: number) => new Date(t).toISOString();

/** 카드 구독 한 건 — 기본은 기간 한가운데의 진행 중 */
const sub = (over: Partial<Parameters<typeof displayStatus>[0]> = {}) => ({
  provider: "toss" as const,
  status: "active" as const,
  current_period_start: at(NOW - 10 * DAY),
  current_period_end: at(NOW + 20 * DAY),
  grace_until: null,
  cancel_at_period_end: false,
  ...over,
});

describe("displayStatus — 권한 판정(isSubscriptionEntitled)과 같은 기준의 화면 상태", () => {
  it("기간 안의 진행 중 구독은 원래 상태 그대로", () => {
    expect(displayStatus(sub(), NOW)).toBe("active");
  });

  it("미납 유예 중인 past_due는 기간이 지났어도 past_due로 보인다(권한이 아직 있다)", () => {
    const s = sub({ status: "past_due", current_period_end: at(NOW - 2 * DAY), grace_until: at(NOW + 5 * DAY) });
    expect(isSubscriptionEntitled(s, NOW)).toBe(true);
    expect(displayStatus(s, NOW)).toBe("past_due");
  });

  it("유예가 끝난 past_due는 expired", () => {
    const s = sub({ status: "past_due", current_period_end: at(NOW - 9 * DAY), grace_until: at(NOW - HOUR) });
    expect(displayStatus(s, NOW)).toBe("expired");
  });

  it("카드 구독은 기간 끝 뒤 48시간 여유 동안 active로 보이고, 여유가 지나면 expired", () => {
    const inGrace = sub({ current_period_end: at(NOW - HOUR) });
    expect(isSubscriptionEntitled(inGrace, NOW)).toBe(true);
    expect(displayStatus(inGrace, NOW)).toBe("active");

    const pastGrace = sub({ current_period_end: at(NOW - RENEWAL_GRACE_MS - HOUR) });
    expect(displayStatus(pastGrace, NOW)).toBe("expired");
  });

  it("기관 계약(manual)은 여유 없이 기간 끝에 expired", () => {
    const valid = sub({ provider: "manual", current_period_end: at(NOW + HOUR) });
    expect(displayStatus(valid, NOW)).toBe("active");

    const lapsed = sub({ provider: "manual", current_period_end: at(NOW - HOUR) });
    expect(isSubscriptionEntitled(lapsed, NOW)).toBe(false);
    expect(displayStatus(lapsed, NOW)).toBe("expired");
  });

  it("해지 예약은 48시간 여유가 없다 — 기간 끝이 지났으면 expired (크론이 곧 끝낸다)", () => {
    const scheduled = sub({ cancel_at_period_end: true, current_period_end: at(NOW - HOUR) });
    expect(isSubscriptionEntitled(scheduled, NOW)).toBe(false);
    expect(displayStatus(scheduled, NOW)).toBe("expired");

    // 기간 안의 해지 예약은 아직 active
    expect(displayStatus(sub({ cancel_at_period_end: true }), NOW)).toBe("active");
  });

  it("ended는 기간이 남아 있어도 ended", () => {
    expect(displayStatus(sub({ status: "ended" }), NOW)).toBe("ended");
    expect(displayStatus(sub({ status: "ended", current_period_end: at(NOW - 30 * DAY) }), NOW)).toBe("ended");
  });

  it("아직 시작하지 않은 기관 계약은 expired가 아니라 원래 상태 — 기간이 끝난 것이 아니다", () => {
    const upcoming = sub({ provider: "manual", current_period_start: at(NOW + 5 * DAY), current_period_end: at(NOW + 35 * DAY) });
    expect(isSubscriptionEntitled(upcoming, NOW)).toBe(false);
    expect(displayStatus(upcoming, NOW)).toBe("active");
  });

  it("now를 생략하면 지금 시각으로 판정한다", () => {
    expect(displayStatus(sub({ current_period_end: at(Date.now() + DAY) }))).toBe("active");
    expect(displayStatus(sub({ provider: "manual", current_period_end: at(Date.now() - DAY) }))).toBe("expired");
  });
});
