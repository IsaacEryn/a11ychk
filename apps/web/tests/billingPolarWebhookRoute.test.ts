import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PolarError } from "../src/lib/billing/polar";
import { resetLogThrottle } from "../src/lib/billing/logThrottle";
import { NOW, createMemoryStore, makeMorDeps, polarSubscription, priceRow, type FakeMorDeps } from "./billingFakes";

// Polar 웹훅 라우트의 바깥 의존성 — 결제 의존성·관리자 클라이언트·기록. 결제 모드·키 판정(config)·서명 검증·처리 흐름은 진짜를 쓴다.
const m = vi.hoisted(() => ({ createMorDeps: vi.fn(), logAppError: vi.fn() }));
vi.mock("@/lib/billing/server", () => ({ createMorDeps: m.createMorDeps }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ marker: "admin" }) }));
vi.mock("@/lib/logs", () => ({ logAppError: m.logAppError }));

import { DELETE, GET, OPTIONS, PATCH, POST, PUT, maxDuration } from "../src/app/api/billing/webhooks/polar/route";

// 가짜 값만 쓴다 — 실제 시크릿·토큰·사용자가 아니다
const KEY = Buffer.from("fake-webhook-key-material-0001");
const SECRET = `whsec_${KEY.toString("base64")}`;
const EVENT_ID = "msg_fake_event_0001";
const USER = "11111111-1111-4111-8111-111111111111";
const PRODUCT = "44444444-4444-4444-8444-444444444444";
const CUSTOMER = "55555555-5555-4555-8555-555555555555";
const SUB_ID = "66666666-6666-4666-8666-666666666666";
const EMAIL = "fake-person@example.test";

const PRICE = priceRow({ id: "99999999-9999-4999-8999-999999999999", provider: "mor", currency: "USD", external_price_id: PRODUCT, livemode: false });
const LIVE_PRICE = { ...PRICE, id: "98989898-9898-4898-8898-989898989898", livemode: true };

const nowSec = () => Math.floor(Date.now() / 1000);

/** Standard Webhooks 방식으로 서명한 요청 — 서명 대상은 `${id}.${timestamp}.${본문 원문}` */
function signed(body: string, opts: { id?: string; ts?: number; key?: Buffer; drop?: string[] } = {}): Request {
  const id = opts.id ?? EVENT_ID;
  const ts = String(opts.ts ?? nowSec());
  const sig = createHmac("sha256", opts.key ?? KEY).update(`${id}.${ts}.${body}`).digest("base64");
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "webhook-id": id,
    "webhook-timestamp": ts,
    "webhook-signature": `v1,${sig}`,
  };
  for (const h of opts.drop ?? []) delete headers[h];
  return new Request("https://www.a11ychk.test/api/billing/webhooks/polar", { method: "POST", body, headers });
}

const body = (type: string, data: Record<string, unknown> = {}) => JSON.stringify({ type, timestamp: "2026-01-30T16:00:00Z", data });

function sub(over: Parameters<typeof polarSubscription>[0] = {}) {
  return polarSubscription({
    id: SUB_ID,
    product_id: PRODUCT,
    customer: { id: CUSTOMER, external_id: USER },
    metadata: { user_id: USER },
    ...over,
  });
}

let deps: FakeMorDeps;
const loggedApp = () => m.logAppError.mock.calls.map((c) => c[1] as string);
const logged = () => deps.log.mock.calls.map((c) => c[0]);

beforeEach(() => {
  vi.stubEnv("BILLING_MODE", "test");
  vi.stubEnv("TOSS_SECRET_KEY", "");
  vi.stubEnv("POLAR_ACCESS_TOKEN", "polar_oat_fake_token");
  vi.stubEnv("POLAR_WEBHOOK_SECRET", SECRET);
  resetLogThrottle();
  m.createMorDeps.mockReset();
  m.logAppError.mockReset();
  m.logAppError.mockResolvedValue(undefined);
  deps = makeMorDeps({ store: createMemoryStore({ prices: [PRICE, LIVE_PRICE], profiles: [USER] }, { now: () => NOW }) });
  m.createMorDeps.mockImplementation(() => deps);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("Polar 웹훅 라우트 — 게이트", () => {
  it("함수 시간 제한은 30초", () => {
    expect(maxDuration).toBe(30);
  });

  it("결제 꺼짐이면 POST·GET 모두 404 — 의존성을 만들지 않고 본문도 보지 않는다", async () => {
    vi.stubEnv("BILLING_MODE", "");
    expect((await POST(signed(body("customer.updated")))).status).toBe(404);
    for (const handler of [GET, PUT, PATCH, DELETE, OPTIONS]) expect((await handler()).status).toBe(404);
    expect(m.createMorDeps).not.toHaveBeenCalled();
    expect(m.logAppError).not.toHaveBeenCalled();
  });

  it("토스 키 접두가 모드와 어긋나 결제가 꺼진 배포도 404", async () => {
    vi.stubEnv("TOSS_SECRET_KEY", "live_sk_fake");
    expect((await POST(signed(body("customer.updated")))).status).toBe(404);
  });

  it("POST가 아닌 메서드는 405(Allow: POST)", async () => {
    for (const handler of [GET, PUT, PATCH, DELETE, OPTIONS]) {
      const res = await handler();
      expect(res.status).toBe(405);
      expect(res.headers.get("allow")).toBe("POST");
    }
    expect(m.createMorDeps).not.toHaveBeenCalled();
  });

  it("Polar 키가 없으면 503 + 기록 한 줄(같은 기록은 1분에 한 번) — 재시도되게", async () => {
    vi.stubEnv("POLAR_WEBHOOK_SECRET", "");
    expect((await POST(signed(body("customer.updated")))).status).toBe(503);
    expect((await POST(signed(body("customer.updated")))).status).toBe(503);
    expect(m.logAppError).toHaveBeenCalledTimes(1);
    expect(m.logAppError).toHaveBeenCalledWith({ marker: "admin" }, "billing polar webhook is not configured (Polar keys or service client missing)", { path: "billing" });
  });

  it("의존성을 만들 수 없으면(null·예외) 503", async () => {
    m.createMorDeps.mockReturnValueOnce(null);
    expect((await POST(signed(body("customer.updated")))).status).toBe(503);
    m.createMorDeps.mockImplementationOnce(() => {
      throw new Error("missing service role key");
    });
    expect((await POST(signed(body("customer.updated")))).status).toBe(503);
  });
});

describe("Polar 웹훅 라우트 — 서명", () => {
  /** 서명이 맞지 않는 요청은 DB를 건드리지 않고, 기록에는 결과 코드만 — 본문·헤더 값 없음 */
  function expectRejectedQuietly(code: string) {
    expect(deps.store.rows.webhookEvents).toEqual([]);
    expect(deps.log).not.toHaveBeenCalled();
    expect(loggedApp()).toEqual([`billing polar webhook rejected: ${code}`]);
  }

  it("서명이 틀리면 401", async () => {
    const res = await POST(signed(body("subscription.updated", { id: SUB_ID, customer: { email: EMAIL } }), { key: Buffer.from("other-key") }));
    expect(res.status).toBe(401);
    expectRejectedQuietly("bad_signature");
    expect(JSON.stringify(m.logAppError.mock.calls)).not.toContain(EMAIL);
    expect(JSON.stringify(m.logAppError.mock.calls)).not.toContain(EVENT_ID);
  });

  it("본문이 바뀌면 401 — 서명은 받은 원문에 대한 것", async () => {
    const req = signed(body("customer.updated"));
    const tampered = new Request(req.url, { method: "POST", headers: req.headers, body: body("subscription.revoked", { id: SUB_ID }) });
    expect((await POST(tampered)).status).toBe(401);
    expectRejectedQuietly("bad_signature");
  });

  it("5분보다 오래됐으면 401(stale)", async () => {
    expect((await POST(signed(body("customer.updated"), { ts: nowSec() - 301 }))).status).toBe(401);
    expectRejectedQuietly("stale");
  });

  it("5분보다 앞선 시각도 401(stale)", async () => {
    expect((await POST(signed(body("customer.updated"), { ts: nowSec() + 301 }))).status).toBe(401);
    expectRejectedQuietly("stale");
  });

  it("5분 안이면 받는다", async () => {
    expect((await POST(signed(body("customer.updated"), { ts: nowSec() - 290 }))).status).toBe(200);
  });

  it.each(["webhook-signature", "webhook-id", "webhook-timestamp"])("%s 헤더가 없으면 401(missing)", async (header) => {
    expect((await POST(signed(body("customer.updated"), { drop: [header] }))).status).toBe(401);
    expectRejectedQuietly("missing");
  });

  it("거절 기록은 결과 코드마다 1분에 한 번", async () => {
    for (let i = 0; i < 3; i++) await POST(signed(body("customer.updated"), { key: Buffer.from("other-key") }));
    await POST(signed(body("customer.updated"), { ts: nowSec() - 999 }));
    expect(loggedApp()).toEqual(["billing polar webhook rejected: bad_signature", "billing polar webhook rejected: stale"]);
  });

  it("예전에 만든 Polar 시크릿(whsec_ 문자열 전체가 키)으로 서명해도 받는다", async () => {
    expect((await POST(signed(body("customer.updated"), { key: Buffer.from(SECRET, "utf8") }))).status).toBe(200);
  });

  it("서명은 받은 원문 그대로 확인한다 — 공백·키 순서가 달라도", async () => {
    const raw = `{ "data" : { "id" : "${CUSTOMER}" },\n  "type" : "customer.updated" }`;
    expect((await POST(signed(raw))).status).toBe(200);
  });
});

describe("Polar 웹훅 라우트 — 처리", () => {
  it("서명은 맞는데 JSON이 아니면 400 + 기록 한 줄(이벤트 id만), 이벤트는 적지 않는다", async () => {
    const res = await POST(signed("not json at all"));
    expect(res.status).toBe(400);
    expect(logged()).toEqual([`billing polar webhook ${EVENT_ID} has a malformed body`]);
    expect(deps.store.rows.webhookEvents).toEqual([]);
  });

  it("type이 없으면 400", async () => {
    expect((await POST(signed(JSON.stringify({ data: { id: SUB_ID } })))).status).toBe(400);
  });

  it("처리했으면 200 { ok: true } — 이벤트 행에는 {type, data_id}만, 본문(이메일)은 어디에도 남지 않는다", async () => {
    const res = await POST(signed(body("customer.updated", { id: CUSTOMER, email: EMAIL, billing_address: { line1: "fake street" } })));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    const [row] = deps.store.rows.webhookEvents;
    expect(row).toMatchObject({ provider: "polar", event_id: EVENT_ID, event_type: "customer.updated", payload: { type: "customer.updated", data_id: CUSTOMER } });
    expect(row!.processed_at).not.toBeNull();
    expect(JSON.stringify(deps.store.rows)).not.toContain(EMAIL);
    expect(JSON.stringify(deps.store.rows)).not.toContain("fake street");
  });

  it("본문의 상태는 믿지 않는다 — data.id로 구독을 다시 읽어 정본(active)으로 적는다, test 모드는 livemode false", async () => {
    deps.polar.script.getSubscription.push(sub({ status: "active" }));
    const res = await POST(signed(body("subscription.updated", { id: SUB_ID, status: "canceled", cancel_at_period_end: true })));
    expect(res.status).toBe(200);
    expect(deps.polar.calls.getSubscription).toEqual([[SUB_ID]]);
    expect(deps.store.rows.subscriptions).toHaveLength(1);
    expect(deps.store.rows.subscriptions[0]).toMatchObject({ status: "active", cancel_at_period_end: false, livemode: false });
  });

  it("live 모드면 livemode true — 본문의 livemode 값은 보지 않는다", async () => {
    vi.stubEnv("BILLING_MODE", "live");
    deps.polar.script.getSubscription.push(sub());
    await POST(signed(body("subscription.created", { id: SUB_ID, livemode: false, metadata: { livemode: "false" } })));
    expect(deps.store.rows.subscriptions[0]).toMatchObject({ livemode: true, price_id: LIVE_PRICE.id });
  });

  it("같은 webhook-id 재전송은 200, 다시 처리하지 않는다", async () => {
    deps.polar.script.getSubscription.push(sub());
    expect((await POST(signed(body("subscription.created", { id: SUB_ID })))).status).toBe(200);
    expect((await POST(signed(body("subscription.created", { id: SUB_ID })))).status).toBe(200);
    expect(deps.polar.calls.getSubscription).toHaveLength(1);
    expect(deps.store.rows.webhookEvents[0]!.attempts).toBe(1);
  });

  it("Polar 읽기가 결과 불명이면 last_error를 먼저 적고 500 — 응답 본문에는 오류 내용이 없다, 재전송이 처리를 마친다", async () => {
    deps.polar.script.getSubscription.push(new PolarError("NETWORK", "polar getSubscription failed (network)", 0));
    const res = await POST(signed(body("subscription.updated", { id: SUB_ID })));
    expect(res.status).toBe(500);
    expect(await res.text()).not.toContain("network");
    expect(deps.store.rows.webhookEvents[0]).toMatchObject({ processed_at: null, last_error: "polar getSubscription failed (network)" });

    deps.polar.script.getSubscription.push(sub());
    expect((await POST(signed(body("subscription.updated", { id: SUB_ID })))).status).toBe(200);
    expect(deps.store.rows.webhookEvents[0]).toMatchObject({ attempts: 2 });
    expect(deps.store.rows.webhookEvents[0]!.processed_at).not.toBeNull();
  });

  it("이벤트를 적지 못하면(저장소 오류) 500", async () => {
    deps.store.recordWebhookEvent = async () => {
      throw new Error("billing store recordWebhookEvent: timeout");
    };
    expect((await POST(signed(body("customer.updated")))).status).toBe(500);
  });
});
