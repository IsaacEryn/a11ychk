import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { NOT_USER_FACING } from "../src/lib/billing/flows/renew";
import { PAYMENT_STATUS_KEYS, cardSummaryOf, loadPaymentHistory, paymentStatusKey } from "../src/lib/billing/manageData";

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
