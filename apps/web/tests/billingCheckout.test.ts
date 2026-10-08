import { describe, expect, it } from "vitest";
import {
  CHECKOUT_TTL_MS,
  DISCLOSURE_VERSION,
  PROCESSING_STALE_MS,
  callbackRedirectPath,
  checkoutLocale,
  checkoutReturnUrls,
  checkoutTerms,
  consentSnapshot,
  failRedirectPath,
  isCardChangeTarget,
  parseCardChange,
  parseStartCheckout,
  planCheckoutGuard,
  requestOrigin,
  tossReturnParams,
} from "../src/lib/billing/checkout";
import { CHARGE_LEAD_MS, earliestChargeAt } from "../src/lib/billing/period";
import { decideRenewalAction } from "../src/lib/billing/flows/renew";
import { DAY, MIN, NOW, iso, priceRow, subscriptionRow } from "./billingFakes";

const PRICE_ID = "11111111-2222-4333-8444-555555555555";
const SUB_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const USER = "11111111-1111-4111-8111-111111111111";

function fd(entries: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  return f;
}

const hdrs = (h: Record<string, string>) => ({ get: (name: string) => h[name.toLowerCase()] ?? null });

describe("결제 시작 입력", () => {
  it("가격 id(UUID)와 동의 체크(on)가 있어야 한다 — 동의가 없으면 consent", () => {
    expect(parseStartCheckout(fd({ priceId: PRICE_ID, consent: "on" }))).toEqual({ ok: true, value: { priceId: PRICE_ID } });
    expect(parseStartCheckout(fd({ priceId: PRICE_ID, consent: "on", purpose: "subscribe" }))).toMatchObject({ ok: true });
    expect(parseStartCheckout(fd({ priceId: PRICE_ID }))).toEqual({ ok: false, error: "consent" });
    // 체크박스가 보낸 "on" 말고는 동의가 아니다
    expect(parseStartCheckout(fd({ priceId: PRICE_ID, consent: "true" }))).toEqual({ ok: false, error: "consent" });
  });

  it("가격 id가 UUID가 아니거나 purpose가 subscribe가 아니면 invalid(동의 여부보다 먼저)", () => {
    expect(parseStartCheckout(fd({ priceId: "1234", consent: "on" }))).toEqual({ ok: false, error: "invalid" });
    expect(parseStartCheckout(fd({ consent: "on" }))).toEqual({ ok: false, error: "invalid" });
    expect(parseStartCheckout(fd({ priceId: PRICE_ID, consent: "on", purpose: "card_change" }))).toEqual({ ok: false, error: "invalid" });
    expect(parseStartCheckout(fd({ priceId: "x" }))).toEqual({ ok: false, error: "invalid" });
  });

  it("카드 변경은 구독 id(UUID)만 받는다", () => {
    expect(parseCardChange(fd({ subscriptionId: SUB_ID }))).toEqual({ ok: true, value: { subscriptionId: SUB_ID } });
    expect(parseCardChange(fd({ subscriptionId: "nope" }))).toEqual({ ok: false, error: "invalid" });
    expect(parseCardChange(fd({}))).toEqual({ ok: false, error: "invalid" });
  });

  it("로케일은 ko·en만 — 그 밖은 ko", () => {
    expect(checkoutLocale("en")).toBe("en");
    expect(checkoutLocale("ko")).toBe("ko");
    expect(checkoutLocale("ja")).toBe("ko");
    expect(checkoutLocale(null)).toBe("ko");
  });
});

describe("돌아올 주소(요청 origin)", () => {
  it("배포 환경: host와 x-forwarded-host가 같고 https면 그 origin", () => {
    expect(requestOrigin(hdrs({ host: "www.a11ychk.com", "x-forwarded-host": "www.a11ychk.com", "x-forwarded-proto": "https" }))).toBe(
      "https://www.a11ychk.com",
    );
    // 프로토콜 헤더가 없으면 https
    expect(requestOrigin(hdrs({ host: "preview-abc.vercel.app" }))).toBe("https://preview-abc.vercel.app");
    // 목록이면 첫 값(클라이언트 쪽)
    expect(requestOrigin(hdrs({ host: "www.a11ychk.com", "x-forwarded-host": "www.a11ychk.com, internal", "x-forwarded-proto": "https,http" }))).toBe(
      "https://www.a11ychk.com",
    );
  });

  it("로컬 개발: localhost·127.0.0.1·[::1]·*.localhost는 http 허용, 프로토콜 헤더가 없으면 http", () => {
    expect(requestOrigin(hdrs({ host: "localhost:3100" }))).toBe("http://localhost:3100");
    expect(requestOrigin(hdrs({ host: "127.0.0.1:3210", "x-forwarded-proto": "http" }))).toBe("http://127.0.0.1:3210");
    expect(requestOrigin(hdrs({ host: "[::1]:3100" }))).toBe("http://[::1]:3100");
    expect(requestOrigin(hdrs({ host: "app.localhost:3100" }))).toBe("http://app.localhost:3100");
    expect(requestOrigin(hdrs({ host: "localhost:3100", "x-forwarded-proto": "https" }))).toBe("https://localhost:3100");
  });

  it("x-forwarded-host가 host와 다르면 거부(위조된 전달 헤더로 결제 결과를 다른 곳에 보내지 않게)", () => {
    expect(requestOrigin(hdrs({ host: "www.a11ychk.com", "x-forwarded-host": "evil.example" }))).toBeNull();
  });

  it("로컬이 아닌 호스트의 http, 이상한 프로토콜, 호스트 모양이 아닌 값은 거부", () => {
    expect(requestOrigin(hdrs({ host: "www.a11ychk.com", "x-forwarded-proto": "http" }))).toBeNull();
    expect(requestOrigin(hdrs({ host: "192.168.0.5:3100" }))).toBe("https://192.168.0.5:3100");
    expect(requestOrigin(hdrs({ host: "192.168.0.5:3100", "x-forwarded-proto": "http" }))).toBeNull();
    expect(requestOrigin(hdrs({ host: "localhost:3100", "x-forwarded-proto": "javascript" }))).toBeNull();
    expect(requestOrigin(hdrs({ host: "evil.example/path" }))).toBeNull();
    expect(requestOrigin(hdrs({ host: "user@evil.example" }))).toBeNull();
    expect(requestOrigin(hdrs({ host: "a b" }))).toBeNull();
    expect(requestOrigin(hdrs({}))).toBeNull();
  });

  it("돌아온 쿼리: 토스가 &로 붙이든 ?로 한 번 더 붙이든 같은 값을 읽는다", () => {
    for (const search of [
      `?checkout=${PRICE_ID}&locale=en&customerKey=ck-1&authKey=ak_A1-b`,
      `?checkout=${PRICE_ID}&locale=en?customerKey=ck-1&authKey=ak_A1-b`,
      // 서버가 두 번째 ?(와 그 뒤)를 인코딩해 넘긴 경우
      `?checkout=${PRICE_ID}&locale=en%3FcustomerKey%3Dck-1&authKey=ak_A1-b`,
      `?checkout=${PRICE_ID}&locale=en%3FcustomerKey%3Dck-1%26authKey%3Dak_A1-b`,
    ]) {
      const p = tossReturnParams(search);
      expect([p.get("checkout"), p.get("locale"), p.get("customerKey"), p.get("authKey")]).toEqual([PRICE_ID, "en", "ck-1", "ak_A1-b"]);
    }
    // 실패 주소의 message에 ?가 있어도 code는 앞의 값 그대로
    expect(tossReturnParams(`?checkout=${PRICE_ID}&locale=ko&code=PAY_PROCESS_CANCELED&message=${encodeURIComponent("취소할까요?code=X")}`).get("code")).toBe(
      "PAY_PROCESS_CANCELED",
    );
    expect(tossReturnParams("").get("checkout")).toBeNull();
  });

  it("성공·실패 주소에는 시도 id와 로케일만 싣는다", () => {
    const urls = checkoutReturnUrls("https://www.a11ychk.com", PRICE_ID, "en");
    expect(urls).toEqual({
      successUrl: `https://www.a11ychk.com/api/billing/toss/callback?checkout=${PRICE_ID}&locale=en`,
      failUrl: `https://www.a11ychk.com/api/billing/toss/fail?checkout=${PRICE_ID}&locale=en`,
    });
  });
});

describe("동시 시도 차단 판정", () => {
  const open = (expiresAt: number) => ({ id: `open-${expiresAt}`, status: "open" as const, expires_at: iso(expiresAt) });
  const processing = (expiresAt: number) => ({ id: `proc-${expiresAt}`, status: "processing" as const, expires_at: iso(expiresAt) });

  it("시도가 없으면 통과", () => {
    expect(planCheckoutGuard([], { now: NOW, pendingInitialPayment: false })).toEqual({ expireOpen: [], expireProcessing: [], blockedBy: null });
  });

  it("만료 전 open이면 막고, 만료된 open(만료 시각과 같아도)은 정리만 하고 통과", () => {
    expect(planCheckoutGuard([open(NOW + MIN)], { now: NOW, pendingInitialPayment: false })).toMatchObject({ blockedBy: "open", expireOpen: [] });
    const stale = planCheckoutGuard([open(NOW - MIN), open(NOW)], { now: NOW, pendingInitialPayment: false });
    expect(stale).toEqual({ expireOpen: [`open-${NOW - MIN}`, `open-${NOW}`], expireProcessing: [], blockedBy: null });
  });

  it("processing은 만료 시각 +30분 전이면 막고, 지났으면 멈춘 것으로 정리한다", () => {
    expect(planCheckoutGuard([processing(NOW - MIN)], { now: NOW, pendingInitialPayment: false })).toMatchObject({ blockedBy: "processing", expireProcessing: [] });
    const dead = processing(NOW - PROCESSING_STALE_MS);
    expect(planCheckoutGuard([dead], { now: NOW, pendingInitialPayment: false })).toEqual({
      expireOpen: [],
      expireProcessing: [dead.id],
      blockedBy: null,
    });
  });

  it("결과를 모르는 첫 결제가 있으면 시도와 무관하게 막고, 오래된 processing도 정리하지 않는다(대사가 확정한다)", () => {
    expect(planCheckoutGuard([], { now: NOW, pendingInitialPayment: true })).toMatchObject({ blockedBy: "processing" });
    const old = processing(NOW - DAY);
    expect(planCheckoutGuard([old, open(NOW - MIN)], { now: NOW, pendingInitialPayment: true })).toEqual({
      expireOpen: [`open-${NOW - MIN}`],
      expireProcessing: [],
      blockedBy: "processing",
    });
  });

  it("끝난 시도(completed·failed·expired)는 판정에 넣지 않는다", () => {
    const rows = (["completed", "failed", "expired"] as const).map((status) => ({ id: status, status, expires_at: iso(NOW + MIN) }));
    expect(planCheckoutGuard(rows, { now: NOW, pendingInitialPayment: false })).toMatchObject({ blockedBy: null });
  });

  it("open과 processing이 함께 있으면 processing — open을 닫아도 풀리지 않는다", () => {
    expect(planCheckoutGuard([open(NOW + MIN), processing(NOW + MIN)], { now: NOW, pendingInitialPayment: false }).blockedBy).toBe("processing");
    expect(planCheckoutGuard([open(NOW + MIN)], { now: NOW, pendingInitialPayment: true }).blockedBy).toBe("processing");
  });
});

describe("확인 화면·동의 스냅샷", () => {
  const kstDate = (iso: string) =>
    new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));

  it("1/31 01:00(KST) 가입: 이용 기간은 2/28 01:00까지(짧은 달 말일), 다음 결제일은 그 하루 전인 2/27 — 크론·안내 메일과 같은 규칙", () => {
    // NOW = 2026-01-31 01:00 KST
    const terms = checkoutTerms(priceRow({ amount: 1234, interval: "month" }), NOW);
    expect(terms).toEqual({
      planCode: "pro",
      amount: 1234,
      currency: "KRW",
      interval: "month",
      firstChargeAt: iso(NOW),
      periodEnd: "2026-02-27T16:00:00.000Z",
      nextChargeAt: "2026-02-26T16:00:00.000Z",
    });
    expect(kstDate(terms.firstChargeAt)).toBe("2026-01-31");
    expect(kstDate(terms.periodEnd)).toBe("2026-02-28");
    expect(kstDate(terms.nextChargeAt)).toBe("2026-02-27");
    // 다음 결제일은 결제 예정 안내 메일·크론이 쓰는 그 시각이다
    expect(terms.nextChargeAt).toBe(earliestChargeAt(terms.periodEnd));
    expect(Date.parse(terms.periodEnd) - Date.parse(terms.nextChargeAt)).toBe(CHARGE_LEAD_MS);

    const yearly = checkoutTerms(priceRow({ interval: "year" }), NOW);
    expect(yearly.periodEnd).toBe("2027-01-30T16:00:00.000Z");
    expect(kstDate(yearly.nextChargeAt)).toBe("2027-01-30");
  });

  it("크론은 다음 결제일(nextChargeAt)부터 결제한다 — 그 직전은 결제하지 않는다", () => {
    const terms = checkoutTerms(priceRow({ interval: "month" }), NOW);
    const sub = subscriptionRow({ user_id: USER, current_period_start: terms.firstChargeAt, current_period_end: terms.periodEnd, reminder_sent_for: terms.periodEnd });
    expect(decideRenewalAction(sub, Date.parse(terms.nextChargeAt) - 1)).not.toBe("charge");
    expect(decideRenewalAction(sub, Date.parse(terms.nextChargeAt))).toBe("charge");
  });

  it("스냅샷은 화면과 같은 계산(기간 끝·다음 결제일) + 로케일, 판 번호는 고정 문자열", () => {
    const price = priceRow({ amount: 1234, interval: "month" });
    expect(consentSnapshot(price, NOW, "en")).toEqual({
      plan_code: "pro",
      amount: 1234,
      currency: "KRW",
      interval: "month",
      first_charge_at: iso(NOW),
      period_end: "2026-02-27T16:00:00.000Z",
      next_charge_at: "2026-02-26T16:00:00.000Z",
      locale: "en",
    });
    expect(DISCLOSURE_VERSION).toBe("recurring-2026-10");
    expect(CHECKOUT_TTL_MS).toBe(30 * MIN);
  });
});

describe("카드 변경 대상", () => {
  it("그 사용자의 진행 중 토스 구독(같은 모드)만", () => {
    const base = subscriptionRow({ user_id: USER });
    expect(isCardChangeTarget(base, USER, false)).toBe(true);
    expect(isCardChangeTarget({ ...base, status: "past_due" }, USER, false)).toBe(true);
    expect(isCardChangeTarget(base, "someone-else", false)).toBe(false);
    expect(isCardChangeTarget(base, USER, true)).toBe(false);
    expect(isCardChangeTarget({ ...base, status: "ended" }, USER, false)).toBe(false);
    expect(isCardChangeTarget({ ...base, provider: "manual", interval: "contract" }, USER, false)).toBe(false);
    expect(isCardChangeTarget({ ...base, user_id: null }, USER, false)).toBe(false);
  });
});

describe("토스 리다이렉트 뒤 이동", () => {
  it("구독·카드 변경·확인 중은 결제 관리로", () => {
    expect(callbackRedirectPath({ kind: "subscribed", subscriptionId: SUB_ID }, "ko")).toBe("/ko/mypage/billing?result=subscribed");
    expect(callbackRedirectPath({ kind: "cardChanged", subscriptionId: SUB_ID, retry: "paid" }, "en")).toBe(
      "/en/mypage/billing?result=cardChanged&retry=paid",
    );
    expect(callbackRedirectPath({ kind: "cardChanged", subscriptionId: SUB_ID, retry: "none" }, "ko")).toBe(
      "/ko/mypage/billing?result=cardChanged&retry=none",
    );
    expect(callbackRedirectPath({ kind: "pending" }, "ko")).toBe("/ko/mypage/billing?result=pending");
  });

  it("오류는 가격이 있으면 그 결제 화면, 없으면 결제 관리", () => {
    expect(callbackRedirectPath({ kind: "error", code: "cardRejected", priceId: PRICE_ID }, "ko")).toBe(
      `/ko/billing/checkout?price=${PRICE_ID}&error=cardRejected`,
    );
    expect(callbackRedirectPath({ kind: "error", code: "notFound" }, "en")).toBe("/en/mypage/billing?error=notFound");
  });

  it("결제창 실패: 새 구독이면 결제 화면, 카드 변경·모르는 시도면 결제 관리", () => {
    expect(failRedirectPath({ priceId: PRICE_ID, reason: "canceled", purpose: "subscribe" }, "ko")).toBe(
      `/ko/billing/checkout?price=${PRICE_ID}&error=canceled`,
    );
    expect(failRedirectPath({ priceId: PRICE_ID, reason: "failed", purpose: "card_change" }, "ko")).toBe("/ko/mypage/billing?error=failed");
    expect(failRedirectPath({ priceId: null, reason: "canceled", purpose: null }, "en")).toBe("/en/mypage/billing?error=canceled");
  });
});
