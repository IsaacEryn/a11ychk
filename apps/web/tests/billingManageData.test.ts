import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { NOT_USER_FACING } from "../src/lib/billing/flows/renew";
import {
  PAYMENT_STATUS_KEYS,
  cardSummaryOf,
  hasBillingRecord,
  loadLiveSubscriptions,
  loadPaymentHistory,
  nextChargeAt,
  paymentStatusKey,
} from "../src/lib/billing/manageData";
import { amountInMajorUnits } from "../src/lib/billing/price";

describe("cardSummaryOf — 결제 관리에 보일 카드 요약만 남긴다", () => {
  it("토스 카드 요약의 세 문자열 필드만", () => {
    expect(cardSummaryOf({ issuerCode: "61", number: "1234****", cardType: "신용", billingKey: "bk_plain", extra: 1 })).toEqual({
      issuerCode: "61",
      number: "1234****",
      cardType: "신용",
    });
  });

  it("문자열이 아닌 값은 버린다", () => {
    expect(cardSummaryOf({ issuerCode: 61, number: "1234****", cardType: { x: 1 } })).toEqual({ issuerCode: null, number: "1234****", cardType: null });
  });

  it("마스킹 번호가 없거나 문자열이 아니면 요약 없음(null)", () => {
    expect(cardSummaryOf({ issuerCode: "61", cardType: "신용" })).toBeNull();
    expect(cardSummaryOf({ number: 1234 })).toBeNull();
    expect(cardSummaryOf({ number: "" })).toBeNull();
    for (const raw of [null, undefined, "1234****", 42, []]) expect(cardSummaryOf(raw)).toBeNull();
  });

  it("64자를 넘는 값은 버린다(64자까지는 그대로)", () => {
    const at = "9".repeat(64);
    const over = "9".repeat(65);
    expect(cardSummaryOf({ number: at, cardType: over })).toEqual({ issuerCode: null, number: at, cardType: null });
    expect(cardSummaryOf({ number: over, cardType: "신용" })).toBeNull();
  });
});

describe("paymentStatusKey — 결제 내역의 상태 표기", () => {
  it("운영 사고·대사로 확정한 실패(갱신 흐름이 사용자 대상 실패에서 빼는 코드·접두)는 '실패' 대신 청구 없는 미처리", () => {
    const codes = [...NOT_USER_FACING.codes, ...NOT_USER_FACING.prefixes.map((prefix) => `${prefix}NOT_FOUND`), "RECONCILED_ABORTED", "RECONCILED_EXPIRED"];
    for (const code of codes) expect(paymentStatusKey({ status: "failed", failure_code: code }), code).toBe("notProcessed");
  });

  it("카드 거절·빌링키 없음·코드 없는 실패는 그대로 실패 — 접두는 앞에서만 맞춘다", () => {
    for (const code of ["REJECT_CARD_PAYMENT", "NO_BILLING_KEY", "EXCEED_MAX_DAILY_PAYMENT_COUNT", "X_RECONCILED_NOT_FOUND", null]) {
      expect(paymentStatusKey({ status: "failed", failure_code: code }), String(code)).toBe("failed");
    }
  });

  it("실패가 아니면 코드와 무관하게 그 상태 — 대사가 적은 환불, 자동 취소에 실패해 paid로 남은 결제", () => {
    expect(paymentStatusKey({ status: "refunded", failure_code: "RECONCILED_CANCELED" })).toBe("refunded");
    expect(paymentStatusKey({ status: "partially_refunded", failure_code: "RECONCILED_PARTIAL_CANCELED" })).toBe("partially_refunded");
    expect(paymentStatusKey({ status: "paid", failure_code: "CANCEL_FAILED" })).toBe("paid");
    expect(paymentStatusKey({ status: "pending", failure_code: null })).toBe("pending");
  });

  it("표기마다 결제 관리 문구가 ko·en 모두 있다", () => {
    for (const locale of ["ko", "en"]) {
      const messages = JSON.parse(readFileSync(new URL(`../messages/${locale}.json`, import.meta.url), "utf8"));
      for (const key of PAYMENT_STATUS_KEYS) {
        expect(typeof messages.billing.manage.payments.status[key], `${locale} billing.manage.payments.status.${key}`).toBe("string");
      }
    }
  });

  it("결제 내역은 실패 코드를 함께 읽는다(표기를 가르는 데만 쓴다)", async () => {
    let selected = "";
    const rows = [{ id: "p1", livemode: false, kind: "renewal", amount: 1, currency: "KRW", status: "failed", failure_code: "RECONCILED_NOT_FOUND" }];
    const chain = {
      select: (cols: string) => {
        selected = cols;
        return chain;
      },
      eq: () => chain,
      in: () => chain,
      order: () => chain,
      limit: async () => ({ data: rows, error: null }),
    };
    const out = await loadPaymentHistory({ from: () => chain } as unknown as SupabaseClient, "u1", [false]);
    expect(selected.split(",").map((c) => c.trim())).toContain("failure_code");
    expect(paymentStatusKey(out[0])).toBe("notProcessed");
  });
});

/** 쿼리 빌더 대역 — 호출을 기록하고 마지막에 data를 준다 */
function recordingDb(data: unknown) {
  const calls: Array<[string, unknown[]]> = [];
  const chain: Record<string, unknown> = {};
  for (const name of ["select", "eq", "in", "order", "limit"]) {
    chain[name] = (...args: unknown[]) => {
      calls.push([name, args]);
      return chain;
    };
  }
  chain.then = (ok: (v: unknown) => unknown) => Promise.resolve({ data, error: null }).then(ok);
  return { db: { from: () => chain } as unknown as SupabaseClient, calls };
}

describe("결제 관리 — 해외 결제(Polar) 구독도 읽는다", () => {
  it("진행 중 구독·결제 기록 판정에 mor를 넣는다(토스·기관 계약과 함께)", async () => {
    const live = recordingDb([]);
    await loadLiveSubscriptions(live.db, "u1", [false]);
    expect(live.calls).toContainEqual(["in", ["provider", ["toss", "mor", "manual"]]]);

    const any = recordingDb([{ id: "s" }]);
    expect(await hasBillingRecord(any.db, "u1", [true])).toBe(true);
    expect(any.calls).toContainEqual(["in", ["provider", ["toss", "mor", "manual"]]]);
  });

  it("결제 내역은 결제사도 읽는다(MoR 행의 영수증 안내를 가른다) — 금액은 행의 통화 단위(USD는 cent)", async () => {
    let selected = "";
    const chain = {
      select: (cols: string) => {
        selected = cols;
        return chain;
      },
      eq: () => chain,
      in: () => chain,
      order: () => chain,
      limit: async () => ({ data: [], error: null }),
    };
    await loadPaymentHistory({ from: () => chain } as unknown as SupabaseClient, "u1", [false]);
    expect(selected.split(",").map((c) => c.trim())).toEqual(expect.arrayContaining(["provider", "amount", "currency"]));
    // 화면은 cent를 달러로 바꿔 통화 서식에 넘긴다 — 환불 기록(세금 제외)을 결제 금액에서 빼지 않는다
    expect(amountInMajorUnits(1334, "USD")).toBe(13.34);
    expect(amountInMajorUnits(1234, "KRW")).toBe(1234);
  });

  it("다음 결제일 — 토스는 기간 끝 하루 전(지났으면 지금), MoR은 기간 끝(Polar가 기간 끝에 청구, 지났으면 지금)", () => {
    const now = Date.parse("2026-01-30T16:00:00.000Z");
    const end = "2026-02-28T16:00:00+00:00";
    expect(nextChargeAt({ provider: "toss", current_period_end: end }, now)).toBe("2026-02-27T16:00:00.000Z");
    expect(nextChargeAt({ provider: "mor", current_period_end: end }, now)).toBe("2026-02-28T16:00:00.000Z");
    const past = "2026-01-30T10:00:00+00:00";
    expect(nextChargeAt({ provider: "mor", current_period_end: past }, now)).toBe("2026-01-30T16:00:00.000Z");
    expect(nextChargeAt({ provider: "toss", current_period_end: past }, now)).toBe("2026-01-30T16:00:00.000Z");
  });
});
