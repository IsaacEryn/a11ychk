import { describe, expect, it } from "vitest";
import { decideRenewalAction } from "../src/lib/billing/flows/renew";
import { CHARGE_IN_MS, REMIND_IN_MS, parsePullDue, planPullDue, type PullableSubscription } from "../src/lib/billing/pullDue";
import type { SubscriptionRow } from "../src/lib/billing/types";

const SID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const NOW = Date.parse("2026-12-01T00:00:00Z");
const DAY = 86_400_000;
const iso = (t: number) => new Date(t).toISOString();

function fd(entries: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  return f;
}

/** 크론 판정(decideRenewalAction)에 넣을 완전한 구독 행 */
function row(over: Partial<SubscriptionRow> = {}): SubscriptionRow {
  return {
    id: SID,
    user_id: "user-1",
    provider: "toss",
    livemode: false,
    plan_code: "pro",
    status: "active",
    ended_reason: null,
    price_id: null,
    amount: 1234,
    currency: "KRW",
    interval: "month",
    current_period_start: iso(NOW - 20 * DAY),
    current_period_end: iso(NOW + 10 * DAY),
    billing_anchor_day: null,
    cancel_at_period_end: false,
    canceled_at: null,
    ended_at: null,
    dunning_attempts: 0,
    next_retry_at: null,
    grace_until: null,
    reminder_sent_for: null,
    ...over,
  };
}

const pullable = (r: SubscriptionRow): PullableSubscription => ({
  status: r.status as "active" | "past_due",
  current_period_start: r.current_period_start,
  current_period_end: r.current_period_end,
  next_retry_at: r.next_retry_at,
  grace_until: r.grace_until,
});

/** 계획이 만든 patch를 행에 적용한 결과 */
function applied(r: SubscriptionRow, patch: Record<string, string | null>): SubscriptionRow {
  return { ...r, ...patch } as SubscriptionRow;
}

describe("parsePullDue", () => {
  it("target을 보내지 않거나 비우면 charge", () => {
    expect(parsePullDue(fd({ subscriptionId: SID }))).toEqual({ ok: true, value: { subscriptionId: SID, target: "charge" } });
    expect(parsePullDue(fd({ subscriptionId: SID, target: "" }))).toEqual({ ok: true, value: { subscriptionId: SID, target: "charge" } });
  });

  it("charge·remind를 받는다", () => {
    for (const target of ["charge", "remind"] as const) {
      expect(parsePullDue(fd({ subscriptionId: SID, target }))).toEqual({ ok: true, value: { subscriptionId: SID, target } });
    }
  });

  it("모르는 target·UUID가 아닌 id는 invalid", () => {
    expect(parsePullDue(fd({ subscriptionId: SID, target: "retry" }))).toEqual({ ok: false, error: "invalid" });
    expect(parsePullDue(fd({ subscriptionId: SID, target: "CHARGE" }))).toEqual({ ok: false, error: "invalid" });
    expect(parsePullDue(fd({ subscriptionId: "x", target: "charge" }))).toEqual({ ok: false, error: "invalid" });
    expect(parsePullDue(fd({}))).toEqual({ ok: false, error: "invalid" });
  });
});

describe("planPullDue — 진행 중(active)", () => {
  it("charge: 기간 끝을 지금 + 1분으로, 안내 기록을 비우고, 시작은 건드리지 않는다", () => {
    const r = row();
    const plan = planPullDue(pullable(r), "charge", NOW);
    expect(plan).toMatchObject({ ok: true, kind: "charge", from: r.current_period_end, to: iso(NOW + CHARGE_IN_MS) });
    if (!plan.ok) throw new Error("unreachable");
    expect(Object.keys(plan.patch).sort()).toEqual(["current_period_end", "reminder_sent_for", "updated_at"]);
    expect(plan.patch.current_period_end).toBe(iso(NOW + 60_000));
    expect(plan.patch.reminder_sent_for).toBeNull();
    // 크론이 읽으면 갱신 결제 대상
    expect(decideRenewalAction(r, NOW)).toBe("none");
    expect(decideRenewalAction(applied(r, plan.patch), NOW)).toBe("charge");
  });

  it.each(["month", "year"] as const)("remind(%s): 기간 끝을 지금 + 2일로 — 안내 구간 안, 결제 구간 밖", (interval) => {
    const r = row({ interval });
    const plan = planPullDue(pullable(r), "remind", NOW);
    expect(plan).toMatchObject({ ok: true, kind: "remind", to: iso(NOW + REMIND_IN_MS) });
    if (!plan.ok) throw new Error("unreachable");
    expect(plan.patch.current_period_end).toBe(iso(NOW + 2 * DAY));
    expect(plan.patch.reminder_sent_for).toBeNull();
    expect(decideRenewalAction(applied(r, plan.patch), NOW)).toBe("remind");
  });

  it("이미 안내를 보낸 기간이어도 remind는 안내 기록을 비워 다시 안내 대상이 된다", () => {
    const r = row({ reminder_sent_for: iso(NOW + 10 * DAY) });
    const sentAlready = row({ current_period_end: iso(NOW + 2 * DAY), reminder_sent_for: iso(NOW + 2 * DAY) });
    expect(decideRenewalAction(sentAlready, NOW)).toBe("none");
    const plan = planPullDue(pullable(r), "remind", NOW);
    if (!plan.ok) throw new Error("unreachable");
    expect(decideRenewalAction(applied(r, plan.patch), NOW)).toBe("remind");
  });

  it("시작이 새 기간 끝보다 늦거나 같으면 시작을 지금 − 1분으로 맞춘다(end > start)", () => {
    for (const target of ["charge", "remind"] as const) {
      const end = NOW + (target === "charge" ? CHARGE_IN_MS : REMIND_IN_MS);
      for (const start of [end, end + 5 * DAY]) {
        const plan = planPullDue({ ...pullable(row()), current_period_start: iso(start) }, target, NOW);
        if (!plan.ok) throw new Error("unreachable");
        expect(plan.patch.current_period_start).toBe(iso(NOW - 60_000));
        expect(Date.parse(plan.patch.current_period_start as string)).toBeLessThan(Date.parse(plan.patch.current_period_end as string));
      }
    }
  });

  it("시작이 새 기간 끝보다 이르면 시작은 그대로", () => {
    const plan = planPullDue({ ...pullable(row()), current_period_start: iso(NOW + CHARGE_IN_MS - 1) }, "charge", NOW);
    if (!plan.ok) throw new Error("unreachable");
    expect(plan.patch).not.toHaveProperty("current_period_start");
  });
});

describe("planPullDue — 미납(past_due)", () => {
  const pastDue = (over: Partial<SubscriptionRow> = {}) =>
    row({
      status: "past_due",
      current_period_start: iso(NOW - 33 * DAY),
      current_period_end: iso(NOW - 3 * DAY),
      dunning_attempts: 1,
      next_retry_at: iso(NOW + 2 * DAY),
      grace_until: iso(NOW + 4 * DAY),
      ...over,
    });

  it("다음 재시도 시점만 지금으로 — 기간·유예 기한·안내 기록은 건드리지 않는다", () => {
    const r = pastDue();
    const plan = planPullDue(pullable(r), "charge", NOW);
    expect(plan).toMatchObject({ ok: true, kind: "retry", from: r.next_retry_at, to: iso(NOW) });
    if (!plan.ok) throw new Error("unreachable");
    expect(Object.keys(plan.patch).sort()).toEqual(["next_retry_at", "updated_at"]);
    expect(plan.patch.next_retry_at).toBe(iso(NOW));
    // 크론이 읽으면 재시도 대상
    expect(decideRenewalAction(r, NOW)).toBe("none");
    expect(decideRenewalAction(applied(r, plan.patch), NOW)).toBe("retry");
  });

  it("target은 무시한다 — remind를 보내도 같은 결과", () => {
    const r = pastDue();
    expect(planPullDue(pullable(r), "remind", NOW)).toEqual(planPullDue(pullable(r), "charge", NOW));
  });

  it("유예 기한이 지났으면 graceOver (경계: 같은 시각도 지난 것)", () => {
    expect(planPullDue(pullable(pastDue({ grace_until: iso(NOW - 1) })), "charge", NOW)).toEqual({ ok: false, error: "graceOver" });
    expect(planPullDue(pullable(pastDue({ grace_until: iso(NOW) })), "charge", NOW)).toEqual({ ok: false, error: "graceOver" });
    expect(planPullDue(pullable(pastDue({ grace_until: iso(NOW + 1) })), "charge", NOW).ok).toBe(true);
  });

  it("유예 기한이 비어 있으면 크론과 같이 기간 끝 + 7일로 판정한다", () => {
    // 기간 끝 3일 전 → 유예까지 4일 남음
    expect(planPullDue(pullable(pastDue({ grace_until: null })), "charge", NOW).ok).toBe(true);
    // 기간 끝 8일 전 → 유예 지남
    expect(
      planPullDue(pullable(pastDue({ grace_until: null, current_period_end: iso(NOW - 8 * DAY), current_period_start: iso(NOW - 38 * DAY) })), "charge", NOW),
    ).toEqual({ ok: false, error: "graceOver" });
  });
});
