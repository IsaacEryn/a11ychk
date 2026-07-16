#!/usr/bin/env node
/**
 * 브랜드 아이콘 생성 — 마스터 SVG(apps/web/src/app/icon.svg)에서 PNG 세트를 만든다.
 *   node scripts/gen-icons.mjs
 * 생성물:
 *   apps/web/src/app/apple-icon.png        (180×180)
 *   apps/web/public/icon-192.png           (PWA manifest)
 *   apps/web/public/icon-512.png
 *   apps/web/src/app/opengraph-image.png   (1200×630, OG/트위터 카드)
 *   apps/extension/src/icons/icon-{16,48,128}.png
 */
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const masterSvg = await readFile(join(root, "apps/web/src/app/icon.svg"));

async function png(size, outPath) {
  await mkdir(dirname(outPath), { recursive: true });
  // density를 올려 작은 크기에서도 선명하게 래스터라이즈
  await sharp(masterSvg, { density: Math.max(72, (size / 64) * 96) })
    .resize(size, size)
    .png()
    .toFile(outPath);
  console.log("✓", outPath, `${size}×${size}`);
}

// 아이콘 세트
await png(180, join(root, "apps/web/src/app/apple-icon.png"));
await png(192, join(root, "apps/web/public/icon-192.png"));
await png(512, join(root, "apps/web/public/icon-512.png"));
await png(16, join(root, "apps/extension/src/icons/icon-16.png"));
await png(48, join(root, "apps/extension/src/icons/icon-48.png"));
await png(128, join(root, "apps/extension/src/icons/icon-128.png"));

// OG 카드 (1200×630) — 로고 + 워드마크 + 태그라인. 텍스트는 SVG로 조판.
const og = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630">
  <rect width="1200" height="630" fill="#faf8f3"/>
  <rect x="0" y="618" width="1200" height="12" fill="#0b5d54"/>
  <g transform="translate(120,215) scale(3.125)">
    <rect x="3" y="3" width="58" height="58" rx="15" fill="none" stroke="#0b5d54" stroke-width="3.5"/>
    <rect x="11.5" y="11.5" width="41" height="41" rx="9" fill="#0b5d54"/>
    <path d="M22 33.5 L29.5 41 L43 24.5" fill="none" stroke="#ffffff" stroke-width="5.5" stroke-linecap="round" stroke-linejoin="round"/>
  </g>
  <text x="370" y="308" font-family="Avenir Next, Pretendard, AppleGothic, sans-serif" font-weight="700" font-size="92" fill="#1c2422">A11Y Check</text>
  <text x="374" y="380" font-family="Apple SD Gothic Neo, Pretendard, AppleGothic, sans-serif" font-weight="600" font-size="38" fill="#47524e">웹 접근성 자동 점검 · WCAG 2.2 + KWCAG 2.2</text>
  <text x="374" y="440" font-family="Avenir Next, Pretendard, sans-serif" font-weight="600" font-size="30" fill="#0b5d54">a11ychk.com</text>
</svg>`;
const ogPath = join(root, "apps/web/src/app/opengraph-image.png");
await writeFile(ogPath, await sharp(Buffer.from(og), { density: 96 }).png().toBuffer());
console.log("✓", ogPath, "1200×630");
