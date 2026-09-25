import { describe, expect, it, vi } from "vitest";
import type { ScanSummary } from "@a11ychk/core/catalog";

// notify는 Resend 등 서버 의존을 끌어오므로 판정 함수 테스트에서는 비운다
vi.mock("@/lib/notify", () => ({ sendScanAlert: vi.fn() }));

const { detectRegression, isAlertCandidate } = await import("@/lib/scan/autoAlert");

const summary = (rate: number, byRule: Record<string, number> = {}): ScanSummary =>
  ({ complianceRate: rate, byRule, scores: { combined: { rate } } }) as unknown as ScanSummary;

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

describe("detectRegression — 준수율 하락 또는 신규 위반 규칙", () => {
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

  it("scores가 없는 구버전 요약은 complianceRate로 비교", () => {
    const old = { complianceRate: 80, byRule: {} } as unknown as ScanSummary;
    const r = detectRegression(old, summary(70));
    expect(r.prevRate).toBe(80);
    expect(r.regressed).toBe(true);
  });
});
