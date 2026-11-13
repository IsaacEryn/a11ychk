import { describe, expect, it } from "vitest";
import { aggregateScan, automatedComplianceRate, siteLevelOptions, type PageScanResult, type PageSignature } from "@a11ychk/core";
import { parseExtensionSignature } from "../src/lib/scan/extensionSignature";

const PAGE_URL = "https://example.com/";
const MEDIA_SCS = ["1.2.1", "1.2.2", "1.2.3", "1.2.4", "1.2.5"];

/** 보고서 WCAG 매트릭스에서 '해당 없음'으로 판정된 1.2.x */
function notPresentMedia(summary: ReturnType<typeof aggregateScan>): string[] {
  return summary.wcagMatrix.filter((r) => MEDIA_SCS.includes(r.scId) && r.outcome === "notPresent").map((r) => r.scId);
}

/** collectPageSignature가 내는 모양 그대로 (url 없음) */
function collected(overrides: Record<string, unknown> = {}) {
  return {
    title: "예시 홈",
    navLinks: ["회사소개", "제품"],
    hasSearch: false,
    hasSitemap: false,
    hasMedia: false,
    review: { alts: [{ selector: "img.logo", text: "예시 로고" }], labels: [], genericLinks: [] },
    ...overrides,
  };
}

/** 미디어 없는 페이지에서 위반이 있는 결과 — 1.2.x를 '해당 없음'으로 세느냐에 따라 준수율이 갈린다 */
const page: PageScanResult = {
  url: PAGE_URL,
  violations: [{ ruleId: "image-alt", impact: "critical", tags: ["wcag2a", "wcag111"], helpUrl: "", nodes: [] }],
  passes: ["document-title", "html-has-lang"],
  incomplete: [],
  scannedAt: "2026-11-13T00:00:00Z",
};

describe("parseExtensionSignature — 확장이 보낸 시그니처 검증", () => {
  it("모양이 맞으면 저장할 페이지 url을 붙여 돌려주고, 정의되지 않은 키는 버린다", () => {
    const sig = parseExtensionSignature({ ...collected(), url: "https://evil.example/", extra: "x" }, PAGE_URL);
    expect(sig).toEqual({ url: PAGE_URL, ...collected() });
    expect(sig).not.toHaveProperty("extra");
  });

  it("확인용 자료(review)가 없어도 받는다 — 타입에서 선택 항목", () => {
    const { review: _review, ...withoutReview } = collected();
    void _review;
    expect(parseExtensionSignature(withoutReview, PAGE_URL)).toEqual({ url: PAGE_URL, ...withoutReview });
  });

  it("없으면(0.6.2 이하 확장) null", () => {
    expect(parseExtensionSignature(undefined, PAGE_URL)).toBeNull();
    expect(parseExtensionSignature(null, PAGE_URL)).toBeNull();
  });

  it("모양이 틀리면 저장을 막지 않고 null로 버린다", () => {
    expect(parseExtensionSignature(collected({ hasMedia: "false" }), PAGE_URL)).toBeNull();
    expect(parseExtensionSignature(collected({ hasMedia: undefined }), PAGE_URL)).toBeNull();
    expect(parseExtensionSignature(collected({ navLinks: Array.from({ length: 41 }, (_, i) => `링크${i}`) }), PAGE_URL)).toBeNull();
    expect(parseExtensionSignature(collected({ title: "가".repeat(2001) }), PAGE_URL)).toBeNull();
    expect(parseExtensionSignature("hasMedia=false", PAGE_URL)).toBeNull();
  });
});

describe("확장 저장 경로의 자동 준수율 — 확장 화면·웹 맛보기 검사와 같은 식", () => {
  // 확장 화면(summarizePage)과 맛보기 검사 라우트가 쓰는 식
  const clientRate = (sig: PageSignature | null) =>
    automatedComplianceRate(aggregateScan([page], "4.12.1", siteLevelOptions(sig ? [sig] : [], 1)));

  it("미디어 없는 페이지는 서버가 검증한 시그니처로도 확장 화면과 같은 준수율이 나온다", () => {
    const clientSig: PageSignature = { url: PAGE_URL, ...collected() };
    const serverSig = parseExtensionSignature(collected(), PAGE_URL);
    const serverSummary = aggregateScan([page], "4.12.1", siteLevelOptions(serverSig ? [serverSig] : [], 1));
    expect(notPresentMedia(serverSummary)).toEqual(MEDIA_SCS);
    expect(automatedComplianceRate(serverSummary)).toBe(clientRate(clientSig));
    // 옵션을 빼던 예전 저장 경로보다 높다 — 이번 변경으로 맞춘 차이
    expect(automatedComplianceRate(serverSummary)).toBeGreaterThan(automatedComplianceRate(aggregateScan([page], "4.12.1")));
  });

  it("시그니처가 틀리거나 없으면 '해당 없음'을 세지 않는다(예전 저장 경로와 같은 값)", () => {
    const serverSig = parseExtensionSignature(collected({ hasMedia: 1 }), PAGE_URL);
    const serverSummary = aggregateScan([page], "4.12.1", siteLevelOptions(serverSig ? [serverSig] : [], 1));
    expect(notPresentMedia(serverSummary)).toEqual([]);
    expect(automatedComplianceRate(serverSummary)).toBe(automatedComplianceRate(aggregateScan([page], "4.12.1")));
    expect(automatedComplianceRate(serverSummary)).toBe(clientRate(null));
  });

  it("미디어가 있으면 '해당 없음'을 세지 않는다", () => {
    const serverSig = parseExtensionSignature(collected({ hasMedia: true }), PAGE_URL);
    expect(serverSig?.hasMedia).toBe(true);
    expect(siteLevelOptions([serverSig!], 1).notPresentScs).toEqual([]);
  });
});
