import { describe, expect, it } from "vitest";
import { isBlankDocumentState, THIRD_PARTY_AD_EXCLUDE } from "../src/scanner/runAxe";

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

describe("THIRD_PARTY_AD_EXCLUDE — 제3자 광고 요소 제외 선택자", () => {
  const matchesAny = (sel: string) => THIRD_PARTY_AD_EXCLUDE.some((p) => p.includes(sel));

  it("AdSense/DoubleClick/reCAPTCHA 핵심 도메인·컨테이너를 포함한다", () => {
    expect(matchesAny("googlesyndication.com")).toBe(true); // sodar 추적 이미지
    expect(matchesAny("doubleclick.net")).toBe(true); // 광고 슬롯 iframe
    expect(matchesAny("google.com/recaptcha")).toBe(true);
    expect(matchesAny("adsbygoogle")).toBe(true);
  });

  it("태그 무관 [src*=...] 선택자가 있어 img(sodar) 등 iframe 아닌 요소도 걸러진다", () => {
    expect(THIRD_PARTY_AD_EXCLUDE).toContain('[src*="googlesyndication.com"]');
  });

  it("axe exclude 컨텍스트 형태(선택자 배열의 배열)로 변환 가능하다", () => {
    const ctx = { exclude: THIRD_PARTY_AD_EXCLUDE.map((s) => [s]) };
    expect(Array.isArray(ctx.exclude)).toBe(true);
    expect(ctx.exclude.every((e) => Array.isArray(e) && typeof e[0] === "string")).toBe(true);
  });
});
