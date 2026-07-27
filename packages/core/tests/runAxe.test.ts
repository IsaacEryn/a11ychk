import { describe, expect, it } from "vitest";
import { isBlankDocumentState } from "../src/scanner/runAxe";

describe("isBlankDocumentState — 빈/미로드 문서 가드", () => {
  it("lang·title·body가 모두 비면 빈 문서로 본다(리다이렉트 빈 응답·about:blank)", () => {
    expect(isBlankDocumentState({ hasLang: false, hasTitle: false, bodyEmpty: true })).toBe(true);
  });

  it("본문이 있으면 lang·title이 없어도 빈 문서가 아니다 — 진짜 위반이므로 검사 대상", () => {
    expect(isBlankDocumentState({ hasLang: false, hasTitle: false, bodyEmpty: false })).toBe(false);
  });

  it("lang만 없는 정상 페이지는 빈 문서가 아니다(html-has-lang 위반은 axe가 잡아야 함)", () => {
    expect(isBlankDocumentState({ hasLang: false, hasTitle: true, bodyEmpty: false })).toBe(false);
  });

  it("정상 페이지(lang·title·본문 모두 있음)는 빈 문서가 아니다", () => {
    expect(isBlankDocumentState({ hasLang: true, hasTitle: true, bodyEmpty: false })).toBe(false);
  });

  it("title은 있으나 body가 빈 경우도 빈 문서가 아니다(세 조건 모두여야 확정)", () => {
    expect(isBlankDocumentState({ hasLang: false, hasTitle: true, bodyEmpty: true })).toBe(false);
  });
});
