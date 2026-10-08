import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

// 프록시 파이프라인 중 관리자 경로 판정만 본다 — intl·세션 갱신·CSP는 대역
vi.mock("next-intl/middleware", () => ({ default: () => () => NextResponse.next() }));
vi.mock("../src/lib/supabase/middleware", () => ({ refreshSession: async () => [], applyRefreshedCookies: () => undefined }));
vi.mock("../src/lib/security/csp", () => ({ attachCspToRequest: () => "default-src 'self'" }));

import { proxy } from "../src/proxy";

const rewriteOf = (res: Response) => res.headers.get("x-middleware-rewrite");
const req = (path: string) => new NextRequest(new URL(path, "https://www.a11ychk.com"));

afterEach(() => {
  delete process.env.ADMIN_PATH_SLUG;
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
