import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CYCLE_SUMMARY_KEYS, REVIEW_SUMMARY_KEYS, cycleIssues } from "../src/lib/billing/cycleSummary";

describe("cycleIssues — 관리자 도구가 문제로 보일 결제 크론 결과", () => {
  it("운영자 확인이 필요한 결제(*_review)는 오류·중단과 함께 문제로 센다 — paid로 묻히지 않게", () => {
    expect(cycleIssues({ candidates: 3, charge_paid: 1, charge_review: 1, errors: 0 })).toEqual({ errors: 0, halted: 0, review: 1, any: true });
    expect(cycleIssues({ reconciled_review: 2, retry_review: 1, charge_review: 0 })).toEqual({ errors: 0, halted: 0, review: 3, any: true });
  });

  it("오류·중단도 문제다", () => {
    expect(cycleIssues({ errors: 2 })).toMatchObject({ errors: 2, any: true });
    expect(cycleIssues({ halted: 1 })).toMatchObject({ halted: 1, any: true });
  });

  it("결제·자동 취소·건너뜀만 있으면 문제가 아니다", () => {
    expect(cycleIssues({ candidates: 2, charge_paid: 1, charge_refunded: 1, reconciled_paid: 1, reconciled_review: 0, errors: 0 })).toEqual({
      errors: 0,
      halted: 0,
      review: 0,
      any: false,
    });
    expect(cycleIssues(undefined)).toEqual({ errors: 0, halted: 0, review: 0, any: false });
  });

  it("확인 필요 키는 요약 목록에 있고, 요약 키마다 관리자 도구 문구가 ko·en 모두 있다", () => {
    for (const key of REVIEW_SUMMARY_KEYS) expect(CYCLE_SUMMARY_KEYS).toContain(key);
    for (const locale of ["ko", "en"]) {
      const messages = JSON.parse(readFileSync(new URL(`../messages/${locale}.json`, import.meta.url), "utf8"));
      for (const key of CYCLE_SUMMARY_KEYS) {
        expect(typeof messages.admin.billing.tools.summary[key], `${locale} admin.billing.tools.summary.${key}`).toBe("string");
      }
      expect(messages.admin.billing.tools.ranIssues, locale).toContain("{review, plural,");
    }
  });
});
