#!/usr/bin/env node
/**
 * 브랜드 아이콘 재생성 — 마스터 SVG(brand/)에서 PNG 세트를 만든다.
 *   node scripts/gen-icons.mjs
 *
 * 마스터:
 *   brand/a11y-check-mark.svg        — 상세판 (48px 이상)
 *   brand/a11y-check-mark-simple.svg — 간략판 (32px 이하 — 도트 3개)
 *
 * 생성물:
 *   apps/web/src/app/apple-icon.png        (180)
 *   apps/web/public/icon-{192,512}.png     (PWA)
 *   apps/extension/src/icons/icon-{16,48,128}.png
 *
 * ※ favicon(apps/web/src/app/icon.svg)은 간략판 SVG 원본을 그대로 사용.
 * ※ OG 이미지(opengraph-image.png)는 디자이너 제공 원본 — 재생성하지 않음.
 */
import { readFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const detailed = await readFile(join(root, "brand/a11y-check-mark.svg"));
const simple = await readFile(join(root, "brand/a11y-check-mark-simple.svg"));

async function png(src, size, outPath) {
  await mkdir(dirname(outPath), { recursive: true });
  await sharp(src, { density: Math.max(72, (size / 64) * 96) }).resize(size, size).png().toFile(outPath);
  console.log("✓", outPath, `${size}×${size}`);
}

await png(detailed, 180, join(root, "apps/web/src/app/apple-icon.png"));
await png(detailed, 192, join(root, "apps/web/public/icon-192.png"));
await png(detailed, 512, join(root, "apps/web/public/icon-512.png"));
await png(simple, 16, join(root, "apps/extension/src/icons/icon-16.png"));
await png(detailed, 48, join(root, "apps/extension/src/icons/icon-48.png"));
await png(detailed, 128, join(root, "apps/extension/src/icons/icon-128.png"));
