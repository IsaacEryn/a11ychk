/**
 * Turnstile 서버 검증의 설정 누락 처리.
 *
 * 이 검사가 있는 이유: 예전에는 사이트키가 없으면 배포본에서도 조용히 통과시켰다.
 * 그 상태는 위젯도 안 뜨고 siteverify도 안 불리는데 요청은 전부 통과하므로 화면상
 * 아무 증상이 없다 — 환경변수 하나가 빠진 것을 알아챌 방법이 없었다.
 * 설정 누락이 배포본에서 "통과"로 해석되는 일이 없도록 고정한다.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { verifyTurnstileToken } from "@/lib/turnstile";

function setEnv(env: Record<string, string | undefined>) {
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) vi.stubEnv(k, "");
    else vi.stubEnv(k, v);
  }
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("verifyTurnstileToken — 설정 누락", () => {
  it("배포본에서 키가 없으면 통과시키지 않는다", async () => {
    setEnv({
      NODE_ENV: "production",
      NEXT_PUBLIC_TURNSTILE_SITE_KEY: undefined,
      TURNSTILE_SECRET_KEY: undefined,
      TURNSTILE_DISABLED: undefined,
    });
    expect(await verifyTurnstileToken("any-token")).toBe("misconfigured");
  });

  it("사이트키만 있고 시크릿이 없어도 설정 오류", async () => {
    setEnv({
      NODE_ENV: "production",
      NEXT_PUBLIC_TURNSTILE_SITE_KEY: "0x4AAAAAAsite",
      TURNSTILE_SECRET_KEY: undefined,
    });
    expect(await verifyTurnstileToken("any-token")).toBe("misconfigured");
  });

  it("시크릿만 있고 사이트키가 없어도 설정 오류 — 위젯이 없어 토큰을 만들 수 없다", async () => {
    setEnv({
      NODE_ENV: "production",
      NEXT_PUBLIC_TURNSTILE_SITE_KEY: undefined,
      TURNSTILE_SECRET_KEY: "0x4AAAAAAsecret",
    });
    expect(await verifyTurnstileToken("any-token")).toBe("misconfigured");
  });

  it("개발 환경에서는 키 없이 통과 — 로컬 개발 편의", async () => {
    setEnv({
      NODE_ENV: "development",
      NEXT_PUBLIC_TURNSTILE_SITE_KEY: undefined,
      TURNSTILE_SECRET_KEY: undefined,
    });
    expect(await verifyTurnstileToken(undefined)).toBe("ok");
  });

  it("명시적으로 껐다고 선언하면 배포본에서도 통과", async () => {
    setEnv({
      NODE_ENV: "production",
      NEXT_PUBLIC_TURNSTILE_SITE_KEY: undefined,
      TURNSTILE_SECRET_KEY: undefined,
      TURNSTILE_DISABLED: "1",
    });
    expect(await verifyTurnstileToken(undefined)).toBe("ok");
  });
});

describe("verifyTurnstileToken — 키가 갖춰진 뒤", () => {
  const configured = {
    NODE_ENV: "production",
    NEXT_PUBLIC_TURNSTILE_SITE_KEY: "0x4AAAAAAsite",
    TURNSTILE_SECRET_KEY: "0x4AAAAAAsecret",
  };

  it("토큰이 없으면 실패", async () => {
    setEnv(configured);
    expect(await verifyTurnstileToken(undefined)).toBe("failed");
  });

  it("siteverify가 success면 통과", async () => {
    setEnv(configured);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ success: true }), { status: 200 })));
    expect(await verifyTurnstileToken("token")).toBe("ok");
  });

  it("siteverify가 실패를 돌려주면 차단", async () => {
    setEnv(configured);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ success: false }), { status: 200 })));
    expect(await verifyTurnstileToken("token")).toBe("failed");
  });

  it("네트워크 오류는 fail-closed", async () => {
    setEnv(configured);
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("network down"); }));
    expect(await verifyTurnstileToken("token")).toBe("failed");
  });
});
