import { describe, expect, it } from "vitest";
import { runFixGuideTool } from "../src/catalog";

describe("get_fix_guide — KWCAG 표기", () => {
  it("kwcag는 공식 번호, 텍스트는 검사항목 일련번호", () => {
    const r = runFixGuideTool("color-contrast", "ko");
    expect(r.structuredContent.kwcag).toEqual(["5.4.3"]);
    expect(r.text).toContain("KWCAG 검사항목 8");
  });

  it("규칙 하나가 여러 항목이면 일련번호 순", () => {
    expect(runFixGuideTool("button-name", "ko").structuredContent.kwcag).toEqual(["6.5.3", "7.3.2"]);
  });
});
