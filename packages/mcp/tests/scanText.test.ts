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
  siteCheckFailures: [],
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

  it("사이트 수준 검사 실패는 준수율에 들어간다고 밝히고 항목을 나열한다", () => {
    const text = renderText(
      {
        ...base,
        scannedPages: 2,
        complianceRate: 80,
        siteCheckFailures: [{ ruleId: "a11ychk:multiple-ways", title: "페이지를 찾는 방법이 하나뿐입니다", wcag: ["2.4.5"] }],
      },
      "ko",
    );
    expect(text).toContain("사이트 수준 검사(여러 페이지 비교, 준수율에 반영)");
    expect(text).toContain("- 페이지를 찾는 방법이 하나뿐입니다 (`a11ychk:multiple-ways`, WCAG 2.4.5)");
  });

  it("사이트 수준 검사 실패가 없으면 그 문단을 넣지 않는다", () => {
    const text = renderText({ ...base, scannedPages: 1, complianceRate: 100 }, "en");
    expect(text).not.toContain("Site-level checks");
  });
});
