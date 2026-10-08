import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

// 오류 기록은 service role로 app_errors에 남긴다 — 여기서는 기록 내용(코드만, 값 없음)만 본다
const m = vi.hoisted(() => ({ logAppError: vi.fn(async () => undefined) }));
vi.mock("@/lib/logs", () => ({ logAppError: m.logAppError }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ admin: true }) }));

import { getBillingFlags } from "../src/lib/appSettings";
import { resetLogThrottle, shouldLog } from "../src/lib/billing/logThrottle";
import { loadViewer, reportBillingReadError } from "../src/lib/billing/viewer";
import { canCheckout, canSeePrices } from "../src/lib/billing/visibility";

const USER = "11111111-1111-4111-8111-111111111111";

/** maybeSingle까지 이어지는 PostgREST 읽기 흉내 */
function db(result: { data: unknown; error: { code?: string; message: string } | null }): SupabaseClient {
  const chain = { select: () => chain, eq: () => chain, maybeSingle: async () => result };
  return { from: () => chain } as unknown as SupabaseClient;
}

beforeEach(() => {
  m.logAppError.mockClear();
  // 기록 간격은 모듈 상태 — 테스트마다 비워 순서와 무관하게
  resetLogThrottle();
});
afterEach(() => vi.unstubAllEnvs());

describe("loadViewer — 결제 공개 범위의 시청자 판정", () => {
  it("관리자·테스터를 판정한다", async () => {
    vi.stubEnv("BILLING_TEST_USER_IDS", USER);
    expect(await loadViewer(db({ data: { role: "admin" }, error: null }), USER)).toEqual({ isAdmin: true, isTester: true });
    expect(await loadViewer(db({ data: null, error: null }), USER)).toEqual({ isAdmin: false, isTester: true });
    expect(m.logAppError).not.toHaveBeenCalled();
  });

  it("조회 오류면 닫힌다(관리자도 테스터도 아님 — 결제 불가)·오류 코드만 기록한다", async () => {
    vi.stubEnv("BILLING_TEST_USER_IDS", USER);
    const viewer = await loadViewer(db({ data: null, error: { code: "57014", message: "statement timeout for user@example.com" } }), USER);
    expect(viewer).toEqual({ isAdmin: false, isTester: false });
    expect(canCheckout("test", { showPrices: true, checkoutOpen: true }, viewer)).toBe(false);
    expect(canCheckout("live", { showPrices: false, checkoutOpen: false }, viewer)).toBe(false);
    expect(m.logAppError).toHaveBeenCalledTimes(1);
    const message = String((m.logAppError.mock.calls[0] as unknown[])[1]);
    expect(message).toContain("57014");
    expect(message).not.toContain("user@example.com");
    expect(message).not.toContain(USER);
  });
});

describe("getBillingFlags — 결제 공개 범위 플래그", () => {
  it("행이 없으면 닫힘(기록 없음 — 0041 미적용·플래그 미설정은 정상)", async () => {
    expect(await getBillingFlags(db({ data: null, error: null }))).toEqual({ showPrices: false, checkoutOpen: false });
    expect(m.logAppError).not.toHaveBeenCalled();
  });

  it("값을 그대로 읽는다(true만 열림)", async () => {
    expect(await getBillingFlags(db({ data: { value: { showPrices: true, checkoutOpen: "yes" } }, error: null }))).toEqual({
      showPrices: true,
      checkoutOpen: false,
    });
  });

  it("조회 오류면 닫힌다(가격·결제 모두)·오류 코드만 기록한다", async () => {
    const flags = await getBillingFlags(db({ data: { value: { showPrices: true, checkoutOpen: true } }, error: { code: "08006", message: "connection failure host=db.internal" } }));
    expect(flags).toEqual({ showPrices: false, checkoutOpen: false });
    expect(canCheckout("live", flags, { isAdmin: false, isTester: false })).toBe(false);
    expect(canSeePrices("live", flags, { isAdmin: false, isTester: false })).toBe(false);
    expect(m.logAppError).toHaveBeenCalledTimes(1);
    const message = String((m.logAppError.mock.calls[0] as unknown[])[1]);
    expect(message).toContain("08006");
    expect(message).not.toContain("db.internal");
  });
});

describe("읽기 오류 기록 간격 — 같은 메시지는 프로세스당 1분에 한 번", () => {
  const T0 = 1_700_000_000_000;

  it("shouldLog: 1분 안 두 번이면 처음만, 1분이 지나면 다시", () => {
    expect(shouldLog("k", T0)).toBe(true);
    expect(shouldLog("k", T0 + 59_999)).toBe(false);
    expect(shouldLog("k", T0 + 60_000)).toBe(true);
    expect(shouldLog("k", T0 + 60_001)).toBe(false);
    // 다른 키는 따로 센다
    expect(shouldLog("other", T0 + 60_001)).toBe(true);
  });

  it("같은 읽기 오류를 1분 안에 두 번 → 한 줄, 1분 뒤 → 다시 한 줄(코드만, 값 없음)", async () => {
    await reportBillingReadError("viewer", { code: "57014" }, T0);
    await reportBillingReadError("viewer", { code: "57014" }, T0 + 30_000);
    expect(m.logAppError).toHaveBeenCalledTimes(1);

    await reportBillingReadError("viewer", { code: "57014" }, T0 + 60_000);
    expect(m.logAppError).toHaveBeenCalledTimes(2);
    for (const call of m.logAppError.mock.calls as unknown[][]) expect(String(call[1])).toBe("billing viewer read failed (57014); treated as closed");
  });

  it("다른 읽기·다른 코드는 다른 메시지라 각각 한 줄", async () => {
    await reportBillingReadError("viewer", { code: "57014" }, T0);
    await reportBillingReadError("flags", { code: "57014" }, T0);
    await reportBillingReadError("viewer", { code: "08006" }, T0);
    expect(m.logAppError).toHaveBeenCalledTimes(3);
  });

  it("렌더마다 부르는 loadViewer·getBillingFlags도 오류가 이어지는 동안 읽기마다 한 줄씩만 — 판정은 매번 닫힌다", async () => {
    vi.stubEnv("BILLING_TEST_USER_IDS", USER);
    const failing = db({ data: null, error: { code: "57014", message: "statement timeout for user@example.com" } });
    for (let i = 0; i < 3; i++) {
      expect(await loadViewer(failing, USER)).toEqual({ isAdmin: false, isTester: false });
      expect(await getBillingFlags(failing)).toEqual({ showPrices: false, checkoutOpen: false });
    }
    expect(m.logAppError).toHaveBeenCalledTimes(2);
    const text = (m.logAppError.mock.calls as unknown[][]).map((c) => String(c[1])).join("\n");
    expect(text).not.toContain("user@example.com");
    expect(text).not.toContain(USER);
  });
});
