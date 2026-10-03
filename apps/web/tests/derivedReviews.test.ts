import { describe, expect, it } from "vitest";
import { buildEffectiveKwcagReviews, buildEffectiveWcagReviews } from "@/app/[locale]/scans/[id]/report/derivedReviews";
import { KWCAG_BY_SLUG } from "@a11ychk/core/catalog";
import type { ReviewValue } from "@/app/[locale]/scans/[id]/report/ReviewCell";

const rv = (outcome: string, note = ""): ReviewValue => ({ outcome, note });

describe("buildEffectiveKwcagReviews — kwcag 직접 > wcag 파생", () => {
  const scs612 = KWCAG_BY_SLUG.get("focus-order-and-visibility")!.wcag;

  it("대응 SC 전부 passed면 KWCAG 항목이 파생 passed로 표시된다", () => {
    const wcag = new Map(scs612.map((sc) => [sc, rv("passed")]));
    const eff = buildEffectiveKwcagReviews(new Map(), wcag);
    expect(eff.get("focus-order-and-visibility")).toMatchObject({ outcome: "passed", derived: true });
  });

  it("부분 판정만으로는 파생하지 않는다", () => {
    const wcag = new Map([[scs612[0]!, rv("passed")]]);
    expect(buildEffectiveKwcagReviews(new Map(), wcag).has("focus-order-and-visibility")).toBe(false);
  });

  it("직접 kwcag 판정이 있으면 파생을 덮지 않는다", () => {
    const wcag = new Map(scs612.map((sc) => [sc, rv("passed")]));
    const direct = new Map([["focus-order-and-visibility", rv("failed", "직접 판정")]]);
    const eff = buildEffectiveKwcagReviews(direct, wcag);
    expect(eff.get("focus-order-and-visibility")).toMatchObject({ outcome: "failed", note: "직접 판정" });
    expect(eff.get("focus-order-and-visibility")!.derived).toBeUndefined();
  });

  it("failed 하나면 부분 판정으로도 failed 파생", () => {
    const wcag = new Map([[scs612[0]!, rv("failed")]]);
    expect(buildEffectiveKwcagReviews(new Map(), wcag).get("focus-order-and-visibility")).toMatchObject({
      outcome: "failed",
      derived: true,
    });
  });
});

describe("buildEffectiveWcagReviews — wcag 직접 > kwcag 파생", () => {
  it("kwcag failed가 대응 SC 전부로 팬아웃된다", () => {
    const eff = buildEffectiveWcagReviews(new Map(), new Map([["focus-order-and-visibility", rv("failed")]]));
    for (const sc of KWCAG_BY_SLUG.get("focus-order-and-visibility")!.wcag) {
      expect(eff.get(sc)).toMatchObject({ outcome: "failed", derived: true });
    }
  });

  it("wcag 직접 판정이 있는 SC는 파생하지 않는다", () => {
    const sc = KWCAG_BY_SLUG.get("focus-order-and-visibility")!.wcag[0]!;
    const eff = buildEffectiveWcagReviews(new Map([[sc, rv("passed")]]), new Map([["focus-order-and-visibility", rv("failed")]]));
    expect(eff.get(sc)).toMatchObject({ outcome: "passed" });
    expect(eff.get(sc)!.derived).toBeUndefined();
  });
});
