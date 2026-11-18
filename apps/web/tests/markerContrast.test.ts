import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * 형광펜 강조(.marker) 글자는 뒤에 깔리는 모든 색과 충분한 대비를 가져야 한다.
 *
 * .marker는 원래 글자 아래쪽에만 --color-mark 띠를 까는 장식이고 글자색은 본문 색을 물려받는다.
 * 본문이 밝은 테마에서는 띠와 겹치는 글자 아랫부분의 대비가 무너졌다. 고대비는 흰 글자와 밝은
 * 노랑(#ffe600)이 겹쳐 1.27:1, 다크는 밝은 글자와 금색(#a98a1f)이 겹쳐 2.88:1이었다.
 * 자동 검사(axe)는 배경이 그라데이션이면 대비를 판정하지 못하므로, 토큰과 규칙에서 직접 계산해 막는다.
 */

const css = readFileSync(fileURLToPath(new URL("../src/app/globals.css", import.meta.url)), "utf8").replace(
  /\/\*[\s\S]*?\*\//g,
  "",
);

/**
 * 중괄호가 겹치지 않는 가장 안쪽 규칙들. @media 안의 규칙도 여기에 들어온다.
 * 선택자 앞에 붙어 잡히는 `@import …;` 같은 문장은 마지막 세미콜론 뒤만 남겨 떼어 낸다.
 */
const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, prelude, body]) => ({
  selectors: (prelude.split(";").pop() ?? "").split(",").map((selector) => selector.trim()),
  body,
}));

/** 선택자가 정확히 일치하는 규칙들의 선언을 순서대로 합친다(뒤의 선언이 앞을 덮는다). */
function declarations(selector: string): Map<string, string> {
  const found = new Map<string, string>();
  for (const rule of rules) {
    if (!rule.selectors.includes(selector)) continue;
    for (const [, prop, value] of rule.body.matchAll(/([\w-]+)\s*:\s*([^;]+);/g)) {
      found.set(prop, value.trim());
    }
  }
  return found;
}

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const v = parseInt(hex.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * 한 테마에서 .marker 글자색과, 그 글자 뒤에 깔릴 수 있는 색 전부를 구한다.
 * tokens는 그 테마의 색 토큰이 정의된 선택자, scope는 그 테마 전용 .marker 규칙의 앞머리다.
 */
function markerColors(tokens: string, scope: string | null) {
  const themeTokens = declarations(tokens);
  const marker = new Map([...declarations(".marker"), ...(scope ? declarations(`${scope} .marker`) : [])]);

  const resolve = (value: string): string => {
    const token = value.match(/var\((--[\w-]+)\)/)?.[1];
    const resolved = token ? themeTokens.get(token) : value;
    if (!resolved || !/^#[0-9a-f]{6}$/i.test(resolved)) throw new Error(`색을 풀 수 없음: ${value}`);
    return resolved;
  };

  const text = resolve(marker.get("color") ?? "var(--color-ink)");
  const background = marker.get("background") ?? "transparent";
  const behind = (background.match(/var\(--[\w-]+\)|#[0-9a-f]{6}|transparent/gi) ?? ["transparent"]).map(
    (part) => resolve(part === "transparent" ? "var(--color-paper)" : part),
  );
  return { text, behind: [...new Set(behind)] };
}

const themes = [
  { name: "라이트(기본값)", tokens: "@theme", scope: null, min: 4.5 },
  { name: "라이트(직접 고름)", tokens: ':root[data-theme="light"]', scope: ':root[data-theme="light"]', min: 4.5 },
  { name: "다크(OS 설정)", tokens: ":root:not([data-theme])", scope: ":root:not([data-theme])", min: 4.5 },
  { name: "다크(직접 고름)", tokens: ':root[data-theme="dark"]', scope: ':root[data-theme="dark"]', min: 4.5 },
  { name: "고대비", tokens: ':root[data-theme="contrast"]', scope: ':root[data-theme="contrast"]', min: 7 },
];

describe("형광펜 강조 글자의 대비", () => {
  it.each(themes)("$name 테마에서 뒤에 깔리는 모든 색과 $min:1 이상이다", ({ tokens, scope, min }) => {
    const { text, behind } = markerColors(tokens, scope);
    const ratios = behind.map((color) => ({ color, ratio: Number(contrast(text, color).toFixed(2)) }));

    expect(ratios.filter(({ ratio }) => ratio < min)).toEqual([]);
  });
});
