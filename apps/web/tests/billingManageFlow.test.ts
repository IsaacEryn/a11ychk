import { describe, expect, it } from "vitest";
import { cancelSubscription, endSubscriptionsForDeletion, resumeSubscription } from "../src/lib/billing/flows/manage";
import type { CustomerRow, SubscriptionRow } from "../src/lib/billing/types";
import {
  DAY,
  MIN,
  NOW,
  createMemoryStore,
  customerRow,
  iso,
  makeDeps,
  paymentRow,
  pgTime,
  subscriptionRow,
  type FakeDeps,
  type MemoryRows,
} from "./billingFakes";

const USER = "11111111-1111-4111-8111-111111111111";
const USER2 = "22222222-2222-4222-8222-222222222222";
const CARD = { issuerCode: "61", number: "1234****", cardType: "신용" };
const OLD_KEY = "v1:old-iv:old-tag:old-ct";

/** 결제 관리(해지·재개) 흐름 — 사용자 요청 경로라 모드(livemode)는 액션이 정해 넘긴다. 이 파일은 test 모드(false) 기준 */
const LIVEMODE = false;

function setup(seed: Partial<MemoryRows> = {}): FakeDeps {
  return makeDeps({ store: createMemoryStore(seed, { now: () => NOW }), now: () => NOW });
}

const keyed = (over: Partial<CustomerRow> = {}) =>
  customerRow({ user_id: USER, livemode: LIVEMODE, toss_billing_key_enc: OLD_KEY, toss_card_summary: CARD, ...over });

/** 미납 구독 — 결제 예정 시각(기간 끝)이 이틀 지났고 유예가 5일 남았다 */
const pastDue = (over: Partial<SubscriptionRow> = {}) =>
  subscriptionRow({
    user_id: USER,
    status: "past_due",
    current_period_start: iso(NOW - 30 * DAY),
    current_period_end: iso(NOW - 2 * DAY),
    dunning_attempts: 1,
    next_retry_at: iso(NOW + DAY),
    grace_until: iso(NOW + 5 * DAY),
    ...over,
  });

describe("cancelSubscription — 해지", () => {
  it("active·예약 없음 → 기간 끝 해지 예약(scheduled) + cancelScheduled 메일(끝나는 날 = 기간 끝). 결제·카드는 그대로", async () => {
    const sub = subscriptionRow({ user_id: USER });
    const customer = keyed();
    const deps = setup({ subscriptions: [sub], customers: [customer] });

    expect(await cancelSubscription(deps, USER, LIVEMODE)).toBe("scheduled");

    const row = deps.store.rows.subscriptions[0];
    expect(row).toMatchObject({ status: "active", cancel_at_period_end: true, canceled_at: pgTime(NOW), ended_at: null });
    expect(row.current_period_end).toBe(pgTime(sub.current_period_end));
    expect(deps.store.rows.customers[0].toss_billing_key_enc).toBe(OLD_KEY);
    expect(deps.mailer.sent).toEqual([{ userId: USER, kind: "cancelScheduled", data: { planName: "Pro", endsAt: pgTime(sub.current_period_end) } }]);
    expect(deps.toss.calls.chargeBillingKey).toHaveLength(0);
  });

  it("이미 해지 예약이면 already — 예약 시각·메일을 다시 만들지 않는다", async () => {
    const earlier = iso(NOW - 3 * DAY);
    const deps = setup({ subscriptions: [subscriptionRow({ user_id: USER, cancel_at_period_end: true, canceled_at: earlier })] });

    expect(await cancelSubscription(deps, USER, LIVEMODE)).toBe("already");
    expect(await cancelSubscription(deps, USER, LIVEMODE)).toBe("already");
    expect(deps.store.rows.subscriptions[0].canceled_at).toBe(pgTime(earlier));
    expect(deps.mailer.sent).toHaveLength(0);
  });

  it("past_due → 바로 끝냄(endedNow): ended·user_canceled·ended_at, 빌링키·카드 요약을 지우고 ended(canceled) 메일", async () => {
    const deps = setup({ subscriptions: [pastDue()], customers: [keyed()] });

    expect(await cancelSubscription(deps, USER, LIVEMODE)).toBe("endedNow");

    expect(deps.store.rows.subscriptions[0]).toMatchObject({ status: "ended", ended_reason: "user_canceled", ended_at: pgTime(NOW) });
    expect(deps.store.rows.customers[0]).toMatchObject({ toss_billing_key_enc: null, toss_card_summary: null });
    expect(deps.mailer.sent).toEqual([{ userId: USER, kind: "ended", data: { planName: "Pro", reason: "canceled" } }]);
    expect(deps.toss.calls.chargeBillingKey).toHaveLength(0);
  });

  it("past_due 즉시 종료의 키 정리는 읽은 암호문일 때만 — 그 사이 새 결제창이 쓴 빌링키는 남긴다", async () => {
    const deps = setup({ subscriptions: [pastDue()], customers: [keyed()] });
    const read = deps.store.getCustomer.bind(deps.store);
    deps.store.getCustomer = async (userId, livemode) => {
      const row = await read(userId, livemode);
      // 읽은 직후 다른 시도가 새 빌링키를 썼다
      deps.store.rows.customers[0].toss_billing_key_enc = "v1:new-iv:new-tag:new-ct";
      return row;
    };

    expect(await cancelSubscription(deps, USER, LIVEMODE)).toBe("endedNow");
    expect(deps.store.rows.customers[0].toss_billing_key_enc).toBe("v1:new-iv:new-tag:new-ct");
  });

  it("past_due 즉시 종료 뒤 키 정리가 실패해도 결과는 endedNow — 운영자 확인을 남기고(값 없이) 메일은 보낸다", async () => {
    const deps = setup({ subscriptions: [pastDue()], customers: [keyed()] });
    deps.store.clearCustomerKeyIf = async () => {
      throw new Error("billing store clearCustomerKeyIf: connection reset");
    };

    expect(await cancelSubscription(deps, USER, LIVEMODE)).toBe("endedNow");
    const logged = deps.log.mock.calls.map(([m]) => m).join("\n");
    expect(logged).toContain("needs review: key cleanup");
    expect(logged).not.toContain(OLD_KEY);
    expect(deps.mailer.sent.map((m) => m.kind)).toEqual(["ended"]);
  });

  it("past_due인데 결과를 모르는 결제가 있으면 busy — 끝내지 않는다(그 재시도가 실제로 청구됐을 수 있다)", async () => {
    const sub = pastDue();
    const pending = paymentRow({
      user_id: USER,
      subscription_id: sub.id,
      kind: "retry",
      attempt: 2,
      period_start: sub.current_period_end,
      status: "pending",
      requested_at: iso(NOW - MIN),
    });
    const deps = setup({ subscriptions: [sub], customers: [keyed()], payments: [pending] });

    expect(await cancelSubscription(deps, USER, LIVEMODE)).toBe("busy");
    expect(deps.store.rows.subscriptions[0]).toMatchObject({ status: "past_due", ended_at: null, cancel_at_period_end: false });
    expect(deps.store.rows.customers[0].toss_billing_key_enc).toBe(OLD_KEY);
    expect(deps.mailer.sent).toHaveLength(0);
  });

  it("진행 중 구독이 없거나 토스 구독이 아니면 notFound — 다른 모드·다른 사람·기관 계약은 건드리지 않는다", async () => {
    const otherMode = subscriptionRow({ user_id: USER, livemode: true });
    const others = subscriptionRow({ user_id: USER2 });
    const ended = subscriptionRow({ user_id: USER, status: "ended", ended_reason: "user_canceled", ended_at: iso(NOW - DAY) });
    const deps = setup({ subscriptions: [otherMode, others, ended] });
    expect(await cancelSubscription(deps, USER, LIVEMODE)).toBe("notFound");

    const contract = subscriptionRow({ user_id: USER2, provider: "manual", livemode: true, interval: "contract", price_id: null, billing_anchor_day: null });
    const deps2 = setup({ subscriptions: [contract] });
    expect(await cancelSubscription(deps2, USER2, true)).toBe("notFound");

    for (const d of [deps, deps2]) {
      expect(d.store.rows.subscriptions.every((s) => !s.cancel_at_period_end)).toBe(true);
      expect(d.mailer.sent).toHaveLength(0);
    }
    expect(deps.store.rows.subscriptions.map((s) => s.status)).toEqual(["active", "active", "ended"]);
    expect(deps2.store.rows.subscriptions[0].status).toBe("active");
  });

  describe("읽은 뒤 바뀐 경우(조건부 갱신이 false) — 다시 읽어 있는 그대로 알린다", () => {
    /** 첫 조건부 갱신 직전에 change를 실행한다 — 크론·다른 요청이 그 사이 끼어든 것 */
    function interleave(deps: FakeDeps, change: () => void) {
      const update = deps.store.updateSubscriptionIf.bind(deps.store);
      let first = true;
      deps.store.updateSubscriptionIf = async (id, expected, patch) => {
        if (first) {
          first = false;
          change();
        }
        return update(id, expected, patch);
      };
    }

    it("그 사이 크론이 끝냈으면 notFound — 끝난 구독을 되살리거나 덮지 않는다", async () => {
      const deps = setup({ subscriptions: [pastDue({ grace_until: iso(NOW - MIN) })], customers: [keyed()] });
      interleave(deps, () => {
        Object.assign(deps.store.rows.subscriptions[0], { status: "ended", ended_reason: "payment_failed", ended_at: pgTime(NOW - 1000) });
      });

      expect(await cancelSubscription(deps, USER, LIVEMODE)).toBe("notFound");
      expect(deps.store.rows.subscriptions[0]).toMatchObject({ status: "ended", ended_reason: "payment_failed", ended_at: pgTime(NOW - 1000) });
      expect(deps.mailer.sent).toHaveLength(0);
    });

    it("그 사이 다른 요청이 해지를 예약했으면 already — 이 요청은 메일을 보내지 않는다", async () => {
      const deps = setup({ subscriptions: [subscriptionRow({ user_id: USER })] });
      interleave(deps, () => {
        Object.assign(deps.store.rows.subscriptions[0], { cancel_at_period_end: true, canceled_at: pgTime(NOW - 1000) });
      });

      expect(await cancelSubscription(deps, USER, LIVEMODE)).toBe("already");
      expect(deps.store.rows.subscriptions[0].canceled_at).toBe(pgTime(NOW - 1000));
      expect(deps.mailer.sent).toHaveLength(0);
    });

    it("그 사이 크론이 갱신해 기간이 넘어갔으면 새 기간 끝으로 예약한다(실제로 바꾼 것만 알린다)", async () => {
      const sub = subscriptionRow({ user_id: USER, current_period_end: iso(NOW + 12 * 3_600_000) });
      const nextEnd = iso(NOW + 12 * 3_600_000 + 28 * DAY);
      const deps = setup({ subscriptions: [sub] });
      interleave(deps, () => {
        Object.assign(deps.store.rows.subscriptions[0], { current_period_start: pgTime(sub.current_period_end), current_period_end: pgTime(nextEnd) });
      });

      expect(await cancelSubscription(deps, USER, LIVEMODE)).toBe("scheduled");
      expect(deps.store.rows.subscriptions[0]).toMatchObject({ cancel_at_period_end: true, current_period_end: pgTime(nextEnd) });
      expect(deps.mailer.sent).toEqual([{ userId: USER, kind: "cancelScheduled", data: { planName: "Pro", endsAt: pgTime(nextEnd) } }]);
    });

    it("그 사이 카드 변경 재결제로 past_due가 active가 됐으면 바로 끝내지 않고 기간 끝 해지 예약으로", async () => {
      const sub = pastDue();
      const nextEnd = iso(Date.parse(sub.current_period_end) + 28 * DAY);
      const deps = setup({ subscriptions: [sub], customers: [keyed()] });
      interleave(deps, () => {
        Object.assign(deps.store.rows.subscriptions[0], {
          status: "active",
          current_period_start: pgTime(sub.current_period_end),
          current_period_end: pgTime(nextEnd),
          dunning_attempts: 0,
          next_retry_at: null,
          grace_until: null,
        });
      });

      expect(await cancelSubscription(deps, USER, LIVEMODE)).toBe("scheduled");
      expect(deps.store.rows.subscriptions[0]).toMatchObject({ status: "active", cancel_at_period_end: true, ended_at: null });
      expect(deps.store.rows.customers[0].toss_billing_key_enc).toBe(OLD_KEY);
      expect(deps.mailer.sent.map((m) => m.kind)).toEqual(["cancelScheduled"]);
    });

    it("조건부 갱신이 계속 실패하면 성공으로 알리지 않는다(busy) — 행·메일 그대로", async () => {
      const deps = setup({ subscriptions: [subscriptionRow({ user_id: USER })] });
      deps.store.updateSubscriptionIf = async () => false;

      expect(await cancelSubscription(deps, USER, LIVEMODE)).toBe("busy");
      expect(deps.store.rows.subscriptions[0].cancel_at_period_end).toBe(false);
      expect(deps.mailer.sent).toHaveLength(0);
    });
  });
});

describe("resumeSubscription — 해지 취소(재개)", () => {
  it("해지 예약·기간 끝 전 → resumed: 예약을 풀고 해지 시각을 지운다", async () => {
    const deps = setup({ subscriptions: [subscriptionRow({ user_id: USER, cancel_at_period_end: true, canceled_at: iso(NOW - DAY) })] });

    expect(await resumeSubscription(deps, USER, LIVEMODE)).toBe("resumed");
    expect(deps.store.rows.subscriptions[0]).toMatchObject({ status: "active", cancel_at_period_end: false, canceled_at: null });
    expect(deps.mailer.sent).toHaveLength(0);
  });

  it("기간이 이미 끝났으면(크론이 아직 끝내지 않았어도) tooLate — 그대로 둔다", async () => {
    const sub = subscriptionRow({
      user_id: USER,
      cancel_at_period_end: true,
      canceled_at: iso(NOW - 10 * DAY),
      current_period_start: iso(NOW - 30 * DAY),
      current_period_end: iso(NOW),
    });
    const deps = setup({ subscriptions: [sub] });

    expect(await resumeSubscription(deps, USER, LIVEMODE)).toBe("tooLate");
    expect(deps.store.rows.subscriptions[0]).toMatchObject({ cancel_at_period_end: true, canceled_at: pgTime(NOW - 10 * DAY) });
  });

  it("예약이 없는 active·past_due·진행 중 구독 없음·기관 계약은 notFound", async () => {
    const active = setup({ subscriptions: [subscriptionRow({ user_id: USER })] });
    expect(await resumeSubscription(active, USER, LIVEMODE)).toBe("notFound");

    // 미납은 해지 예약 상태가 아니다 — 재개가 아니라 카드 변경으로 푼다
    const due = setup({ subscriptions: [pastDue({ cancel_at_period_end: true })] });
    expect(await resumeSubscription(due, USER, LIVEMODE)).toBe("notFound");
    expect(due.store.rows.subscriptions[0].cancel_at_period_end).toBe(true);

    expect(await resumeSubscription(setup(), USER, LIVEMODE)).toBe("notFound");

    const contract = subscriptionRow({
      user_id: USER,
      provider: "manual",
      livemode: true,
      interval: "contract",
      cancel_at_period_end: true,
      price_id: null,
      billing_anchor_day: null,
    });
    expect(await resumeSubscription(setup({ subscriptions: [contract] }), USER, true)).toBe("notFound");
  });

  it("그 사이 크론이 끝냈으면 notFound, 다른 요청이 먼저 재개했어도 notFound(성공으로 알리지 않는다)", async () => {
    for (const change of [
      (s: SubscriptionRow) => Object.assign(s, { status: "ended", ended_reason: "user_canceled", ended_at: pgTime(NOW) }),
      (s: SubscriptionRow) => Object.assign(s, { cancel_at_period_end: false, canceled_at: null }),
    ]) {
      const deps = setup({ subscriptions: [subscriptionRow({ user_id: USER, cancel_at_period_end: true, canceled_at: iso(NOW - DAY) })] });
      const update = deps.store.updateSubscriptionIf.bind(deps.store);
      let first = true;
      deps.store.updateSubscriptionIf = async (id, expected, patch) => {
        if (first) {
          first = false;
          change(deps.store.rows.subscriptions[0]);
        }
        return update(id, expected, patch);
      };
      expect(await resumeSubscription(deps, USER, LIVEMODE)).toBe("notFound");
    }
  });
});

describe("endSubscriptionsForDeletion — 탈퇴 전 정리", () => {
  it("두 모드의 진행 중 토스 구독을 모두 끝내고(user_canceled) 그 모드의 빌링키를 지운다 — 메일 없음, 개수를 돌려준다", async () => {
    const live = subscriptionRow({ user_id: USER, livemode: true });
    const test = pastDue({ livemode: false });
    const ended = subscriptionRow({ user_id: USER, status: "ended", ended_reason: "payment_failed", ended_at: iso(NOW - 40 * DAY) });
    const others = subscriptionRow({ user_id: USER2 });
    const store = createMemoryStore({
      subscriptions: [live, test, ended, others],
      customers: [
        keyed({ livemode: true }),
        keyed({ livemode: false, toss_billing_key_enc: "v1:test-iv:test-tag:test-ct" }),
        customerRow({ user_id: USER2, livemode: false, toss_billing_key_enc: OLD_KEY, toss_card_summary: CARD }),
      ],
    });

    expect(await endSubscriptionsForDeletion(store, USER, NOW)).toBe(2);

    const byId = (id: string) => store.rows.subscriptions.find((s) => s.id === id)!;
    for (const id of [live.id, test.id]) {
      expect(byId(id)).toMatchObject({ status: "ended", ended_reason: "user_canceled", ended_at: pgTime(NOW) });
    }
    expect(byId(ended.id)).toMatchObject({ ended_reason: "payment_failed", ended_at: pgTime(NOW - 40 * DAY) });
    expect(byId(others.id).status).toBe("active");
    const mine = store.rows.customers.filter((c) => c.user_id === USER);
    expect(mine.map((c) => [c.toss_billing_key_enc, c.toss_card_summary])).toEqual([
      [null, null],
      [null, null],
    ]);
    expect(store.rows.customers.find((c) => c.user_id === USER2)?.toss_billing_key_enc).toBe(OLD_KEY);
  });

  it("기관 계약(manual)은 건드리지 않고, 끝낸 구독이 없는 모드의 고객 행도 그대로", async () => {
    const contract = subscriptionRow({ user_id: USER, provider: "manual", livemode: true, interval: "contract", price_id: null, billing_anchor_day: null });
    const test = subscriptionRow({ user_id: USER, livemode: false });
    const store = createMemoryStore({
      subscriptions: [contract, test],
      customers: [keyed({ livemode: true }), keyed({ livemode: false })],
    });

    expect(await endSubscriptionsForDeletion(store, USER, NOW)).toBe(1);
    expect(store.rows.subscriptions.find((s) => s.id === contract.id)).toMatchObject({ status: "active", ended_at: null });
    expect(store.rows.subscriptions.find((s) => s.id === test.id)?.status).toBe("ended");
    expect(store.rows.customers.find((c) => c.livemode)?.toss_billing_key_enc).toBe(OLD_KEY);
    expect(store.rows.customers.find((c) => !c.livemode)?.toss_billing_key_enc).toBeNull();
  });

  it("진행 중 구독이 없으면 0 — 아무것도 바꾸지 않는다. 그 사이 크론이 끝낸 구독은 세지 않는다", async () => {
    const store = createMemoryStore({ customers: [keyed()] });
    expect(await endSubscriptionsForDeletion(store, USER, NOW)).toBe(0);
    expect(store.rows.customers[0].toss_billing_key_enc).toBe(OLD_KEY);

    const sub = pastDue();
    const racing = createMemoryStore({ subscriptions: [sub], customers: [keyed()] });
    const update = racing.updateSubscriptionIf.bind(racing);
    racing.updateSubscriptionIf = async (id, expected, patch) => {
      Object.assign(racing.rows.subscriptions[0], { status: "ended", ended_reason: "payment_failed", ended_at: pgTime(NOW - 1000) });
      return update(id, expected, patch);
    };
    expect(await endSubscriptionsForDeletion(racing, USER, NOW)).toBe(0);
    expect(racing.rows.subscriptions[0].ended_reason).toBe("payment_failed");
  });
});
