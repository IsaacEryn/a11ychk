import { afterEach, describe, expect, it, vi } from "vitest";
import {
  TOSS_SDK_URL,
  TossSdkError,
  createTossSdkLoader,
  loadTossPayments,
  type TossPaymentsFactory,
  type TossSdkEnv,
} from "../src/lib/billing/tossSdk";

/** 문서·전역 대역 — 넣은 스크립트를 기록하고, 테스트가 load·error를 직접 일으킨다 */
function fakeEnv() {
  const scripts: Array<{ src: string; listeners: Record<string, Array<() => void>>; removed: boolean }> = [];
  const state: { factory?: TossPaymentsFactory } = {};
  const env: TossSdkEnv = {
    getFactory: () => state.factory,
    findScript: (src) => {
      const s = scripts.find((x) => x.src === src && !x.removed);
      return s ? handle(s) : null;
    },
    insertScript: (src) => {
      const s = { src, listeners: {} as Record<string, Array<() => void>>, removed: false };
      scripts.push(s);
      return handle(s);
    },
    setTimer: (fn, ms) => setTimeout(fn, ms),
    clearTimer: (id) => clearTimeout(id as ReturnType<typeof setTimeout>),
  };
  function handle(s: (typeof scripts)[number]) {
    return {
      addEventListener: (type: "load" | "error", fn: () => void) => {
        (s.listeners[type] ??= []).push(fn);
      },
      remove: () => {
        s.removed = true;
      },
    };
  }
  const fire = (type: "load" | "error") => {
    for (const s of scripts.filter((x) => !x.removed)) for (const fn of s.listeners[type] ?? []) fn();
  };
  return { env, scripts, state, fire };
}

const factory: TossPaymentsFactory = () => ({ payment: () => ({ requestBillingAuth: async () => undefined }) });

afterEach(() => {
  vi.useRealTimers();
});

describe("토스 SDK 로더", () => {
  it("동시에 여러 번 불러도 스크립트는 한 번만 넣고, 로드되면 window.TossPayments를 준다", async () => {
    const { env, scripts, state, fire } = fakeEnv();
    const load = createTossSdkLoader(env);

    const a = load();
    const b = load();
    expect(scripts).toHaveLength(1);
    expect(scripts[0].src).toBe(TOSS_SDK_URL);
    state.factory = factory;
    fire("load");

    await expect(a).resolves.toBe(factory);
    await expect(b).resolves.toBe(factory);
    // 준비된 뒤에는 스크립트를 다시 넣지 않는다
    await expect(load()).resolves.toBe(factory);
    expect(scripts).toHaveLength(1);
  });

  it("이미 문서에 같은 스크립트가 있으면 새로 넣지 않고 그 스크립트를 기다린다", async () => {
    const { env, scripts, state, fire } = fakeEnv();
    env.insertScript(TOSS_SDK_URL);
    const load = createTossSdkLoader(env);

    const p = load();
    expect(scripts).toHaveLength(1);
    state.factory = factory;
    fire("load");
    await expect(p).resolves.toBe(factory);
  });

  it("불러오지 못하면 load로 거부하고, 실패한 스크립트를 걷어 내 다음 시도에서 다시 넣는다", async () => {
    const { env, scripts, state, fire } = fakeEnv();
    const load = createTossSdkLoader(env);

    const first = load();
    fire("error");
    await expect(first).rejects.toMatchObject({ name: "TossSdkError", reason: "load" });
    expect(scripts[0].removed).toBe(true);

    const second = load();
    expect(scripts).toHaveLength(2);
    state.factory = factory;
    fire("load");
    await expect(second).resolves.toBe(factory);
  });

  it("받았는데 전역이 없으면 missing으로 거부", async () => {
    const { env, fire } = fakeEnv();
    const load = createTossSdkLoader(env);
    const p = load();
    fire("load");
    await expect(p).rejects.toMatchObject({ reason: "missing" });
  });

  it("시간 안에 준비되지 않으면 timeout으로 거부하고, 늦은 load는 무시한다", async () => {
    vi.useFakeTimers();
    const { env, scripts, state, fire } = fakeEnv();
    const load = createTossSdkLoader(env, 15_000);

    const p = load();
    const settled = p.catch((e: unknown) => e);
    vi.advanceTimersByTime(14_999);
    expect(scripts[0].removed).toBe(false);
    vi.advanceTimersByTime(1);
    const err = await settled;
    expect(err).toBeInstanceOf(TossSdkError);
    expect((err as TossSdkError).reason).toBe("timeout");
    expect(scripts[0].removed).toBe(true);

    // 늦게 도착한 load는 이미 끝난 약속을 바꾸지 않는다
    state.factory = factory;
    fire("load");
    await expect(load()).resolves.toBe(factory);
  });

  it("브라우저가 아니면(서버 렌더) unavailable로 거부", async () => {
    await expect(loadTossPayments()).rejects.toMatchObject({ reason: "unavailable" });
  });
});
