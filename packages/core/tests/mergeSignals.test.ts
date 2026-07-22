import { describe, expect, it } from "vitest";
import { mergePageSignals } from "../src/scanner/collectSignals";
import type { PageCheckSignals } from "../src/scanner/pageChecks";

function signals(partial: Partial<PageCheckSignals> = {}): PageCheckSignals {
  return {
    inlineClickNonInteractive: [],
    focusSampled: 0,
    focusNoOutline: 0,
    focusExamples: [],
    hasMedia: false,
    altSampled: 0,
    altFilename: [],
    altGeneric: [],
    autoplay: [],
    genericLinks: 0,
    smallTargets: [],
    targetSampled: 0,
    hasNav: false,
    skipLinkPresent: false,
    videoNoTrack: 0,
    blankNoNotice: 0,
    ...partial,
  };
}

describe("mergePageSignals — 프레임별 신호 병합", () => {
  it("개수는 합산, 존재 여부는 OR", () => {
    const top = signals({ altSampled: 2, videoNoTrack: 1, hasMedia: false });
    const sub = signals({ altSampled: 3, videoNoTrack: 2, hasMedia: true, genericLinks: 4 });
    const m = mergePageSignals(top, [sub]);
    expect(m.altSampled).toBe(5);
    expect(m.videoNoTrack).toBe(3);
    expect(m.genericLinks).toBe(4);
    expect(m.hasMedia).toBe(true);
  });

  it("hasNav·skipLinkPresent는 상위 프레임 값만 사용 (하위 프레임이 가리지 않음)", () => {
    const top = signals({ hasNav: true, skipLinkPresent: false });
    const sub = signals({ hasNav: false, skipLinkPresent: true }); // 임베드 위젯의 앵커
    const m = mergePageSignals(top, [sub]);
    expect(m.hasNav).toBe(true);
    expect(m.skipLinkPresent).toBe(false);
  });

  it("예시 배열은 수집기 상한으로 잘림", () => {
    const ex = (n: number) => Array.from({ length: n }, (_, i) => ({ selector: `#e${i}`, html: "<a>" }));
    const top = signals({ inlineClickNonInteractive: ex(6), focusExamples: ex(4) });
    const sub = signals({ inlineClickNonInteractive: ex(6), focusExamples: ex(4) });
    const m = mergePageSignals(top, [sub]);
    expect(m.inlineClickNonInteractive).toHaveLength(8);
    expect(m.focusExamples).toHaveLength(5);
  });

  it("하위 프레임이 없으면 상위 신호 그대로 (복사본)", () => {
    const top = signals({ altSampled: 1, altFilename: [{ selector: "#a", html: "<img>", alt: "x.png" }] });
    const m = mergePageSignals(top, []);
    expect(m).toEqual(top);
    m.altFilename.push({ selector: "#b", html: "<img>", alt: "y.png" });
    expect(top.altFilename).toHaveLength(1); // 원본 불변
  });
});
