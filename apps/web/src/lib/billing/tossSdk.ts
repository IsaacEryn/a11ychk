/**
 * 토스페이먼츠 결제창 SDK(v2) 로더 — 브라우저에서만 부른다. "use client" 모듈이 아니라 클라이언트 컴포넌트가 가져다 쓴다.
 *
 * npm 의존성 대신 공식 스크립트를 처음 쓸 때 한 번만 넣는다(동시에 불러도 같은 약속을 돌려준다). CSP는 nonce +
 * strict-dynamic이라, nonce가 있는 스크립트(Next 청크)가 만든 스크립트는 nonce 없이도 실행된다. strict-dynamic을
 * 모르는 구형 브라우저용으로 script-src에 js.tosspayments.com을 함께 연다(lib/security/csp.ts, 결제 모드일 때만).
 *
 * SRI(integrity)는 붙이지 않는다 — 토스가 버전 없는 주소(/v2/standard)의 내용을 제자리에서 갱신하고 해시를 공개하지 않아,
 * 붙이면 토스가 갱신하는 날 결제창이 깨진다. 대신 CSP가 출처를 제한하고, 금액·빌링키 발급·결제 승인은 모두 서버가
 * 시크릿 키로 확정한다(이 스크립트가 바뀌어도 금액을 바꿀 수 없다).
 *
 * 불러오지 못하면(네트워크·차단) 거부하고, 15초 안에 준비되지 않으면 시간 초과로 거부한다. 실패한 스크립트는 걷어 내
 * 다음 시도에서 다시 넣는다.
 */

export const TOSS_SDK_URL = "https://js.tosspayments.com/v2/standard";
export const TOSS_SDK_TIMEOUT_MS = 15_000;

export interface TossBillingAuthRequest {
  method: "CARD";
  successUrl: string;
  failUrl: string;
  customerEmail?: string;
  customerName?: string;
}

export type TossPaymentsFactory = (clientKey: string) => {
  payment(opts: { customerKey: string }): {
    requestBillingAuth(opts: TossBillingAuthRequest): Promise<void>;
  };
};

/** unavailable: 브라우저가 아님 / load: 스크립트를 받지 못함 / timeout: 시간 안에 준비되지 않음 / missing: 받았는데 전역이 없음 */
export class TossSdkError extends Error {
  constructor(public readonly reason: "unavailable" | "load" | "timeout" | "missing") {
    super(`toss sdk ${reason}`);
    this.name = "TossSdkError";
  }
}

interface ScriptLike {
  addEventListener(type: "load" | "error", listener: () => void): void;
  remove(): void;
}

/** 로더가 쓰는 브라우저 기능 — 테스트는 가짜를 넣는다 */
export interface TossSdkEnv {
  getFactory(): TossPaymentsFactory | undefined;
  /** 이미 넣은 같은 주소의 스크립트(모듈이 다시 평가된 경우 등) */
  findScript(src: string): ScriptLike | null;
  /** 스크립트를 만들어 문서에 넣는다 */
  insertScript(src: string): ScriptLike;
  setTimer(fn: () => void, ms: number): unknown;
  clearTimer(id: unknown): void;
}

export function createTossSdkLoader(env: TossSdkEnv, timeoutMs = TOSS_SDK_TIMEOUT_MS): () => Promise<TossPaymentsFactory> {
  let inflight: Promise<TossPaymentsFactory> | null = null;

  return function load() {
    const ready = env.getFactory();
    if (ready) return Promise.resolve(ready);
    if (inflight) return inflight;

    inflight = new Promise<TossPaymentsFactory>((resolve, reject) => {
      const script = env.findScript(TOSS_SDK_URL) ?? env.insertScript(TOSS_SDK_URL);
      let settled = false;
      let timer: unknown = null;
      const finish = (error: TossSdkError | null) => {
        if (settled) return;
        settled = true;
        env.clearTimer(timer);
        const factory = env.getFactory();
        if (!error && factory) {
          resolve(factory);
          return;
        }
        // 다음 시도에서 새로 넣게 걷어 낸다
        script.remove();
        inflight = null;
        reject(error ?? new TossSdkError("missing"));
      };
      timer = env.setTimer(() => finish(new TossSdkError("timeout")), timeoutMs);
      script.addEventListener("load", () => finish(null));
      script.addEventListener("error", () => finish(new TossSdkError("load")));
    });
    return inflight;
  };
}

function browserEnv(): TossSdkEnv {
  return {
    getFactory: () => (window as unknown as { TossPayments?: TossPaymentsFactory }).TossPayments,
    findScript: (src) => document.querySelector<HTMLScriptElement>(`script[src="${src}"]`),
    insertScript: (src) => {
      const script = document.createElement("script");
      script.src = src;
      script.async = true;
      document.head.appendChild(script);
      return script;
    },
    setTimer: (fn, ms) => window.setTimeout(fn, ms),
    clearTimer: (id) => window.clearTimeout(id as number),
  };
}

let browserLoader: (() => Promise<TossPaymentsFactory>) | null = null;

/** window.TossPayments — 처음 부를 때 스크립트를 한 번 넣는다 */
export function loadTossPayments(): Promise<TossPaymentsFactory> {
  if (typeof window === "undefined" || typeof document === "undefined") return Promise.reject(new TossSdkError("unavailable"));
  browserLoader ??= createTossSdkLoader(browserEnv());
  return browserLoader();
}
