import { describe, expect, it } from "vitest";
import { resolveKwcagItem, runFixGuideTool, runKwcagCheckpointTool } from "../src/catalog";

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

const lookup = (input: string, lang: "ko" | "en" = "ko") => {
  const m = resolveKwcagItem(input);
  if (!m) throw new Error(`찾지 못함: ${input}`);
  return runKwcagCheckpointTool(m, lang);
};

describe("kwcag_checkpoint — 입력 해석과 결과", () => {
  it("공식 번호 5.3.3 → 명확한 지시사항 제공, 안내 없음", () => {
    const r = lookup("5.3.3").structuredContent;
    expect(r).toMatchObject({ id: "5.3.3", serial: 5, slug: "clear-instructions", legacyNote: null });
  });

  it("5.3.1은 공식 번호(표의 구성)로 풀고 옛 뜻을 안내한다", () => {
    const r = lookup("5.3.1").structuredContent;
    expect(r.slug).toBe("table-structure");
    expect(r.principle).toBe("인식의 용이성");
    expect(r.legacyNote).toContain("색에 무관한 콘텐츠 인식");
    expect(r.legacyNote).toContain("5.4.1");
  });

  it("옛 번호에만 있는 7.4.1 → 레이블 제공(7.3.2)과 안내", () => {
    const r = lookup("7.4.1").structuredContent;
    expect(r.id).toBe("7.3.2");
    expect(r.legacyNote).toContain("7.4.1");
    expect(r.legacyNote).toContain("7.3.2");
  });

  it("일련번호 8 → 텍스트 콘텐츠의 명도 대비", () => {
    const r = lookup("8");
    expect(r.structuredContent.slug).toBe("text-contrast");
    expect(r.text.split("\n")[0]).toBe("KWCAG 2.2 검사항목 8 텍스트 콘텐츠의 명도 대비 (5.4.3) — 인식의 용이성");
    expect(r.structuredContent.automatedRules.map((x) => x.ruleId)).toContain("color-contrast");
  });

  it("영어 결과", () => {
    expect(lookup("text-contrast", "en").text.split("\n")[0]).toBe("KWCAG 2.2 Checkpoint 8 Text contrast (5.4.3) — Perceivable");
  });

  it("모르는 값은 null", () => {
    expect(resolveKwcagItem("no-such")).toBeNull();
  });
});
