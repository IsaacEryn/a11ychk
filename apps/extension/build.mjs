import { build } from "esbuild";
import { cp, mkdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const src = join(root, "src");
const dist = join(root, "dist");

const SITE_ORIGIN = process.env.A11YCHK_SITE_ORIGIN ?? "https://www.a11ychk.com";

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });

// TypeScript 엔트리 번들 (팝업 · 콘텐츠 스크립트)
await build({
  entryPoints: {
    popup: join(src, "popup.ts"),
    "content-connect": join(src, "content-connect.ts"),
  },
  bundle: true,
  format: "iife",
  target: "chrome110",
  outdir: dist,
  define: { "process.env.A11YCHK_SITE_ORIGIN": JSON.stringify(SITE_ORIGIN) },
  loader: { ".css": "text" },
});

// 정적 파일 복사 (manifest, 팝업 HTML/CSS, axe, 아이콘)
for (const f of ["manifest.json", "popup.html", "popup.css"]) {
  await cp(join(src, f), join(dist, f));
}
await cp(join(src, "vendor"), join(dist, "vendor"), { recursive: true });
await cp(join(src, "icons"), join(dist, "icons"), { recursive: true });

console.log(`✓ 확장 빌드 완료 → apps/extension/dist (site: ${SITE_ORIGIN})`);
