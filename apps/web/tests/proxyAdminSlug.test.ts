import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

// 프록시 파이프라인 중 관리자 경로 판정·CSP 갈래·회원 딥링크만 본다 — intl·세션 갱신·CSP 문자열은 대역
const state = vi.hoisted(() => ({ signedIn: false, staticPage: false }));
vi.mock("next-intl/middleware", () => ({ default: () => () => NextResponse.next() }));
vi.mock("../src/lib/supabase/middleware", () => ({
  refreshSession: async () => ({ issued: [], signedIn: state.signedIn }),
  applyRefreshedCookies: () => undefined,
}));
vi.mock("../src/lib/security/csp", () => ({
  attachCspToRequest: (r: { headers: Headers }) => {
    r.headers.set("content-security-policy", "default-src 'self'");
    return "default-src 'self'";
  },
  isStaticPage: () => state.staticPage,
  STATIC_PAGE_CSP: "static-policy",
}));

import { proxy } from "../src/proxy";

const rewriteOf = (res: Response) => res.headers.get("x-middleware-rewrite");
const req = (path: string) => new NextRequest(new URL(path, "https://www.a11ychk.com"));

afterEach(() => {
  delete process.env.ADMIN_PATH_SLUG;
  state.signedIn = false;
  state.staticPage = false;
  vi.restoreAllMocks();
});

describe("proxy — 관리자 슬러그", () => {
  it("슬러그가 잘못돼도(예약어·형식 오류) 던지지 않는다 — 일반 페이지는 그대로, 관리자 경로는 슬러그·/admin 모두 닫힌다(404 경로)", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    for (const bad of ["mypage", "a.b"]) {
      process.env.ADMIN_PATH_SLUG = bad;
      const page = await proxy(req("/ko/pricing"));
      expect(rewriteOf(page)).toBeNull();
      expect(page.headers.get("content-security-policy")).toBe("default-src 'self'");
      const internal = await proxy(req("/ko/admin/users"));
      expect(rewriteOf(internal)).toContain("/ko/__404__");
    }
  });

  it("정상 슬러그는 지금과 같다 — 슬러그 경로는 내부 /admin으로, /admin 직접 접근은 404 경로로", async () => {
    process.env.ADMIN_PATH_SLUG = "console-x7k2";
    expect(rewriteOf(await proxy(req("/ko/console-x7k2/users")))).toContain("/ko/admin/users");
    expect(rewriteOf(await proxy(req("/en/admin")))).toContain("/en/__404__");
    expect(rewriteOf(await proxy(req("/ko/pricing")))).toBeNull();
  });

  it("슬러그가 없으면 /admin을 그대로 쓴다", async () => {
    expect(rewriteOf(await proxy(req("/ko/admin")))).toBeNull();
  });
});

describe("proxy — CSP 갈래", () => {
  it("정적 페이지는 nonce 정책 대신 정적 정책을 싣고, 요청 헤더에 CSP를 넣지 않는다(렌더러가 nonce를 붙이지 않게)", async () => {
    state.staticPage = true;
    const request = req("/ko/guide");
    const res = await proxy(request);
    expect(res.headers.get("content-security-policy")).toBe("static-policy");
    expect(request.headers.get("content-security-policy")).toBeNull();
  });

  it("관리자 슬러그 경로는 정적 판정과 무관하게 nonce 정책", async () => {
    process.env.ADMIN_PATH_SLUG = "console-x7k2";
    state.staticPage = true;
    const res = await proxy(req("/ko/console-x7k2"));
    expect(res.headers.get("content-security-policy")).toBe("default-src 'self'");
  });
});

describe("proxy — 홈 딥링크(?url=)", () => {
  const location = (res: Response) => res.headers.get("location");

  it("회원은 본검사 폼으로 보낸다 — utm은 보존, 다른 검색어는 버린다", async () => {
    state.signedIn = true;
    const res = await proxy(req("/ko?url=https%3A%2F%2Fexample.com&utm_source=mcp&foo=1"));
    expect(res.status).toBe(307);
    expect(location(res)).toBe("https://www.a11ychk.com/ko/scan?url=https%3A%2F%2Fexample.com%2F&utm_source=mcp");
    expect(res.headers.get("content-security-policy")).toBe("default-src 'self'");
  });

  it("비회원·다른 경로·잘못된 주소는 그대로 둔다(비회원은 맛보기 폼이 프리필)", async () => {
    expect(location(await proxy(req("/en?url=https%3A%2F%2Fexample.com")))).toBeNull();
    state.signedIn = true;
    expect(location(await proxy(req("/ko/about?url=https%3A%2F%2Fexample.com")))).toBeNull();
    expect(location(await proxy(req("/ko?url=javascript%3Aalert(1)")))).toBeNull();
    expect(location(await proxy(req("/ko")))).toBeNull();
  });
});
