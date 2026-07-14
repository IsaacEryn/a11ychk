import { describe, expect, it } from "vitest";
import { getRuleEntry, RULE_CATALOG, wcagFromTags } from "../src/catalog/rules";
import { KWCAG_BY_ID, KWCAG_ITEMS } from "../src/catalog/kwcag";
import { getManualCheckItems } from "../src/manual/manualChecks";

describe("KWCAG 2.2 검사항목", () => {
  it("정확히 33개 항목", () => {
    expect(KWCAG_ITEMS).toHaveLength(33);
  });

  it("id 중복 없음", () => {
    expect(KWCAG_BY_ID.size).toBe(KWCAG_ITEMS.length);
  });

  it("자동 완전 커버가 아닌 항목은 모두 수동 검사 방법이 있어야 함", () => {
    for (const item of KWCAG_ITEMS) {
      if (item.autoCoverage !== "full") {
        expect(item.howToTest?.ko, `${item.id} ${item.name.ko}`).toBeTruthy();
      }
    }
  });

  it("수동 검사 항목 목록이 비어있지 않음", () => {
    expect(getManualCheckItems().length).toBeGreaterThan(20);
  });
});

describe("규칙 카탈로그 정합성", () => {
  it("ruleId 중복 없음", () => {
    const ids = RULE_CATALOG.map((r) => r.ruleId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("모든 kwcag 참조가 실존하는 검사항목", () => {
    for (const rule of RULE_CATALOG) {
      for (const kw of rule.kwcag) {
        expect(KWCAG_BY_ID.has(kw), `${rule.ruleId} → ${kw}`).toBe(true);
      }
    }
  });

  it("모든 규칙에 한국어 제목·가이드 존재", () => {
    for (const rule of RULE_CATALOG) {
      expect(rule.title.ko.length, rule.ruleId).toBeGreaterThan(0);
      expect(rule.guide.ko.length, rule.ruleId).toBeGreaterThan(10);
    }
  });

  it("WCAG 번호 형식 (x.x.x)", () => {
    for (const rule of RULE_CATALOG) {
      for (const sc of rule.wcag) {
        expect(sc, rule.ruleId).toMatch(/^\d\.\d{1,2}\.\d{1,2}$/);
      }
    }
  });
});

describe("getRuleEntry fallback", () => {
  it("미등록 규칙도 안전한 기본 항목 생성", () => {
    const entry = getRuleEntry("some-future-rule", ["wcag2aa", "wcag143"]);
    expect(entry.ruleId).toBe("some-future-rule");
    expect(entry.wcag).toEqual(["1.4.3"]);
    expect(entry.level).toBe("AA");
    expect(entry.title.ko).toContain("some-future-rule");
  });

  it("등록된 규칙은 카탈로그 항목 반환", () => {
    expect(getRuleEntry("image-alt").kwcag).toContain("5.1.1");
  });
});

describe("wcagFromTags", () => {
  it("axe 태그에서 성공기준 추출", () => {
    expect(wcagFromTags(["wcag2a", "wcag111", "best-practice", "wcag1412"])).toEqual(["1.1.1", "1.4.12"]);
  });
});
