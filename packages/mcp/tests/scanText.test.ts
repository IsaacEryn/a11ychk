import { describe, expect, it } from "vitest";
import { renderText, type ScanToolResult } from "../src/scan";

const base: ScanToolResult["structuredContent"] = {
  scannedPages: 0,
  failedUrls: [],
  complianceRate: 0,
  violationNodes: 0,
  violationRules: 0,
  advisoryRules: 0,
  browser: "chromium",
  violations: [],
  advisory: [],
};
const failed = [{ url: "http://localhost:3000/", reason: "검사 엔진(axe-core) 실행 오류로 페이지를 검사하지 못했습니다: Error: x" }];

describe("renderText — 검사 결과 문구", () => {
  it("검사한 페이지가 없으면 준수율·위반 0 대신 검사하지 못했다는 안내를 앞세운다", () => {
    const text = renderText({ ...base, failedUrls: failed }, "ko");
    expect(text.split("\n")[0]).toContain("검사한 페이지가 없습니다");
    expect(text).not.toContain("자동 검사 준수율");
    expect(text).toContain("검사하지 못한 페이지");
    expect(text).toContain(failed[0]!.reason);
  });

  it("영어 결과도 같다", () => {
    const text = renderText({ ...base, failedUrls: failed }, "en");
    expect(text.split("\n")[0]).toContain("No page was scanned");
    expect(text).toContain("Pages that could not be scanned");
  });

  it("검사한 페이지가 있으면 기존처럼 준수율부터 보인다", () => {
    const text = renderText({ ...base, scannedPages: 1, complianceRate: 92.5 }, "ko");
    expect(text.split("\n")[0]).toBe("검사 페이지: 1 / 자동 검사 준수율: 92.5%");
  });
});
