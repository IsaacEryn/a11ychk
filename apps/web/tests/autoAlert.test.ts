import { describe, expect, it, vi } from "vitest";
import type { ScanSummary } from "@a11ychk/core/catalog";

// notify는 Resend 등 서버 의존을 끌어오므로 판정 함수 테스트에서는 비운다
vi.mock("@/lib/notify", () => ({ sendScanAlert: vi.fn() }));

const { detectRegression, isAlertCandidate, isCompleteScan, sampleKey } = await import("@/lib/scan/autoAlert");

const summary = (rate: number, byRule: Record<string, number> = {}): ScanSummary =>
  ({
    complianceRate: rate,
    byRule,
    scores: { automated: { rate, evaluated: 20 }, combined: { rate: 100 } },
  }) as unknown as ScanSummary;

describe("isAlertCandidate — 정기 검사 판별은 source로만", () => {
  it("완료된 정기 검사 + 도메인 연결이면 대상", () => {
    expect(isAlertCandidate({ status: "done", source: "scheduled", domain_id: "d1" })).toBe(true);
  });

  it("scope 유무와 무관 — 크론이 DEFAULT_SCOPE를 저장해도 대상 (2026-07 회귀 재발 방지)", () => {
    const row = { status: "done", source: "scheduled", domain_id: "d1", scope: { targetLevel: "AA" } };
    expect(isAlertCandidate(row)).toBe(true);
  });

  it("사용자가 직접 실행한 검사는 대상 아님", () => {
    expect(isAlertCandidate({ status: "done", source: "user", domain_id: "d1" })).toBe(false);
  });

  it("source 컬럼 부재(0029 미적용)면 보내지 않는다", () => {
    expect(isAlertCandidate({ status: "done", domain_id: "d1" })).toBe(false);
  });

  it("미완료·도메인 미연결·행 없음은 대상 아님", () => {
    expect(isAlertCandidate({ status: "failed", source: "scheduled", domain_id: "d1" })).toBe(false);
    expect(isAlertCandidate({ status: "done", source: "scheduled", domain_id: null })).toBe(false);
    expect(isAlertCandidate(null)).toBe(false);
  });
});

describe("detectRegression — 자동 준수율 하락 또는 신규 위반 규칙", () => {
  it("점검자 판정으로 달라지는 통합 준수율은 비교하지 않는다", () => {
    const prev = { complianceRate: 90, byRule: {}, scores: { automated: { rate: 90, evaluated: 20 }, combined: { rate: 95 } } };
    const cur = { complianceRate: 90, byRule: {}, scores: { automated: { rate: 90, evaluated: 20 }, combined: { rate: 70 } } };
    expect(detectRegression(prev as unknown as ScanSummary, cur as unknown as ScanSummary).regressed).toBe(false);
  });

  it("0.5%p 넘게 떨어지면 회귀", () => {
    expect(detectRegression(summary(90), summary(89.4)).regressed).toBe(true);
  });

  it("0.5%p 이내 등락은 회귀 아님", () => {
    expect(detectRegression(summary(90), summary(89.5)).regressed).toBe(false);
    expect(detectRegression(summary(90), summary(95)).regressed).toBe(false);
  });

  it("직전에 없던 위반 규칙이 생기면 준수율과 무관하게 회귀", () => {
    const r = detectRegression(summary(90, { "image-alt": 2 }), summary(92, { "image-alt": 1, label: 3 }));
    expect(r.regressed).toBe(true);
    expect(r.newRuleIds).toEqual(["label"]);
  });

  it("scores가 없는 옛 요약과는 준수율을 비교하지 않는다(규칙 단위·SC 단위 혼합 방지)", () => {
    const old = { complianceRate: 80, byRule: {} } as unknown as ScanSummary;
    expect(detectRegression(old, summary(70)).regressed).toBe(false);
  });

  it("자동 평가가 0건인 쪽이 있으면 준수율 비교를 건너뛴다", () => {
    const empty = { complianceRate: 0, byRule: {}, scores: { automated: { rate: 0, evaluated: 0 } } };
    expect(detectRegression(summary(80), empty as unknown as ScanSummary).regressed).toBe(false);
  });

  it("표본 조건이 다르면 신규 위반 규칙으로 알리지 않는다", () => {
    const r = detectRegression(summary(90), summary(90, { label: 1 }), { sameSample: false });
    expect(r.newRuleIds).toEqual([]);
    expect(r.regressed).toBe(false);
  });

  it("모범 사례 권고 규칙은 신규 위반에서 뺀다", () => {
    const cur = { ...summary(90, { region: 3 }), bestPractice: [{ ruleId: "region", count: 3 }] };
    expect(detectRegression(summary(90), cur as ScanSummary).regressed).toBe(false);
  });
});

describe("sampleKey — 표본 조건 비교", () => {
  it("페이지 수·범위·제외 규칙(순서 무관)이 같으면 같다", () => {
    const a = { page_limit: 10, scope: { conformanceTarget: "AA" }, summary: { excludedRules: ["b", "a"] } };
    const b = { page_limit: 10, scope: { conformanceTarget: "AA" }, summary: { excludedRules: ["a", "b"] } };
    expect(sampleKey(a)).toBe(sampleKey(b));
  });

  it("페이지 수가 다르면 다르다(소유 확인 전후 표본 크기 변화)", () => {
    expect(sampleKey({ page_limit: 5 })).not.toBe(sampleKey({ page_limit: 10 }));
  });
});

describe("isCompleteScan — 일부 페이지만 끝난 검사는 신규 위반 비교에서 뺀다", () => {
  it("표본 전 페이지를 끝냈으면 완료", () => {
    expect(isCompleteScan({ pageCount: 10, scannedPageCount: 10 } as ScanSummary)).toBe(true);
  });
  it("시간 초과로 일부만 끝났으면 미완료", () => {
    expect(isCompleteScan({ pageCount: 10, scannedPageCount: 6 } as ScanSummary)).toBe(false);
  });
});

describe("detectRegression — 준수율을 비교하지 않았으면 rateCompared=false", () => {
  it("옛 요약과 비교하면 메일에서 준수율 변화를 뺄 수 있게 알린다", () => {
    const old = { complianceRate: 80, byRule: {} } as unknown as ScanSummary;
    expect(detectRegression(old, summary(70)).rateCompared).toBe(false);
    expect(detectRegression(summary(80), summary(70)).rateCompared).toBe(true);
  });
});
