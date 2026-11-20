import { describe, expect, it } from "vitest";
import { buildAlertEmail, normalizeErrorMessage, reportRequestError } from "@/lib/errorReport";

const STATIC_TO_DYNAMIC = (path: string) =>
  `Page changed from static to dynamic at runtime ${path}, reason: headers\nsee more here https://nextjs.org/docs/messages/app-static-to-dynamic-error`;

describe("normalizeErrorMessage — 메시지에서 요청 경로를 뗀다", () => {
  it("경로만 다른 같은 오류는 같은 메시지가 된다", () => {
    const a = normalizeErrorMessage(STATIC_TO_DYNAMIC("/apple-touch-icon.png"), "/apple-touch-icon.png");
    const b = normalizeErrorMessage(STATIC_TO_DYNAMIC("/sftp-config.json"), "/sftp-config.json");
    expect(a).toBe(b);
    expect(a).toContain("at runtime <path>, reason: headers");
  });

  it("요청 경로의 검색어는 떼고 맞춘다", () => {
    expect(normalizeErrorMessage(STATIC_TO_DYNAMIC("/foo.png"), "/foo.png?x=1")).toContain("at runtime <path>,");
  });

  it("검색어까지 메시지에 들어 있으면 함께 뗀다", () => {
    expect(normalizeErrorMessage("failed to render /foo.png?x=1 twice", "/foo.png?x=1")).toBe("failed to render <path> twice");
  });

  it("퍼센트 인코딩된 요청 경로가 메시지에는 풀려 있어도 뗀다", () => {
    expect(normalizeErrorMessage(STATIC_TO_DYNAMIC("/한글.png"), "/%ED%95%9C%EA%B8%80.png")).toContain("at runtime <path>,");
  });

  it("Next처럼 세그먼트마다 푼 경로도 뗀다 — decodeURI가 남겨 두는 @ : , & = + 같은 글자", () => {
    expect(normalizeErrorMessage(STATIC_TO_DYNAMIC("/ko/a@b"), "/ko/a%40b")).toContain("at runtime <path>,");
    expect(normalizeErrorMessage(STATIC_TO_DYNAMIC("/ko/a&b=c+d"), "/ko/a%26b%3Dc%2Bd")).toContain("at runtime <path>,");
  });

  it("문장 끝의 마침표 앞 경로는 뗀다", () => {
    expect(normalizeErrorMessage("Error at /ko/x.", "/ko/x")).toBe("Error at <path>.");
    expect(normalizeErrorMessage("Error at /ko/x. Try again", "/ko/x")).toBe("Error at <path>. Try again");
  });

  it("마침표 뒤로 이름이 이어지면 다른 경로다", () => {
    expect(normalizeErrorMessage("cannot load /ko/x.png", "/ko/x")).toBe("cannot load /ko/x.png");
  });

  it("아주 긴 경로에도 던지지 않는다", () => {
    const path = `/${"a".repeat(40_000)}`;
    expect(() => normalizeErrorMessage(`boom at ${path}`, path)).not.toThrow();
  });

  it("루트 경로는 건드리지 않는다 — 모든 슬래시가 바뀐다", () => {
    const message = "fetch https://example.com/a/b failed";
    expect(normalizeErrorMessage(message, "/")).toBe(message);
  });

  it("더 긴 경로의 앞부분이나 뒷부분은 떼지 않는다", () => {
    expect(normalizeErrorMessage("cannot load /ko/about", "/ko")).toBe("cannot load /ko/about");
    expect(normalizeErrorMessage("cannot load /ko/about", "/about")).toBe("cannot load /ko/about");
  });

  it("경로가 없는 메시지는 그대로다", () => {
    expect(normalizeErrorMessage("TypeError: x is not a function", "/ko/scan")).toBe("TypeError: x is not a function");
  });

  it("메시지에 정규식 특수문자가 든 경로가 있어도 안전하게 뗀다", () => {
    expect(normalizeErrorMessage("bad route /a(b)+c*", "/a(b)+c*")).toBe("bad route <path>");
  });
});

describe("buildAlertEmail — 알림 메일", () => {
  const base = {
    message: "Page changed from static to dynamic at runtime <path>, reason: headers\nsee more here …",
    method: "GET",
    path: "/apple-touch-icon.png",
    logsUrl: "https://www.a11ychk.com/ko/admin/logs",
  };

  it("제목은 한 줄이다", () => {
    const { subject } = buildAlertEmail(base);
    expect(subject).not.toMatch(/[\r\n]/);
    expect(subject.startsWith("[A11y Check] 새 서버 오류: Page changed from static to dynamic")).toBe(true);
  });

  it("라우트·user-agent·배포 커밋을 본문에 싣는다", () => {
    const { html } = buildAlertEmail({
      ...base,
      routePath: "/[locale]",
      routeType: "render",
      userAgent: "Mozilla/5.0 (iPhone)",
      commit: "2ac55bfc83d1cb7bffaa2c238be024245a149c0d",
      deployEnv: "production",
      digest: "1234567890",
    });
    expect(html).toContain("/[locale]");
    expect(html).toContain("render");
    expect(html).toContain("Mozilla/5.0 (iPhone)");
    expect(html).toContain("2ac55bf");
    expect(html).not.toContain("2ac55bfc83d1cb7bffaa2c238be024245a149c0d");
    expect(html).toContain("production");
    expect(html).toContain("1234567890");
  });

  it("요청에서 온 값은 HTML로 해석되지 않게 이스케이프한다", () => {
    const { html } = buildAlertEmail({
      ...base,
      path: '/<img src=x onerror="alert(1)">',
      userAgent: "<script>alert(1)</script>",
      message: "boom <b>bold</b> & more",
    });
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<img src=x");
    expect(html).not.toContain("<b>bold</b>");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).toContain("&amp; more");
  });

  it("없는 정보는 줄을 만들지 않는다", () => {
    const { html } = buildAlertEmail(base);
    expect(html).not.toContain("User-Agent");
    expect(html).not.toContain("undefined");
  });
});

/** app_errors와 Resend를 흉내 내는 fetch — 조회는 저장된 메시지로 답한다 */
function fakeBackend(opts: { lookupStatus?: number; insertStatus?: number; emailStatus?: number; reject?: boolean } = {}) {
  const rows: Array<Record<string, unknown>> = [];
  const emails: Array<{ subject: string; html: string }> = [];
  const calls: string[] = [];
  const fetchImpl = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    calls.push(`${init?.method ?? "GET"} ${url.split("?")[0]}`);
    if (opts.reject) throw new Error("network down");
    if (url.startsWith("https://api.resend.com/")) {
      if ((opts.emailStatus ?? 200) < 300) emails.push(JSON.parse(String(init?.body)));
      return new Response("{}", { status: opts.emailStatus ?? 200 });
    }
    if ((init?.method ?? "GET") === "POST") {
      if ((opts.insertStatus ?? 201) < 300) rows.push(JSON.parse(String(init?.body)));
      return new Response(null, { status: opts.insertStatus ?? 201 });
    }
    if ((opts.lookupStatus ?? 200) >= 300) return new Response("{}", { status: opts.lookupStatus });
    const wanted = new URL(url).searchParams.get("message")?.replace(/^eq\./, "");
    return new Response(JSON.stringify(rows.filter((r) => r.message === wanted).slice(0, 1)), { status: 200 });
  };
  return { rows, emails, calls, fetchImpl: fetchImpl as typeof fetch };
}

const ENV = {
  NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "service-key",
  ADMIN_ALERT_EMAIL: "admin@example.com",
  RESEND_API_KEY: "resend-key",
  NEXT_PUBLIC_SITE_URL: "https://www.a11ychk.com",
};
const request = (path: string) => ({ path, method: "GET", headers: { "user-agent": "TestBot/1.0" } });
const context = { routerKind: "App Router", routePath: "/[locale]", routeType: "render", revalidateReason: undefined } as const;

describe("reportRequestError — 기록과 알림", () => {
  it("경로만 다른 같은 오류는 행은 둘, 메일은 한 통이다", async () => {
    const backend = fakeBackend();
    const deps = { fetch: backend.fetchImpl, env: ENV };
    await reportRequestError(new Error(STATIC_TO_DYNAMIC("/apple-touch-icon.png")), request("/apple-touch-icon.png"), context, deps);
    await reportRequestError(new Error(STATIC_TO_DYNAMIC("/sftp-config.json")), request("/sftp-config.json"), context, deps);
    expect(backend.rows).toHaveLength(2);
    expect(backend.emails).toHaveLength(1);
    // 메시지는 경로를 뗀 것, 경로는 path 컬럼에 그대로
    expect(backend.rows[0].message).toBe(backend.rows[1].message);
    expect(backend.rows.map((r) => r.path)).toEqual(["/apple-touch-icon.png", "/sftp-config.json"]);
    expect(backend.emails[0].html).toContain("/apple-touch-icon.png");
    expect(backend.emails[0].html).toContain("TestBot/1.0");
    expect(backend.emails[0].html).toContain("/[locale]");
  });

  it("서로 다른 오류는 각각 알린다", async () => {
    const backend = fakeBackend();
    const deps = { fetch: backend.fetchImpl, env: ENV };
    await reportRequestError(new Error("TypeError: a is not a function"), request("/ko/scan"), context, deps);
    await reportRequestError(new Error("relation does not exist"), request("/ko/scan"), context, deps);
    expect(backend.emails).toHaveLength(2);
  });

  it("봇의 서버 액션 오호출은 기록도 알림도 하지 않는다", async () => {
    const backend = fakeBackend();
    await reportRequestError(new Error("Failed to find Server Action \"x\"."), request("/ko"), context, { fetch: backend.fetchImpl, env: ENV });
    expect(backend.calls).toEqual([]);
  });

  it("Supabase 설정이 없으면 아무것도 하지 않는다", async () => {
    const backend = fakeBackend();
    await reportRequestError(new Error("boom"), request("/ko"), context, { fetch: backend.fetchImpl, env: {} });
    expect(backend.calls).toEqual([]);
  });

  it("메일 설정이 없으면 기록만 한다", async () => {
    const backend = fakeBackend();
    const env = { NEXT_PUBLIC_SUPABASE_URL: ENV.NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY: ENV.SUPABASE_SERVICE_ROLE_KEY };
    await reportRequestError(new Error("boom"), request("/ko"), context, { fetch: backend.fetchImpl, env });
    expect(backend.rows).toHaveLength(1);
    expect(backend.emails).toHaveLength(0);
  });

  it("메일 발송이 실패하면 그 사실을 기록으로 남긴다", async () => {
    const backend = fakeBackend({ emailStatus: 429 });
    await reportRequestError(new Error("boom"), request("/ko/scan"), context, { fetch: backend.fetchImpl, env: ENV });
    expect(backend.rows).toHaveLength(2);
    expect(backend.rows[1]).toMatchObject({ method: "internal", path: "instrumentation.alert" });
    expect(String(backend.rows[1].message)).toContain("429");
  });

  it("중복 조회가 실패하면 기록은 하되 알리지 않는다", async () => {
    const backend = fakeBackend({ lookupStatus: 500 });
    await reportRequestError(new Error("boom"), request("/ko/scan"), context, { fetch: backend.fetchImpl, env: ENV });
    expect(backend.rows).toHaveLength(1);
    expect(backend.emails).toHaveLength(0);
  });

  it("중복은 최근 24시간 안에서만 본다", async () => {
    const urls: string[] = [];
    const backend = fakeBackend();
    const fetchImpl = ((input: RequestInfo | URL, init?: RequestInit) => {
      urls.push(String(input));
      return backend.fetchImpl(input, init);
    }) as typeof fetch;
    const before = Date.now();
    await reportRequestError(new Error("boom"), request("/ko/scan"), context, { fetch: fetchImpl, env: ENV });
    const since = Date.parse((new URL(urls[0]).searchParams.get("created_at") ?? "").replace(/^gt\./, ""));
    expect(before - since).toBeGreaterThanOrEqual(24 * 3600_000 - 5_000);
    expect(before - since).toBeLessThanOrEqual(24 * 3600_000 + 5_000);
  });

  it("경로가 아주 길어도 기록은 남는다", async () => {
    const backend = fakeBackend();
    const path = `/${"a".repeat(40_000)}`;
    await reportRequestError(new Error(`boom at ${path}`), request(path), context, { fetch: backend.fetchImpl, env: ENV });
    expect(backend.rows).toHaveLength(1);
    expect(String(backend.rows[0].path)).toHaveLength(500);
  });

  it("네트워크가 끊겨도 던지지 않는다 — 원래 요청 처리에 영향을 주면 안 된다", async () => {
    const backend = fakeBackend({ reject: true });
    await expect(
      reportRequestError(new Error("boom"), request("/ko/scan"), context, { fetch: backend.fetchImpl, env: ENV }),
    ).resolves.toBeUndefined();
  });

  it("요청마다 시간 제한을 건다 — 저장소나 메일이 느려도 훅이 오래 붙잡히지 않는다", async () => {
    const signals: Array<AbortSignal | null | undefined> = [];
    const backend = fakeBackend();
    const fetchImpl = ((input: RequestInfo | URL, init?: RequestInit) => {
      signals.push(init?.signal);
      return backend.fetchImpl(input, init);
    }) as typeof fetch;
    await reportRequestError(new Error("boom"), request("/ko/scan"), context, { fetch: fetchImpl, env: ENV });
    expect(signals).toHaveLength(3);
    expect(signals.every((s) => s instanceof AbortSignal)).toBe(true);
  });
});
