import { describe, expect, it, vi } from "vitest";
import { encryptBillingKey } from "../src/lib/billing/crypto";
import { cancelSubscription, endSubscriptionsForDeletion, resumeSubscription } from "../src/lib/billing/flows/manage";
import { decideRenewalAction, runBillingCycle } from "../src/lib/billing/flows/renew";
import type { CustomerRow, SubscriptionRow } from "../src/lib/billing/types";
import {
  DAY,
  MIN,
  NOW,
  createFakeToss,
  createMemoryStore,
  customerRow,
  iso,
  makeDeps,
  paymentRow,
  pgTime,
  subscriptionRow,
  tossPayment,
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

  it("past_due → 바로 끝냄(endedNow): 예약을 먼저 쓰고 ended·user_canceled·ended_at, 빌링키·카드 요약을 지우고 ended(canceledNow) 메일", async () => {
    const deps = setup({ subscriptions: [pastDue()], customers: [keyed()] });

    expect(await cancelSubscription(deps, USER, LIVEMODE)).toBe("endedNow");

    expect(deps.store.rows.subscriptions[0]).toMatchObject({
      status: "ended",
      ended_reason: "user_canceled",
      ended_at: pgTime(NOW),
      cancel_at_period_end: true,
      canceled_at: pgTime(NOW),
    });
    expect(deps.store.rows.customers[0]).toMatchObject({ toss_billing_key_enc: null, toss_card_summary: null });
    expect(deps.mailer.sent).toEqual([{ userId: USER, kind: "ended", data: { planName: "Pro", reason: "canceledNow" } }]);
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

  it("past_due인데 결과를 모르는 결제가 있으면 busy — 끝내지 않고 쓴 예약도 되돌린다(그 재시도가 실제로 청구됐을 수 있다)", async () => {
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
    expect(deps.store.rows.subscriptions[0]).toMatchObject({ status: "past_due", ended_at: null, cancel_at_period_end: false, canceled_at: null });
    expect(deps.store.rows.customers[0].toss_billing_key_enc).toBe(OLD_KEY);
    expect(deps.mailer.sent).toHaveLength(0);
  });

  it("active인데 결과를 모르는 결제(갱신)가 있으면 busy — 예약을 쓴 뒤 보고 되돌린다, 메일 없음", async () => {
    const sub = subscriptionRow({ user_id: USER, current_period_end: iso(NOW + 12 * 3_600_000) });
    const pending = paymentRow({ user_id: USER, subscription_id: sub.id, kind: "renewal", period_start: sub.current_period_end, requested_at: iso(NOW - MIN) });
    const deps = setup({ subscriptions: [sub], payments: [pending] });
    const writes: Array<boolean | undefined> = [];
    const update = deps.store.updateSubscriptionIf.bind(deps.store);
    deps.store.updateSubscriptionIf = async (id, expected, patch) => {
      writes.push(patch.cancel_at_period_end);
      return update(id, expected, patch);
    };

    expect(await cancelSubscription(deps, USER, LIVEMODE)).toBe("busy");
    // 먼저 쓰고(true) 보고 되돌렸다(false)
    expect(writes).toEqual([true, false]);
    expect(deps.store.rows.subscriptions[0]).toMatchObject({ status: "active", cancel_at_period_end: false, canceled_at: null });
    expect(deps.mailer.sent).toHaveLength(0);
  });

  it("되돌리는 사이 그 결제가 확정돼 기간이 넘어갔으면 기록하고 다시 읽어 알린다(already) — 성공 메일 없음", async () => {
    const sub = subscriptionRow({ user_id: USER, current_period_end: iso(NOW + 12 * 3_600_000) });
    const nextEnd = iso(NOW + 12 * 3_600_000 + 28 * DAY);
    const pending = paymentRow({ user_id: USER, subscription_id: sub.id, kind: "renewal", period_start: sub.current_period_end, requested_at: iso(NOW - MIN) });
    const deps = setup({ subscriptions: [sub], payments: [pending] });
    const check = deps.store.hasPendingPayment.bind(deps.store);
    deps.store.hasPendingPayment = async (id) => {
      const result = await check(id);
      // 본 직후 대사가 paid로 확정해 기간을 전진시켰다(예약은 그대로 — settlePaid는 예약을 건드리지 않는다)
      deps.store.rows.payments[0].status = "paid";
      Object.assign(deps.store.rows.subscriptions[0], { current_period_start: pgTime(sub.current_period_end), current_period_end: pgTime(nextEnd) });
      return result;
    };

    expect(await cancelSubscription(deps, USER, LIVEMODE)).toBe("already");
    expect(deps.store.rows.subscriptions[0]).toMatchObject({ cancel_at_period_end: true, current_period_end: pgTime(nextEnd) });
    expect(deps.log.mock.calls.map(([m]) => m).join("\n")).toContain(`reverting the cancellation of subscription ${sub.id} failed`);
    expect(deps.mailer.sent).toHaveLength(0);
  });

  it("앞선 해지가 예약만 쓰고 멈춘 past_due(예약 있음)는 이어서 바로 끝낸다", async () => {
    const deps = setup({ subscriptions: [pastDue({ cancel_at_period_end: true, canceled_at: iso(NOW - MIN) })], customers: [keyed()] });

    expect(await cancelSubscription(deps, USER, LIVEMODE)).toBe("endedNow");
    expect(deps.store.rows.subscriptions[0]).toMatchObject({ status: "ended", ended_reason: "user_canceled", canceled_at: pgTime(NOW - MIN) });
    expect(deps.mailer.sent.map((m) => m.data.reason)).toEqual(["canceledNow"]);
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

    it("조건부 갱신이 계속 실패하면 성공으로 알리지 않는다(retryLater — 결제 확인 중인 busy와 다른 안내) — 행·메일 그대로", async () => {
      const deps = setup({ subscriptions: [subscriptionRow({ user_id: USER })] });
      deps.store.updateSubscriptionIf = async () => false;

      expect(await cancelSubscription(deps, USER, LIVEMODE)).toBe("retryLater");
      expect(await resumeSubscription(deps, USER, LIVEMODE)).toBe("notFound");
      deps.store.rows.subscriptions[0].cancel_at_period_end = true;
      expect(await resumeSubscription(deps, USER, LIVEMODE)).toBe("retryLater");
      deps.store.rows.subscriptions[0].cancel_at_period_end = false;
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
  /** 기록 대역 — 흐름이 남기는 "확인 필요" 줄을 모은다 */
  const logger = () => vi.fn<(message: string) => Promise<void>>(async () => undefined);

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
    const log = logger();

    expect(await endSubscriptionsForDeletion(store, USER, NOW, log)).toBe(2);

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
    expect(log).not.toHaveBeenCalled();
  });

  it("기관 계약(manual)은 건드리지 않고, 끝낸 구독이 없는 모드의 고객 행도 그대로", async () => {
    const contract = subscriptionRow({ user_id: USER, provider: "manual", livemode: true, interval: "contract", price_id: null, billing_anchor_day: null });
    const test = subscriptionRow({ user_id: USER, livemode: false });
    const store = createMemoryStore({
      subscriptions: [contract, test],
      customers: [keyed({ livemode: true }), keyed({ livemode: false })],
    });

    expect(await endSubscriptionsForDeletion(store, USER, NOW, logger())).toBe(1);
    expect(store.rows.subscriptions.find((s) => s.id === contract.id)).toMatchObject({ status: "active", ended_at: null });
    expect(store.rows.subscriptions.find((s) => s.id === test.id)?.status).toBe("ended");
    expect(store.rows.customers.find((c) => c.livemode)?.toss_billing_key_enc).toBe(OLD_KEY);
    expect(store.rows.customers.find((c) => !c.livemode)?.toss_billing_key_enc).toBeNull();
  });

  it("진행 중 구독이 없으면 0 — 아무것도 바꾸지 않는다. 그 사이 크론이 끝낸 구독은 세지 않는다", async () => {
    const store = createMemoryStore({ customers: [keyed()] });
    expect(await endSubscriptionsForDeletion(store, USER, NOW, logger())).toBe(0);
    expect(store.rows.customers[0].toss_billing_key_enc).toBe(OLD_KEY);

    const sub = pastDue();
    const racing = createMemoryStore({ subscriptions: [sub], customers: [keyed()] });
    const update = racing.updateSubscriptionIf.bind(racing);
    racing.updateSubscriptionIf = async (id, expected, patch) => {
      Object.assign(racing.rows.subscriptions[0], { status: "ended", ended_reason: "payment_failed", ended_at: pgTime(NOW - 1000) });
      return update(id, expected, patch);
    };
    const log = logger();
    expect(await endSubscriptionsForDeletion(racing, USER, NOW, log)).toBe(0);
    expect(racing.rows.subscriptions[0].ended_reason).toBe("payment_failed");
    // 끝내지 못한(크론이 먼저 끝낸) 구독은 이 호출이 확인하지 않는다 — 크론이 자기 결제를 확정한다
    expect(log).not.toHaveBeenCalled();
  });

  it("결과를 모르는(pending) 결제가 걸린 채 끝낸 구독은 탈퇴를 막지 않고 id만 기록에 남긴다 — 사용자·카드 정보는 넣지 않는다", async () => {
    const sub = subscriptionRow({ user_id: USER });
    const calm = subscriptionRow({ user_id: USER, livemode: true });
    const inFlight = paymentRow({ user_id: USER, subscription_id: sub.id, status: "pending", kind: "renewal" });
    const store = createMemoryStore({ subscriptions: [sub, calm], payments: [inFlight], customers: [keyed()] });
    const log = logger();

    expect(await endSubscriptionsForDeletion(store, USER, NOW, log)).toBe(2);

    expect(store.rows.subscriptions.every((s) => s.status === "ended")).toBe(true);
    expect(log).toHaveBeenCalledTimes(1);
    const line = log.mock.calls[0][0];
    expect(line.startsWith("billing needs review: account deleted with pending payment")).toBe(true);
    expect(line).toContain(sub.id);
    expect(line).not.toContain(calm.id);
    expect(line).not.toContain(USER);
    expect(line).not.toContain(OLD_KEY);
  });

  it("구독 없이 결과를 모르는 첫 결제만 남아도 두 모드 모두 확인해 기록한다", async () => {
    for (const livemode of [false, true]) {
      const store = createMemoryStore({ payments: [paymentRow({ user_id: USER, livemode, kind: "initial", status: "pending", subscription_id: null })] });
      const log = logger();

      expect(await endSubscriptionsForDeletion(store, USER, NOW, log)).toBe(0);

      expect(log).toHaveBeenCalledTimes(1);
      expect(log.mock.calls[0][0]).toMatch(/^billing needs review: account deleted with pending payment/);
      expect(log.mock.calls[0][0]).toContain("modes with pending initial payment: 1");
    }
  });

  it("다른 사용자의 pending 결제나 이미 확정된 결제는 기록하지 않는다", async () => {
    const sub = subscriptionRow({ user_id: USER });
    const store = createMemoryStore({
      subscriptions: [sub],
      payments: [
        paymentRow({ user_id: USER2, kind: "initial", status: "pending", subscription_id: null }),
        paymentRow({ user_id: USER, subscription_id: sub.id, status: "paid" }),
      ],
    });
    const log = logger();
    expect(await endSubscriptionsForDeletion(store, USER, NOW, log)).toBe(1);
    expect(log).not.toHaveBeenCalled();
  });

  it("끝낸 뒤 pending 확인이 실패해도 던지지 않는다 — 구독은 이미 끝났으니 탈퇴는 계속되고, 확인하지 못했음을 기록한다", async () => {
    const sub = subscriptionRow({ user_id: USER });
    const store = createMemoryStore({ subscriptions: [sub] });
    store.hasPendingPayment = async () => {
      throw new Error("billing store hasPendingPayment: timeout");
    };
    const log = logger();

    expect(await endSubscriptionsForDeletion(store, USER, NOW, log)).toBe(1);

    expect(store.rows.subscriptions[0].status).toBe("ended");
    expect(log).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0][0]).toMatch(/^billing needs review: account deleted without checking pending payments/);
    expect(log.mock.calls[0][0]).toContain("timeout");
  });

  it("구독을 읽거나 끝내는 데 실패하면 던진다 — 호출부가 탈퇴를 멈춘다. 이때 빌링키는 건드리지 않는다", async () => {
    const readFails = createMemoryStore({ subscriptions: [subscriptionRow({ user_id: USER })], customers: [keyed()] });
    readFails.listLiveSubscriptions = async () => {
      throw new Error("billing store listLiveSubscriptions: timeout");
    };
    await expect(endSubscriptionsForDeletion(readFails, USER, NOW, logger())).rejects.toThrow("listLiveSubscriptions");
    expect(readFails.rows.subscriptions[0].status).toBe("active");
    expect(readFails.rows.customers[0].toss_billing_key_enc).toBe(OLD_KEY);

    const writeFails = createMemoryStore({ subscriptions: [subscriptionRow({ user_id: USER })], customers: [keyed()] });
    writeFails.updateSubscriptionIf = async () => {
      throw new Error("billing store updateSubscriptionIf: timeout");
    };
    await expect(endSubscriptionsForDeletion(writeFails, USER, NOW, logger())).rejects.toThrow("updateSubscriptionIf");
    expect(writeFails.rows.customers[0].toss_billing_key_enc).toBe(OLD_KEY);
  });
});

describe("해지와 결제 크론의 경합 — 양쪽 다 먼저 쓰고 나중에 읽는다", () => {
  const HOUR = 3_600_000;
  const BILLING_KEY = "bk_plain_secret_0001";
  const done = (_bk: string, req: { orderId: string; amount: number }) =>
    tossPayment({ paymentKey: `pk_${req.orderId}`, orderId: req.orderId, totalAmount: req.amount });

  /** 크론이 결제할 수 있는 구독 — 빌링키(진짜 암호문)가 있는 고객 행과 함께 */
  function cronSetup(sub: SubscriptionRow, chargeSteps: Array<typeof done> = []) {
    const deps = makeDeps({ toss: createFakeToss({ chargeBillingKey: chargeSteps }), now: () => NOW });
    const enc = encryptBillingKey(BILLING_KEY, { userId: USER, livemode: LIVEMODE }, deps.encKey);
    deps.store.rows.subscriptions.push(structuredClone(sub));
    deps.store.rows.customers.push(keyed({ toss_billing_key_enc: enc }));
    return deps;
  }

  /** 다음 크론 실행 한 번만 — 후보를 읽은 직후(결제 전)에 사용자가 해지한다 */
  function cancelAfterCandidates(deps: FakeDeps, results: string[]) {
    const list = deps.store.listCycleCandidates.bind(deps.store);
    let armed = true;
    deps.store.listCycleCandidates = async (...args) => {
      const candidates = await list(...args);
      if (armed) {
        armed = false;
        results.push(await cancelSubscription(deps, USER, LIVEMODE));
      }
      return candidates;
    };
  }

  /** 결제 기한이 된 active 구독 — 기간 끝 12시간 전(갱신 결제는 하루 전부터) */
  const dueActive = () =>
    subscriptionRow({ user_id: USER, current_period_start: iso(NOW - 27 * DAY), current_period_end: iso(NOW + 12 * HOUR) });

  it("후보를 읽은 뒤 해지를 예약하면 크론은 토스를 부르지 않고 결제 행도 남기지 않는다", async () => {
    const deps = cronSetup(dueActive(), [done]);
    const results: string[] = [];
    cancelAfterCandidates(deps, results);

    const summary = await runBillingCycle(deps, LIVEMODE);

    expect(results).toEqual(["scheduled"]);
    expect(summary).toMatchObject({ charge_skipped: 1 });
    expect(deps.toss.calls.chargeBillingKey).toHaveLength(0);
    expect(deps.store.rows.payments).toHaveLength(0);
    expect(deps.store.rows.subscriptions[0]).toMatchObject({ status: "active", cancel_at_period_end: true });
    expect(deps.mailer.sent.map((m) => m.kind)).toEqual(["cancelScheduled"]);
  });

  it("건너뛴 뒤 기간 끝 전에 재개하면 다음 실행이 실제로 결제한다(실패 행이 시도 칸을 막는 좀비 회귀)", async () => {
    const sub = dueActive();
    const deps = cronSetup(sub, [done]);
    const results: string[] = [];
    cancelAfterCandidates(deps, results);
    expect(await runBillingCycle(deps, LIVEMODE)).toMatchObject({ charge_skipped: 1 });
    expect(deps.store.rows.payments).toHaveLength(0);

    expect(await resumeSubscription(deps, USER, LIVEMODE)).toBe("resumed");
    const summary = await runBillingCycle(deps, LIVEMODE);

    expect(summary).toMatchObject({ charge_paid: 1 });
    expect(deps.toss.calls.chargeBillingKey).toHaveLength(1);
    expect(deps.store.rows.payments.map((p) => [p.kind, p.attempt, p.status])).toEqual([["renewal", 1, "paid"]]);
    expect(deps.store.rows.subscriptions[0]).toMatchObject({ status: "active", cancel_at_period_end: false, current_period_start: pgTime(sub.current_period_end) });
  });

  it("크론이 결제 행을 쓴 뒤 해지가 끼어들면 해지가 물러나고(busy, 예약 되돌림) 크론은 결제한다 — 해지 뒤 청구는 없다", async () => {
    const deps = cronSetup(dueActive(), [done]);
    const results: string[] = [];
    const read = deps.store.getSubscription.bind(deps.store);
    let first = true;
    deps.store.getSubscription = async (id) => {
      if (first) {
        // 결제 행이 들어간 직후, 크론이 구독을 다시 읽기 전
        first = false;
        results.push(await cancelSubscription(deps, USER, LIVEMODE));
      }
      return read(id);
    };

    const summary = await runBillingCycle(deps, LIVEMODE);

    expect(results).toEqual(["busy"]);
    expect(summary).toMatchObject({ charge_paid: 1 });
    expect(deps.store.rows.subscriptions[0]).toMatchObject({ cancel_at_period_end: false, canceled_at: null });
    expect(deps.mailer.sent.map((m) => m.kind)).toEqual(["receipt"]);
  });

  it("같은 실행의 미납 재시도와 겹친 즉시 해지 — 해지가 끝냈으면 재시도는 결제하지 않는다", async () => {
    const sub = pastDue({ next_retry_at: iso(NOW - HOUR) });
    const deps = cronSetup(sub, [done]);
    expect(decideRenewalAction(deps.store.rows.subscriptions[0], NOW)).toBe("retry");
    const results: string[] = [];
    cancelAfterCandidates(deps, results);

    const summary = await runBillingCycle(deps, LIVEMODE);

    expect(results).toEqual(["endedNow"]);
    expect(summary).toMatchObject({ retry_skipped: 1 });
    expect(deps.toss.calls.chargeBillingKey).toHaveLength(0);
    expect(deps.store.rows.payments).toHaveLength(0);
    expect(deps.store.rows.subscriptions[0]).toMatchObject({ status: "ended", ended_reason: "user_canceled" });
    expect(deps.mailer.sent.map((m) => [m.kind, m.data.reason])).toEqual([["ended", "canceledNow"]]);
  });

  it("예약만 쓰고 멈춘 미납 구독(past_due + 예약)은 재시도하지 않고 끝낸다(end_canceled)", async () => {
    // 재시도 기한이 지났어도 해지 예약을 먼저 본다
    const crashed = pastDue({ cancel_at_period_end: true, canceled_at: iso(NOW - DAY), next_retry_at: iso(NOW - HOUR) });
    expect(decideRenewalAction(crashed, NOW)).toBe("end_canceled");
    // 마지막 날 결제가 실패해 기간 끝 전에 미납이 된 경우 — 기간 끝까지는 아무것도 하지 않고(재시도 없음) 그 뒤 끝낸다
    const early = pastDue({ cancel_at_period_end: true, current_period_end: iso(NOW + 6 * HOUR), next_retry_at: iso(NOW + 30 * HOUR) });
    expect(decideRenewalAction(early, NOW)).toBe("none");
    expect(decideRenewalAction(early, NOW + 31 * HOUR)).toBe("end_canceled");

    const deps = cronSetup(crashed, [done]);
    const summary = await runBillingCycle(deps, LIVEMODE);

    expect(summary).toMatchObject({ end_canceled: 1 });
    expect(deps.toss.calls.chargeBillingKey).toHaveLength(0);
    expect(deps.store.rows.payments).toHaveLength(0);
    expect(deps.store.rows.subscriptions[0]).toMatchObject({ status: "ended", ended_reason: "user_canceled" });
    expect(deps.store.rows.customers[0].toss_billing_key_enc).toBeNull();
  });

  it("다시 읽은 구독이 다르면 보내지 않은 결제 행을 지운다 — 지우지 못하면 운영자 확인을 남기고(id만) 그래도 결제하지 않는다", async () => {
    const deps = cronSetup(dueActive(), [done]);
    const results: string[] = [];
    cancelAfterCandidates(deps, results);
    deps.store.deletePendingPayment = async () => {
      throw new Error("billing store deletePendingPayment: connection reset");
    };

    expect(await runBillingCycle(deps, LIVEMODE)).toMatchObject({ charge_skipped: 1 });
    expect(deps.toss.calls.chargeBillingKey).toHaveLength(0);
    const logged = deps.log.mock.calls.map(([m]) => m).join("\n");
    expect(logged).toContain(`billing needs review: unsent payment ${deps.store.rows.payments[0].id}`);
    expect(logged).not.toContain(BILLING_KEY);
  });
});
