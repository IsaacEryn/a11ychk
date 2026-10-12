import crypto from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Supabase Send Email 훅의 서명 검증 — 공용 검증 함수로 옮긴 뒤에도 동작이 같은지(시간 허용 범위 없음, Standard 키만)
const m = vi.hoisted(() => ({ logAppError: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));
vi.mock("@/lib/logs", () => ({ logAppError: m.logAppError }));

import { POST } from "../src/app/api/auth/send-email/route";

// 테스트 전용 가짜 키 — 실제 시크릿이 아니다
const RAW_KEY = Buffer.from("fake-supabase-hook-key-for-tests");
const SECRET = `v1,whsec_${RAW_KEY.toString("base64")}`;
const BODY = JSON.stringify({
  user: { email: "fake@example.test", user_metadata: { locale: "en" } },
  email_data: { token_hash: "fake_hash", redirect_to: "https://example.test/en/dashboard", email_action_type: "signup" },
});

function sign(key: Buffer, id: string, ts: string, body: string) {
  return crypto.createHmac("sha256", key).update(`${id}.${ts}.${body}`).digest("base64");
}

function hookRequest(opts: { body?: string; id?: string; ts?: string; signature?: string | null } = {}) {
  const body = opts.body ?? BODY;
  const id = opts.id ?? "msg_fake";
  const ts = opts.ts ?? String(Math.floor(Date.now() / 1000));
  const headers: Record<string, string> = { "content-type": "application/json", "webhook-id": id, "webhook-timestamp": ts };
  const signature = opts.signature === undefined ? `v1,${sign(RAW_KEY, id, ts, BODY)}` : opts.signature;
  if (signature !== null) headers["webhook-signature"] = signature;
  return new Request("https://example.test/api/auth/send-email", { method: "POST", headers, body });
}

const resend = vi.fn();

beforeEach(() => {
  vi.stubEnv("SEND_EMAIL_HOOK_SECRET", SECRET);
  vi.stubEnv("RESEND_API_KEY", "re_fake_key");
  vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://example.test");
  resend.mockReset();
  resend.mockImplementation(async () => new Response(JSON.stringify({ id: "fake" }), { status: 200 }));
  vi.stubGlobal("fetch", resend);
  m.logAppError.mockReset();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("Send Email 훅 서명 검증", () => {
  it("올바른 서명이면 메일을 보내고 200", async () => {
    const res = await POST(hookRequest());
    expect(res.status).toBe(200);
    expect(resend).toHaveBeenCalledOnce();
    expect(resend.mock.calls[0]![0]).toBe("https://api.resend.com/emails");
  });

  it("v1, 없는 whsec_ 시크릿도 같다", async () => {
    vi.stubEnv("SEND_EMAIL_HOOK_SECRET", `whsec_${RAW_KEY.toString("base64")}`);
    expect((await POST(hookRequest())).status).toBe(200);
  });

  it("여러 서명 중 하나만 맞아도 통과", async () => {
    const ts = String(Math.floor(Date.now() / 1000));
    const good = sign(RAW_KEY, "msg_fake", ts, BODY);
    const res = await POST(hookRequest({ ts, signature: `v1,${Buffer.from("x".repeat(32)).toString("base64")} v1,${good}` }));
    expect(res.status).toBe(200);
  });

  it("시간 허용 범위를 두지 않는다 — 오래된 타임스탬프도 서명이 맞으면 통과", async () => {
    const ts = "1000000000";
    const res = await POST(hookRequest({ ts, signature: `v1,${sign(RAW_KEY, "msg_fake", ts, BODY)}` }));
    expect(res.status).toBe(200);
  });

  it("본문을 바꾸면 401이고 메일을 보내지 않는다", async () => {
    const res = await POST(hookRequest({ body: BODY.replace("fake@example.test", "other@example.test") }));
    expect(res.status).toBe(401);
    expect(resend).not.toHaveBeenCalled();
  });

  it("서명 헤더가 없으면 401", async () => {
    const res = await POST(hookRequest({ signature: null }));
    expect(res.status).toBe(401);
    expect(resend).not.toHaveBeenCalled();
  });

  it("Polar 옛 방식(시크릿 문자열 바이트)으로 만든 서명은 받지 않는다", async () => {
    const ts = String(Math.floor(Date.now() / 1000));
    const legacy = sign(Buffer.from(SECRET.replace(/^v1,/, ""), "utf8"), "msg_fake", ts, BODY);
    const res = await POST(hookRequest({ ts, signature: `v1,${legacy}` }));
    expect(res.status).toBe(401);
  });

  it("시크릿이 없으면 500", async () => {
    vi.stubEnv("SEND_EMAIL_HOOK_SECRET", "");
    expect((await POST(hookRequest())).status).toBe(500);
  });
});
