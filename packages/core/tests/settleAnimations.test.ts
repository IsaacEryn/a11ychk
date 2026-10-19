import { afterEach, describe, expect, it } from "vitest";
import { waitFiniteAnimationsInPage } from "../src/scanner/settleAnimations";

// 페이지 안 함수가 쓰는 document.getAnimations()만 흉내낸다
interface FakeAnimation {
  playState: string;
  effect: { getComputedTiming: () => { iterations: number } } | null;
  finished: Promise<unknown>;
}

function anim(playState: string, iterations: number, finished: Promise<unknown>): FakeAnimation {
  return { playState, effect: { getComputedTiming: () => ({ iterations }) }, finished };
}

const never = () => new Promise<never>(() => undefined);
const after = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function withAnimations(list: FakeAnimation[]): void {
  (globalThis as { document?: unknown }).document = { getAnimations: () => list };
}

afterEach(() => {
  delete (globalThis as { document?: unknown }).document;
});

describe("waitFiniteAnimationsInPage (유한 애니메이션 1회 대기)", () => {
  it("애니메이션이 없으면 바로 0을 돌려준다", async () => {
    withAnimations([]);
    await expect(waitFiniteAnimationsInPage(1_000)).resolves.toBe(0);
  });

  it("무한 반복·일시정지·종료 애니메이션은 기다리지 않는다", async () => {
    withAnimations([
      anim("running", Infinity, never()),
      anim("paused", 1, never()),
      anim("finished", 1, Promise.resolve()),
      { playState: "running", effect: null, finished: never() },
    ]);
    const started = Date.now();
    await expect(waitFiniteAnimationsInPage(1_000)).resolves.toBe(0);
    expect(Date.now() - started).toBeLessThan(100);
  });

  it("재생 중인 유한 애니메이션이 끝날 때까지 기다린다", async () => {
    withAnimations([anim("running", 1, after(50)), anim("running", 2, after(80)), anim("running", Infinity, never())]);
    const started = Date.now();
    await expect(waitFiniteAnimationsInPage(1_000)).resolves.toBe(2);
    const elapsed = Date.now() - started;
    expect(elapsed).toBeGreaterThanOrEqual(70);
    expect(elapsed).toBeLessThan(500);
  });

  it("끝나지 않는 유한 애니메이션은 상한에서 끊는다", async () => {
    withAnimations([anim("running", 1, never())]);
    const started = Date.now();
    await expect(waitFiniteAnimationsInPage(60)).resolves.toBe(1);
    expect(Date.now() - started).toBeLessThan(500);
  });

  it("취소되어 finished가 reject돼도 끝난 것으로 본다", async () => {
    withAnimations([anim("running", 1, Promise.reject(new DOMException("aborted", "AbortError")))]);
    await expect(waitFiniteAnimationsInPage(1_000)).resolves.toBe(1);
  });
});
