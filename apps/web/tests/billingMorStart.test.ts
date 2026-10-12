import { describe, expect, it } from "vitest";
import { MOR_DISCLOSURE_VERSION } from "../src/lib/billing/checkout";
import { startMorCheckout, type MorStartInput } from "../src/lib/billing/flows/morStart";
import { PolarError } from "../src/lib/billing/polar";
import type { MemoryRows } from "./billingFakes";
import {
  MIN,
  NOW,
  checkoutRow,
  createFakePolar,
  createMemoryStore,
  iso,
  makeMorDeps,
  paymentRow,
  pgTime,
  polarCheckout,
  priceRow,
  subscriptionRow,
} from "./billingFakes";

const USER = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const PRODUCT = "44444444-4444-4444-8444-444444444444";
const POLAR_CHECKOUT = "55555555-5555-4555-8555-555555555555";
const EMAIL = "user@example.test";
const ORIGIN = "http://localhost:3100";
const CHECKOUT_URL = "https://sandbox.polar.sh/checkout/polar_c_fake";

function setup(rows: Partial<MemoryRows> = {}, opts: { checkout?: Parameters<typeof polarCheckout>[0] } = {}) {
  const price = priceRow({ provider: "mor", currency: "USD", amount: 1234, external_price_id: PRODUCT });
  const store = createMemoryStore({ prices: [price], profiles: [USER, OTHER], ...rows }, { now: () => NOW });
  const polar = createFakePolar({
    // 금액·통화·주기는 가짜 결제창 기본값(가격 행과 같음) — 대조가 기본으로 돈다
    createCheckout: [polarCheckout({ id: POLAR_CHECKOUT, url: CHECKOUT_URL, ...opts.checkout })],
  });
  const deps = makeMorDeps({ store, polar });
  return { deps, store, polar, price };
}

const input = (priceId: string, over: Partial<MorStartInput> = {}): MorStartInput => ({
  userId: USER,
  email: EMAIL,
  livemode: false,
  priceId,
  locale: "en",
  origin: ORIGIN,
  ...over,
});

describe("startMorCheckout — 해외(Polar) 결제창 시작", () => {
  it("정상: MoR 시도(open, 30분)·동의 스냅샷을 만들고 Polar 결제창을 연다 — 결제창 주소와 시도 id를 돌려준다", async () => {
    const { deps, store, polar, price } = setup();

    const out = await startMorCheckout(deps, input(price.id));

    expect(store.rows.checkouts).toHaveLength(1);
    const attempt = store.rows.checkouts[0];
    expect(out).toEqual({ ok: true, url: CHECKOUT_URL, checkoutId: attempt.id });
    expect(attempt).toMatchObject({
      user_id: USER,
      provider: "mor",
      livemode: false,
      price_id: price.id,
      purpose: "subscribe",
      status: "open",
      subscription_id: null,
      failure_code: null,
      expires_at: pgTime(NOW + 30 * MIN),
    });
    // 토스 고객 행은 만들지 않는다(고객은 Polar가 external_customer_id로 만든다)
    expect(store.rows.customers).toHaveLength(0);
    expect(store.rows.consents).toEqual([
      {
        id: expect.any(String),
        user_id: USER,
        checkout_id: attempt.id,
        subscription_id: null,
        kind: "recurring_payment",
        disclosure_version: MOR_DISCLOSURE_VERSION,
        snapshot: {
          plan_code: "pro",
          amount: 1234,
          currency: "USD",
          interval: "month",
          tax: "added_at_checkout",
          first_charge_at: iso(NOW),
          auto_renew: true,
          cancel_method: "polar_customer_portal",
          merchant_of_record: "polar",
          locale: "en",
        },
      },
    ]);
    // {CHECKOUT_ID}는 인코딩하지 않고 그대로 보낸다 — Polar가 채운다
    expect(polar.calls.createCheckout).toEqual([
      [
        {
          products: [PRODUCT],
          external_customer_id: USER,
          customer_email: EMAIL,
          success_url: `${ORIGIN}/api/billing/polar/return?checkout_id={CHECKOUT_ID}`,
          return_url: `${ORIGIN}/en/billing/checkout?price=${price.id}`,
          metadata: { checkout_id: attempt.id, user_id: USER, livemode: false, locale: "en" },
          locale: "en",
        },
      ],
    ]);
    expect(deps.log).not.toHaveBeenCalled();
  });

  it("이메일이 없으면 customer_email을 보내지 않는다, live 모드면 metadata livemode true", async () => {
    const price = priceRow({ provider: "mor", currency: "USD", livemode: true, external_price_id: PRODUCT });
    const { deps, polar } = setup({ prices: [price] });

    const out = await startMorCheckout(deps, input(price.id, { email: null, livemode: true, locale: "ko" }));

    expect(out.ok).toBe(true);
    const sent = polar.calls.createCheckout[0][0];
    expect(sent).not.toHaveProperty("customer_email");
    expect(sent.metadata).toMatchObject({ livemode: true, locale: "ko" });
    expect(sent.return_url).toBe(`${ORIGIN}/ko/billing/checkout?price=${price.id}`);
    expect(sent.locale).toBe("ko");
  });

  describe("가격 — mor·USD·활성·같은 모드·Polar 상품 id", () => {
    it.each([
      ["없는 가격", () => priceRow({ id: "99999999-9999-4999-8999-999999999999", provider: "mor", currency: "USD", external_price_id: PRODUCT }), true],
      ["토스 가격", () => priceRow({ provider: "toss", currency: "KRW" }), false],
      ["원화 mor 가격", () => priceRow({ provider: "mor", currency: "KRW", external_price_id: PRODUCT }), false],
      ["비활성", () => priceRow({ provider: "mor", currency: "USD", active: false, external_price_id: PRODUCT }), false],
      ["다른 모드(실결제 가격)", () => priceRow({ provider: "mor", currency: "USD", livemode: true, external_price_id: PRODUCT }), false],
    ])("%s → priceInactive, 시도·Polar 호출 없음", async (_why, make, missing) => {
      const price = make();
      const { deps, store, polar } = setup({ prices: missing ? [] : [price] });
      expect(await startMorCheckout(deps, input(price.id))).toEqual({ ok: false, error: "priceInactive" });
      expect(store.rows.checkouts).toHaveLength(0);
      expect(store.rows.consents).toHaveLength(0);
      expect(polar.calls.createCheckout).toHaveLength(0);
    });

    it("Polar 상품 id가 없거나 UUID가 아니면 priceInactive + 기록(가격 id만)", async () => {
      for (const external_price_id of [null, "prod_fake"]) {
        const price = priceRow({ provider: "mor", currency: "USD", external_price_id });
        const { deps, store, polar } = setup({ prices: [price] });
        expect(await startMorCheckout(deps, input(price.id))).toEqual({ ok: false, error: "priceInactive" });
        expect(store.rows.checkouts).toHaveLength(0);
        expect(polar.calls.createCheckout).toHaveLength(0);
        expect(deps.log).toHaveBeenCalledExactlyOnceWith(`billing mor price ${price.id} has no usable Polar product id`);
      }
    });

    it("가격 id가 UUID가 아니면 invalid — 저장소를 보지 않는다", async () => {
      const { deps, store } = setup();
      store.getPrice = async () => {
        throw new Error("must not read");
      };
      expect(await startMorCheckout(deps, input("nope"))).toEqual({ ok: false, error: "invalid" });
    });
  });

  describe("진행 중 구독·결제", () => {
    it("같은 모드에 진행 중 구독이 있으면 결제사와 무관하게 hasActive(토스 구독·미납 포함)", async () => {
      for (const sub of [subscriptionRow({ user_id: USER }), subscriptionRow({ user_id: USER, provider: "mor", currency: "USD", status: "past_due" })]) {
        const { deps, store, polar, price } = setup({ subscriptions: [sub] });
        expect(await startMorCheckout(deps, input(price.id))).toEqual({ ok: false, error: "hasActive" });
        expect(store.rows.checkouts).toHaveLength(0);
        expect(polar.calls.createCheckout).toHaveLength(0);
      }
    });

    it("다른 모드의 구독·끝난 구독·남의 구독은 막지 않는다", async () => {
      const { deps, price } = setup({
        subscriptions: [
          subscriptionRow({ user_id: USER, livemode: true }),
          subscriptionRow({ user_id: USER, status: "ended", ended_reason: "user_canceled" }),
          subscriptionRow({ user_id: OTHER }),
        ],
      });
      expect((await startMorCheckout(deps, input(price.id))).ok).toBe(true);
    });

    it("결과를 모르는 첫 결제가 있으면(토스 결제여도) inProgress·processing — 시도를 만들지 않는다", async () => {
      const { deps, store, polar, price } = setup({ payments: [paymentRow({ user_id: USER, provider: "toss", status: "pending" })] });
      expect(await startMorCheckout(deps, input(price.id))).toEqual({ ok: false, error: "inProgress", blockedBy: "processing" });
      expect(store.rows.checkouts).toHaveLength(0);
      expect(polar.calls.createCheckout).toHaveLength(0);
    });
  });

  describe("끝나지 않은 시도", () => {
    it("만료 전 토스 open 시도는 닫고(superseded) 새로 연다, 만료된 open은 실패 코드 없이 만료로", async () => {
      const { deps, store, price } = setup();
      const tossOpen = checkoutRow({ user_id: USER, price_id: price.id, provider: "toss" });
      const stale = checkoutRow({ user_id: USER, price_id: price.id, provider: "mor", expires_at: iso(NOW - MIN) });
      const othersOpen = checkoutRow({ user_id: OTHER, price_id: price.id, provider: "mor" });
      store.rows.checkouts.push(tossOpen, stale, othersOpen);

      const out = await startMorCheckout(deps, input(price.id));

      expect(out.ok).toBe(true);
      const byId = (id: string) => store.rows.checkouts.find((c) => c.id === id);
      expect(byId(tossOpen.id)).toMatchObject({ status: "expired", failure_code: "superseded" });
      expect(byId(stale.id)).toMatchObject({ status: "expired", failure_code: null });
      expect(byId(othersOpen.id)).toMatchObject({ status: "open" });
      expect(store.rows.checkouts.filter((c) => c.user_id === USER && c.status === "open")).toHaveLength(1);
    });

    it("만료 전 MoR open 시도가 있으면 새로 만들지 않고 inProgress·open — 그 Polar 결제창이 아직 살아 있다(사용자가 이전 시도를 닫을 수 있다)", async () => {
      const { deps, store, polar, price } = setup();
      const morOpen = checkoutRow({ user_id: USER, price_id: price.id, provider: "mor", expires_at: iso(NOW + 50 * MIN) });
      const tossOpen = checkoutRow({ user_id: USER, price_id: price.id, provider: "toss" });
      store.rows.checkouts.push(morOpen, tossOpen);

      expect(await startMorCheckout(deps, input(price.id))).toEqual({ ok: false, error: "inProgress", blockedBy: "open" });

      expect(store.rows.checkouts.map((c) => [c.provider, c.status])).toEqual([
        ["mor", "open"],
        ["toss", "open"],
      ]);
      expect(store.rows.consents).toHaveLength(0);
      expect(polar.calls.createCheckout).toHaveLength(0);
    });

    it("처리 중(processing) 시도가 있으면 inProgress·processing — 닫지도 새로 만들지도 않는다", async () => {
      const { deps, store, polar, price } = setup();
      const busy = checkoutRow({ user_id: USER, price_id: price.id, provider: "mor", status: "processing" });
      const open = checkoutRow({ user_id: USER, price_id: price.id, provider: "mor" });
      store.rows.checkouts.push(busy, open);

      expect(await startMorCheckout(deps, input(price.id))).toEqual({ ok: false, error: "inProgress", blockedBy: "processing" });
      expect(store.rows.checkouts).toHaveLength(2);
      expect(store.rows.checkouts.map((c) => c.status)).toEqual(["processing", "open"]);
      expect(polar.calls.createCheckout).toHaveLength(0);
    });

    it("멈춘 processing(만료 + 30분 지남)은 stale로 정리하고 연다", async () => {
      const { deps, store, price } = setup();
      const stuck = checkoutRow({ user_id: USER, price_id: price.id, status: "processing", expires_at: iso(NOW - 31 * MIN) });
      store.rows.checkouts.push(stuck);
      expect((await startMorCheckout(deps, input(price.id))).ok).toBe(true);
      expect(store.rows.checkouts[0]).toMatchObject({ status: "expired", failure_code: "stale" });
    });

    it("만든 뒤 다른 시도가 보이면(동시 요청) 방금 만든 시도를 물리고 inProgress — 동의·Polar 호출 없음", async () => {
      const { deps, store, polar, price } = setup();
      const insert = store.insertCheckout.bind(store);
      let other = "";
      store.insertCheckout = async (row) => {
        const created = await insert(row);
        // 같은 순간 다른 탭의 시작이 시도를 넣었다
        const raced = await insert(row);
        other = raced.id;
        return created;
      };

      expect(await startMorCheckout(deps, input(price.id))).toEqual({ ok: false, error: "inProgress", blockedBy: "open" });
      const mine = store.rows.checkouts.find((c) => c.id !== other);
      expect(mine).toMatchObject({ status: "expired", failure_code: "superseded" });
      expect(store.rows.consents).toHaveLength(0);
      expect(polar.calls.createCheckout).toHaveLength(0);
    });

    it("동의 기록이 실패하면 시도를 닫고(startFailed) 던진다 — Polar를 부르지 않는다", async () => {
      const { deps, store, polar, price } = setup();
      store.insertConsent = async () => {
        throw new Error("billing store insertConsent: timeout");
      };
      await expect(startMorCheckout(deps, input(price.id))).rejects.toThrow("insertConsent");
      expect(store.rows.checkouts[0]).toMatchObject({ status: "expired", failure_code: "startFailed" });
      expect(polar.calls.createCheckout).toHaveLength(0);
    });
  });

  describe("Polar 결제창 생성", () => {
    it("확정 실패(4xx)면 시도를 failed(polarCheckoutFailed)로 닫고 failed — 기록은 id·코드만", async () => {
      const { deps, store, polar, price } = setup();
      polar.script.createCheckout = [new PolarError("validation_error", "polar createCheckout failed: validation_error (422)", 422, true)];

      expect(await startMorCheckout(deps, input(price.id))).toEqual({ ok: false, error: "failed" });

      const attempt = store.rows.checkouts[0];
      expect(attempt).toMatchObject({ status: "failed", failure_code: "polarCheckoutFailed" });
      expect(deps.log).toHaveBeenCalledTimes(1);
      const line = deps.log.mock.calls[0][0];
      expect(line).toBe(`billing mor checkout ${attempt.id} for user ${USER}: Polar createCheckout failed: validation_error (422)`);
      expect(line).not.toContain(EMAIL);
    });

    it.each([
      ["연결 실패", new PolarError("NETWORK", "polar createCheckout failed (network)", 0, true)],
      ["Polar 5xx", new PolarError("HTTP_502", "polar createCheckout failed: HTTP_502 (502)", 502, true)],
      ["2xx인데 응답 모양이 틀림", new PolarError("BAD_RESPONSE", "polar createCheckout response invalid: url", 201, true)],
    ])("결과 불명(%s)이면 시도를 닫고(startFailed) failed — 주소가 사용자에게 가지 않아 그 결제창으로는 결제할 수 없다, 다시 시작하면 바로 연다", async (_why, err) => {
      const { deps, store, polar, price } = setup();
      polar.script.createCheckout = [err];

      expect(await startMorCheckout(deps, input(price.id))).toEqual({ ok: false, error: "failed" });

      const attempt = store.rows.checkouts[0];
      expect(attempt).toMatchObject({ status: "expired", failure_code: "startFailed" });
      expect(deps.log).toHaveBeenCalledExactlyOnceWith(
        `billing mor checkout ${attempt.id} for user ${USER}: Polar createCheckout outcome unknown: ${err.code} (${err.status}); attempt closed`,
      );

      polar.script.createCheckout = [polarCheckout({ url: CHECKOUT_URL })];
      expect((await startMorCheckout(deps, input(price.id))).ok).toBe(true);
      expect(store.rows.checkouts.filter((c) => c.status === "open")).toHaveLength(1);
    });

    it("Polar가 polar.sh 밖의 주소를 주면 열지 않는다 — 시도를 failed로 닫고 failed", async () => {
      const { deps, store, price } = setup({}, { checkout: { url: "https://evil.example/checkout" } });
      expect(await startMorCheckout(deps, input(price.id))).toEqual({ ok: false, error: "failed" });
      expect(store.rows.checkouts[0]).toMatchObject({ status: "failed", failure_code: "polarCheckoutFailed" });
      expect(deps.log).toHaveBeenCalledWith(expect.stringContaining("outside polar.sh"));
      expect(JSON.stringify(deps.log.mock.calls)).not.toContain("evil.example");
    });

    it("결제창 금액·통화·주기가 가격 행과 다르면 열지 않는다 — priceMismatch로 닫고 needs review(id만), priceInactive", async () => {
      for (const checkout of [{ amount: 999 }, { currency: "eur" }, { recurring_interval: "year" }, { recurring_interval: "week" }, { recurring_interval_count: 3 }]) {
        const { deps, store, price } = setup({}, { checkout });
        expect(await startMorCheckout(deps, input(price.id))).toEqual({ ok: false, error: "priceInactive" });
        expect(store.rows.checkouts[0]).toMatchObject({ status: "failed", failure_code: "priceMismatch" });
        expect(deps.log).toHaveBeenCalledExactlyOnceWith(
          `billing needs review: mor price ${price.id} does not match Polar checkout ${POLAR_CHECKOUT} (amount, currency or interval); checkout not opened`,
        );
      }
    });

    it("연간 가격은 연간 결제창과 맞는다", async () => {
      const price = priceRow({ provider: "mor", currency: "USD", amount: 1234, interval: "year", external_price_id: PRODUCT });
      const { deps } = setup({ prices: [price] }, { checkout: { recurring_interval: "year" } });
      expect(await startMorCheckout(deps, input(price.id))).toMatchObject({ ok: true, url: CHECKOUT_URL });
    });

    it("Polar가 금액·통화·주기를 주지 않으면 비교하지 않고 연다", async () => {
      const { deps, price } = setup({}, { checkout: { amount: null, currency: null, recurring_interval: null, recurring_interval_count: null } });
      expect(await startMorCheckout(deps, input(price.id))).toMatchObject({ ok: true, url: CHECKOUT_URL });
    });

    it("시도의 만료 시각을 Polar 결제창의 expires_at에 맞춘다 — 더 늦을 때만, 읽을 수 없으면 그대로", async () => {
      const later = setup({}, { checkout: { expires_at: "2026-01-30T17:00:00.000000Z" } });
      expect((await startMorCheckout(later.deps, input(later.price.id))).ok).toBe(true);
      expect(later.store.rows.checkouts[0].expires_at).toBe(pgTime("2026-01-30T17:00:00.000000Z"));

      const earlier = setup({}, { checkout: { expires_at: "2026-01-30T16:10:00.000000Z" } });
      expect((await startMorCheckout(earlier.deps, input(earlier.price.id))).ok).toBe(true);
      expect(earlier.store.rows.checkouts[0].expires_at).toBe(pgTime(NOW + 30 * MIN));

      const odd = setup({}, { checkout: { expires_at: "2026-01-30 17:00 (UTC)" } });
      expect((await startMorCheckout(odd.deps, input(odd.price.id))).ok).toBe(true);
      expect(odd.store.rows.checkouts[0].expires_at).toBe(pgTime(NOW + 30 * MIN));
    });

    it("만료 시각을 늦추다 저장소 오류가 나도 결제창은 연다(기록 한 줄) — 시도는 30분 만료 그대로", async () => {
      const { deps, store, price } = setup({}, { checkout: { expires_at: "2026-01-30T17:00:00.000000Z" } });
      store.extendCheckout = async () => {
        throw new Error("billing store extendCheckout: timeout");
      };
      const out = await startMorCheckout(deps, input(price.id));
      expect(out).toMatchObject({ ok: true, url: CHECKOUT_URL });
      expect(deps.log).toHaveBeenCalledExactlyOnceWith(
        `billing mor checkout ${store.rows.checkouts[0].id}: expiry could not be matched to the Polar checkout (billing store extendCheckout: timeout)`,
      );
    });
  });
});
