import { afterEach, describe, expect, it } from "vitest";
import {
  adminBase,
  adminBasePath,
  getAdminSlug,
  isExternalAdminPath,
  isInternalAdminPath,
  slugToInternal,
} from "../src/lib/adminSlug";
import { isIdleExpired, signAdminTs, verifyAdminTs } from "../src/lib/adminIdleCookie";

afterEach(() => {
  delete process.env.ADMIN_PATH_SLUG;
  delete process.env.ADMIN_IDLE_MINUTES;
});

describe("adminSlug — 경로 매핑", () => {
  it("env 미설정이면 기존 /admin 경로", () => {
    expect(getAdminSlug()).toBeNull();
    expect(adminBase()).toBe("/admin");
    expect(adminBasePath("ko")).toBe("/ko/admin");
    expect(isExternalAdminPath("/ko/admin/users")).toBe(true);
  });

  it("유효한 슬러그 설정 시 기준 경로가 바뀐다", () => {
    process.env.ADMIN_PATH_SLUG = "console-x7k2";
    expect(adminBase()).toBe("/console-x7k2");
    expect(adminBasePath("en")).toBe("/en/console-x7k2");
    expect(isExternalAdminPath("/ko/console-x7k2/users")).toBe(true);
    expect(isExternalAdminPath("/ko/admin/users")).toBe(false);
  });

  it("잘못된 형식·예약어는 throw (점 포함 = matcher 미통과 방지)", () => {
    for (const bad of ["Admin", "a.b.c", "ab", "admin", "api", "ko", "-lead", "한글슬러그"]) {
      process.env.ADMIN_PATH_SLUG = bad;
      expect(() => getAdminSlug(), bad).toThrow();
    }
  });

  it("slugToInternal — 루트·하위·쿼리 없는 pathname만 치환, 비매치는 null", () => {
    expect(slugToInternal("/ko/console-x7k2", "console-x7k2")).toBe("/ko/admin");
    expect(slugToInternal("/en/console-x7k2/users", "console-x7k2")).toBe("/en/admin/users");
    expect(slugToInternal("/ko/console-x7k2extra", "console-x7k2")).toBeNull();
    expect(slugToInternal("/ko/other", "console-x7k2")).toBeNull();
    expect(slugToInternal("/console-x7k2", "console-x7k2")).toBeNull(); // 무접두는 intl redirect가 처리
  });

  it("isInternalAdminPath — /admin 계열만 참", () => {
    for (const p of ["/admin", "/ko/admin", "/en/admin/users", "/admin/x"]) {
      expect(isInternalAdminPath(p), p).toBe(true);
    }
    for (const p of ["/ko/administrator", "/ko/dashboard", "/adminx"]) {
      expect(isInternalAdminPath(p), p).toBe(false);
    }
  });
});

describe("adminIdleCookie — HMAC 서명 왕복·만료", () => {
  it("서명 → 검증 왕복", async () => {
    const v = await signAdminTs(1_700_000_000_000);
    expect(await verifyAdminTs(v)).toBe(1_700_000_000_000);
  });

  it("변조·형식 오류는 null", async () => {
    const v = await signAdminTs();
    expect(await verifyAdminTs(undefined)).toBeNull();
    expect(await verifyAdminTs("")).toBeNull();
    expect(await verifyAdminTs("123")).toBeNull();
    expect(await verifyAdminTs(`${Number(v.split(".")[0]) + 1}.${v.split(".")[1]}`)).toBeNull(); // ts 변조
    expect(await verifyAdminTs(`${v.split(".")[0]}.${"0".repeat(64)}`)).toBeNull(); // 서명 변조
    expect(await verifyAdminTs(`${v.split(".")[0]}.zz`)).toBeNull(); // hex 아님
  });

  it("무활동 만료 판정 — 기본 20분, env로 조정", () => {
    const t0 = 1_700_000_000_000;
    expect(isIdleExpired(t0, t0 + 19 * 60_000)).toBe(false);
    expect(isIdleExpired(t0, t0 + 21 * 60_000)).toBe(true);
    process.env.ADMIN_IDLE_MINUTES = "1";
    expect(isIdleExpired(t0, t0 + 61_000)).toBe(true);
    expect(isIdleExpired(t0, t0 + 59_000)).toBe(false);
  });
});
