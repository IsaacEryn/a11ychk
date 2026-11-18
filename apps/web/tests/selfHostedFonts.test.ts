import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * 웹 글꼴은 빌드할 때 밖에서 받아 오지 않는다.
 *
 * next/font/google은 빌드마다 Google Fonts에서 CSS와 글꼴 파일을 받는다. Google Fonts가 가끔 글꼴 주소를
 * 확장자 없는 `/l/font?kit=…&skey=…` 꼴로 돌려주면 Next가 그 주소를 풀지 못해 빌드가 깨진다
 * (vercel/next.js#99114). 2026-11-18에 문서만 바꾼 병합 뒤 main CI가 이 때문에 두 번 연달아 실패했다.
 * 그래서 Hahmlet도 Pretendard처럼 패키지에 든 파일을 번들해 서빙한다.
 */

const srcDir = fileURLToPath(new URL("../src", import.meta.url));

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return /\.(ts|tsx|mjs|css)$/.test(entry.name) ? [full] : [];
  });
}

const sources = sourceFiles(srcDir).map((file) => ({
  file: path.relative(srcDir, file),
  text: readFileSync(file, "utf8"),
}));

describe("웹 글꼴 자체 서빙", () => {
  it("next/font/google을 가져오는 소스가 없다", () => {
    const offenders = sources.filter(({ text }) => /from\s+["']next\/font\/google["']/.test(text)).map(({ file }) => file);
    expect(offenders, "빌드가 Google Fonts 응답에 기대게 된다 — 글꼴 패키지를 번들해 쓸 것").toEqual([]);
  });

  it("제목 글꼴 Hahmlet은 쓰는 굵기(500·700·800)를 패키지 CSS로 싣고, 전역 CSS가 그 패밀리를 가리킨다", () => {
    const imported = sources.flatMap(({ text }) =>
      [...text.matchAll(/import\s+["']@fontsource\/hahmlet\/(\d{3})\.css["']/g)].map((m) => m[1]),
    );
    expect(imported.sort(), "빠진 굵기는 브라우저가 흉내 내어 그리거나 대체 글꼴로 나온다").toEqual(["500", "700", "800"]);

    const globals = sources.find(({ file }) => file === path.join("app", "globals.css"));
    const display = globals?.text.match(/--font-display:\s*([^;]+);/)?.[1] ?? "";
    expect(display.startsWith('"Hahmlet",')).toBe(true);
  });
});
