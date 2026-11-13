import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { STATIC_PAGE_PATHS } from "@/lib/security/cspPolicy.mjs";

/**
 * 빌드 어댑터(scripts/csp-adapter.mjs) — 정적 HTML에 해시 meta를 넣는 시점이 플랫폼 어댑터보다 앞서야 배포본에 들어간다.
 * 가짜 .next 출력과 가짜 플랫폼 어댑터(HTML을 .vercel/output으로 복사)로 그 순서와 실패 조건을 확인한다.
 */

const sha = (s: string) => `'sha256-${createHash("sha256").update(s, "utf8").digest("base64")}'`;
const META = /<meta http-equiv="Content-Security-Policy" content="([^"]*)"\/>/g;
const BOOT = 'document.documentElement.setAttribute("data-x","1")';
const page = (route: string) =>
  `<!DOCTYPE html><html><head><meta charSet="utf-8"/><script src="/_next/static/chunks/a.js" async=""></script></head>` +
  `<body><script>${BOOT}</script><script type="application/ld+json">{"@type":"Organization"}</script>` +
  `<script>(self.__next_f=self.__next_f||[]).push([0])</script><script>self.__next_f.push([1,"${route}"])</script></body></html>`;

let dir: string;

/** STATIC_PAGE_PATHS × 로케일 전부를 정적 HTML로 만든 가짜 빌드 결과 */
function fakeBuild({ isr }: { isr?: string } = {}) {
  const prerenders = [];
  for (const locale of ["ko", "en"]) {
    for (const p of STATIC_PAGE_PATHS) {
      const route = `/${locale}${p}`;
      const file = path.join(dir, ".next/server/app", `${route.slice(1)}.html`);
      mkdirSync(path.dirname(file), { recursive: true });
      writeFileSync(file, page(route));
      prerenders.push({ pathname: route, fallback: { filePath: file, initialRevalidate: route === isr ? 60 : (false as const) } });
    }
  }
  return { projectDir: dir, repoRoot: dir, distDir: path.join(dir, ".next"), outputs: { prerenders, staticFiles: [] } };
}

/** HTML을 배포 산출물로 복사하는 가짜 플랫폼 어댑터. stale이면 빌드 시작 때 읽어 둔(고치기 전) HTML을 쓴다 */
function fakePlatform(mode: "copy" | "stale" | "nothing") {
  const file = path.join(dir, "platform-adapter.mjs");
  writeFileSync(
    file,
    `import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
const snapshot = new Map();
export default {
  name: "fake-platform",
  modifyConfig(config) { return { ...config, touchedByPlatform: true }; },
  onBuildComplete(ctx) {
    const out = path.join(ctx.projectDir, ".vercel/output/functions");
    mkdirSync(out, { recursive: true });
    for (const p of ctx.outputs.prerenders) {
      if (${JSON.stringify(mode)} === "nothing") continue;
      const html = ${JSON.stringify(mode)} === "stale" ? readFileSync(p.fallback.filePath, "utf8").replace(/<meta http-equiv="Content-Security-Policy" content="[^"]*"\\/>/, "") : readFileSync(p.fallback.filePath, "utf8");
      writeFileSync(path.join(out, p.pathname.slice(1).replaceAll("/", "_") + ".prerender-fallback.html"), html);
    }
  },
};
`,
  );
  return file;
}

/** 테스트가 쓰는 만큼의 어댑터 모양 — 가짜 빌드 결과는 Next의 전체 컨텍스트 타입을 다 채우지 않는다 */
interface TestAdapter {
  modifyConfig(config: object, ctx: object): Promise<object>;
  onBuildComplete(ctx: object): Promise<void>;
}

async function loadAdapter(platform?: string): Promise<TestAdapter> {
  vi.resetModules();
  vi.stubEnv("NEXT_ADAPTER_PATH", platform ?? "");
  vi.stubEnv("NEXT_PUBLIC_GTM_ID", "");
  vi.stubEnv("BILLING_MODE", "");
  vi.stubEnv("VERCEL_OUTPUT_DIR", "");
  return (await import("../scripts/csp-adapter.mjs")).default as unknown as TestAdapter;
}

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "csp-adapter-"));
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("빌드 어댑터 — 정적 HTML에 해시 meta", () => {
  it("실행되는 인라인 스크립트만 해시해 charset 뒤에 meta를 하나 넣고, 다시 돌려도 하나다", async () => {
    const adapter = await loadAdapter();
    const ctx = fakeBuild();
    await adapter.onBuildComplete(ctx);
    await adapter.onBuildComplete(ctx);

    const html = readFileSync(path.join(dir, ".next/server/app/ko.html"), "utf8");
    const metas = [...html.matchAll(META)];
    expect(metas).toHaveLength(1);
    expect(html.indexOf("<meta http-equiv")).toBe(html.indexOf('<meta charSet="utf-8"/>') + '<meta charSet="utf-8"/>'.length);
    const policy = metas[0][1];
    expect(policy).toContain(sha(BOOT));
    expect(policy).toContain(sha('self.__next_f.push([1,"/ko"])'));
    expect(policy).not.toContain(sha('{"@type":"Organization"}')); // 데이터 블록은 실행되지 않는다
    expect(policy).not.toMatch(/unsafe-inline|strict-dynamic/);
  });

  it("플랫폼 어댑터보다 먼저 고친다 — 플랫폼이 옮긴 배포 산출물에도 meta가 있다", async () => {
    const adapter = await loadAdapter(fakePlatform("copy"));
    await adapter.onBuildComplete(fakeBuild());
    const out = readFileSync(path.join(dir, ".vercel/output/functions/ko_guide.prerender-fallback.html"), "utf8");
    expect([...out.matchAll(META)]).toHaveLength(1);
  });

  it("플랫폼 어댑터의 modifyConfig도 그대로 거친다", async () => {
    const adapter = await loadAdapter(fakePlatform("copy"));
    const config = await adapter.modifyConfig({ distDir: ".next" }, { phase: "phase-production-build", nextVersion: "16" });
    expect(config).toMatchObject({ distDir: ".next", touchedByPlatform: true });
  });

  it("배포 산출물의 HTML에 meta가 없으면 빌드를 실패시킨다", async () => {
    const adapter = await loadAdapter(fakePlatform("stale"));
    await expect(adapter.onBuildComplete(fakeBuild())).rejects.toThrow(/정적 페이지 CSP 처리 실패/);
    expect(vi.mocked(console.error).mock.calls.flat().join("\n")).toMatch(/meta가 0개/);
  });

  it("배포 산출물에서 정적 HTML을 찾지 못하면(플랫폼이 다른 곳에 둔다) 빌드를 실패시킨다", async () => {
    const adapter = await loadAdapter(fakePlatform("nothing"));
    await expect(adapter.onBuildComplete(fakeBuild())).rejects.toThrow(/정적 페이지 CSP 처리 실패/);
    expect(vi.mocked(console.error).mock.calls.flat().join("\n")).toMatch(/0개만 찾았다/);
  });

  it("정적 페이지가 ISR이면 빌드를 실패시킨다 — 런타임 재생성본에는 해시가 없다", async () => {
    const adapter = await loadAdapter();
    await expect(adapter.onBuildComplete(fakeBuild({ isr: "/ko/guide" }))).rejects.toThrow();
    expect(vi.mocked(console.error).mock.calls.flat().join("\n")).toMatch(/\/ko\/guide: revalidate 60초/);
  });

  it("정적 목록에 없는 로케일 페이지가 정적으로 만들어지면 빌드를 실패시킨다", async () => {
    const adapter = await loadAdapter();
    const ctx = fakeBuild();
    const file = path.join(dir, ".next/server/app/ko/dashboard.html");
    writeFileSync(file, page("/ko/dashboard"));
    ctx.outputs.prerenders.push({ pathname: "/ko/dashboard", fallback: { filePath: file, initialRevalidate: false } });
    await expect(adapter.onBuildComplete(ctx)).rejects.toThrow();
    expect(vi.mocked(console.error).mock.calls.flat().join("\n")).toMatch(/\/ko\/dashboard: 정적 페이지로 만들어졌지만/);
  });
});
