import { build } from "esbuild";
import { cp, mkdir, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const src = join(root, "src");
const dist = join(root, "dist");

const require = createRequire(import.meta.url);

const SITE_ORIGIN = process.env.A11YCHK_SITE_ORIGIN ?? "https://www.a11ychk.com";

// axe는 워크스페이스 의존성(node_modules)에서 가져와 core와 버전 동기화
const axeMinPath = require.resolve("axe-core/axe.min.js");
const AXE_VERSION = require(join(dirname(axeMinPath), "package.json")).version;

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });

// TypeScript 엔트리 번들 (사이드 패널 · 콘텐츠 스크립트 · 서비스 워커)
// target chrome114: Side Panel API 요구 버전
await build({
  entryPoints: {
    sidepanel: join(src, "sidepanel.ts"),
    "content-connect": join(src, "content-connect.ts"),
    background: join(src, "background.ts"),
  },
  bundle: true,
  format: "iife",
  target: "chrome114",
  outdir: dist,
  define: {
    "process.env.A11YCHK_SITE_ORIGIN": JSON.stringify(SITE_ORIGIN),
    "process.env.A11YCHK_AXE_VERSION": JSON.stringify(AXE_VERSION),
  },
  loader: { ".css": "text" },
});

// 정적 파일 복사 (manifest, 패널 HTML/CSS, 아이콘) + axe (node_modules에서 — 벤더 드리프트 방지)
for (const f of ["manifest.json", "sidepanel.html", "sidepanel.css"]) {
  await cp(join(src, f), join(dist, f));
}
await mkdir(join(dist, "vendor"), { recursive: true });
await cp(axeMinPath, join(dist, "vendor", "axe.min.js"));
await cp(join(src, "icons"), join(dist, "icons"), { recursive: true });
await cp(join(src, "_locales"), join(dist, "_locales"), { recursive: true });

console.log(`✓ 확장 빌드 완료 → apps/extension/dist (site: ${SITE_ORIGIN}, axe: v${AXE_VERSION})`);
