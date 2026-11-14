import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";
import { KWCAG_SLUGS } from "@a11ychk/core/catalog";
import { STATIC_PAGE_PATHS, isStaticPagePath, staticPageMetaPolicy } from "@/lib/security/cspPolicy.mjs";

const LOCALES = ["ko", "en"];
const sha = (s: string) => `'sha256-${createHash("sha256").update(s, "utf8").digest("base64")}'`;
const directive = (csp: string, name: string) => csp.split("; ").find((d) => d.startsWith(`${name} `)) ?? "";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("isStaticPagePath — 프록시가 nonce 없이 보내는 경로", () => {
  const guideSlugs = new Set(KWCAG_SLUGS);

  it("목록의 경로는 로케일마다 정적", () => {
    for (const locale of LOCALES) {
      for (const p of STATIC_PAGE_PATHS) expect(isStaticPagePath(`/${locale}${p}`, { locales: LOCALES, guideSlugs })).toBe(true);
    }
    expect(isStaticPagePath("/ko/guide/alternative-text", { locales: LOCALES, guideSlugs })).toBe(true);
  });

  it("없는 가이드 슬러그는 런타임에 404를 렌더하므로 동적 — 슬러그 집합을 넘기지 않으면 모양만 본다(빌드 어댑터)", () => {
    expect(isStaticPagePath("/ko/guide/nope", { locales: LOCALES, guideSlugs })).toBe(false);
    expect(isStaticPagePath("/ko/guide/nope", { locales: LOCALES })).toBe(true);
    expect(isStaticPagePath("/ko/guide/alternative-text/x", { locales: LOCALES })).toBe(false);
  });

  it("로그인·DB가 필요한 페이지, 모르는 로케일, 끝 슬래시는 동적", () => {
    for (const p of ["/ko/dashboard", "/ko/login", "/ko/directory", "/ko/scans/1", "/fr/about", "/ko/", "/", "/about"]) {
      expect(isStaticPagePath(p, { locales: LOCALES })).toBe(false);
    }
  });
});

describe("정적 페이지 meta 정책", () => {
  it("해시와 'self'·외부 출처만 — unsafe-inline·strict-dynamic 없음", () => {
    const policy = staticPageMetaPolicy(["'sha256-abc'"], { NEXT_PUBLIC_GTM_ID: "GTM-X" });
    expect(policy).toBe("script-src 'self' 'sha256-abc' https://challenges.cloudflare.com https://www.googletagmanager.com");
  });
});

async function loadCsp(env: Record<string, string>) {
  vi.resetModules();
  // 허용 출처를 바꾸는 변수는 셸 환경(.env·CI)과 무관하게 비워 두고 시작한다
  for (const [k, v] of Object.entries({ NEXT_PUBLIC_GTM_ID: "", BILLING_MODE: "", ...env })) vi.stubEnv(k, v);
  const csp = await import("@/lib/security/csp");
  const { bootScript, gtmBootstrapScript } = await import("@/lib/inlineScripts");
  return { ...csp, bootScript, gtmBootstrapScript };
}

describe("CSP 헤더 — 동적 페이지와 정적 페이지", () => {
  it("동적 페이지: nonce + strict-dynamic, 레이아웃의 nonce 없는 인라인 스크립트는 해시로 허용", async () => {
    const { attachCspToRequest, bootScript, gtmBootstrapScript } = await loadCsp({ NEXT_PUBLIC_GTM_ID: "GTM-TEST1" });
    const csp = attachCspToRequest({ headers: new Headers() } as unknown as NextRequest);
    const scriptSrc = directive(csp, "script-src");
    expect(scriptSrc).toMatch(/'nonce-[^']+' 'strict-dynamic'/);
    expect(scriptSrc).toContain(sha(bootScript));
    expect(scriptSrc).toContain(sha(gtmBootstrapScript("GTM-TEST1")));
    expect(scriptSrc).toContain("https://www.googletagmanager.com");
  });

  it("GTM ID가 형식에 맞지 않으면 스니펫도 해시도 없다", async () => {
    const { attachCspToRequest, bootScript } = await loadCsp({ NEXT_PUBLIC_GTM_ID: "GTM-x');alert(1);('" });
    const scriptSrc = directive(attachCspToRequest({ headers: new Headers() } as unknown as NextRequest), "script-src");
    expect(scriptSrc.match(/'sha256-/g)).toHaveLength(1);
    expect(scriptSrc).toContain(sha(bootScript));
  });

  it("정적 페이지 헤더: 바깥 한계만 — nonce·해시·strict-dynamic이 하나라도 있으면 meta의 해시 정책과 겹쳐 RSC 스크립트가 막힌다", async () => {
    const { STATIC_PAGE_CSP } = await loadCsp({});
    const scriptSrc = directive(STATIC_PAGE_CSP, "script-src");
    expect(scriptSrc).toBe("script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com");
    // 나머지 지시어(특히 meta로는 줄 수 없는 frame-ancestors)는 헤더가 그대로 맡는다
    expect(directive(STATIC_PAGE_CSP, "frame-ancestors")).toBe("frame-ancestors 'none'");
    expect(directive(STATIC_PAGE_CSP, "object-src")).toBe("object-src 'none'");
  });

  it("isStaticPage는 프로덕션에서만 켜진다 — 개발 서버는 모든 페이지를 요청마다 렌더한다", async () => {
    vi.stubEnv("NODE_ENV", "development");
    expect((await loadCsp({})).isStaticPage("/ko/guide")).toBe(false);
    vi.stubEnv("NODE_ENV", "production");
    const { isStaticPage } = await loadCsp({});
    expect(isStaticPage("/ko/guide")).toBe(true);
    expect(isStaticPage("/ko/guide/alternative-text")).toBe(true);
    expect(isStaticPage("/ko/guide/nope")).toBe(false);
  });

  it("isUnknownGuidePath — 로케일 아래 한 단계 가이드 경로 중 슬러그가 목록에 없는 것만", async () => {
    const { isUnknownGuidePath } = await loadCsp({});
    expect(isUnknownGuidePath("/ko/guide/nope")).toBe(true);
    expect(isUnknownGuidePath("/en/guide/%EA%B0%80")).toBe(true);
    for (const p of ["/ko/guide/alternative-text", "/ko/guide", "/ko/guide/nope/x", "/fr/guide/nope", "/guide/nope"]) {
      expect(isUnknownGuidePath(p)).toBe(false);
    }
  });
});

describe("boot 스크립트 — 첫 페인트 전 테마·로그인 힌트", () => {
  async function run(cookie: string, theme: string | null) {
    const { bootScript } = await loadCsp({});
    const attrs: Record<string, string> = {};
    const document = { cookie, documentElement: { setAttribute: (k: string, v: string) => (attrs[k] = v) } };
    const localStorage = { getItem: () => theme };
    new Function("document", "localStorage", bootScript)(document, localStorage);
    return attrs;
  }

  it("인증 쿠키가 있으면 data-auth=in, 저장된 테마 적용", async () => {
    expect(await run("NEXT_LOCALE=ko; sb-abc-auth-token.0=x", "dark")).toEqual({ "data-theme": "dark", "data-auth": "in" });
  });

  it("쿠키가 없거나 로그인 진행 중(code-verifier)만 있으면 out, 모르는 테마 값은 무시", async () => {
    expect(await run("", "neon")).toEqual({ "data-auth": "out" });
    expect(await run("sb-abc-auth-token-code-verifier=v", null)).toEqual({ "data-auth": "out" });
  });
});
