/**
 * ko/en 메시지 정합성 점검 — leaf 키 집합이 완전히 일치해야 통과.
 *
 * 한쪽에만 키를 추가하면 next-intl이 런타임에 MISSING_MESSAGE를 던지는데,
 * 빠진 언어로 그 화면을 열기 전까지는 아무도 모른다. 배열은 길이까지 본다
 * (FAQ처럼 문답 배열의 항목 수가 어긋나는 것도 사실상 누락이다).
 *
 * 부수 점검: ICU에서 작은따옴표는 이스케이프 문자라 '{name}' 은 자리표시자가
 * 아니라 리터럴로 찍힌다 — 실제로 겪은 사고라 같이 잡는다.
 *
 * 사용법: node scripts/check-i18n.mjs   (apps/web에서, npm run test:i18n)
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const base = join(dirname(fileURLToPath(import.meta.url)), "..", "messages");
const ko = JSON.parse(readFileSync(join(base, "ko.json"), "utf8"));
const en = JSON.parse(readFileSync(join(base, "en.json"), "utf8"));

function leaves(node, prefix = "", out = []) {
  if (Array.isArray(node)) {
    out.push(`${prefix}[${node.length}]`);
    node.forEach((item, i) => {
      if (item && typeof item === "object") leaves(item, `${prefix}[${i}].`, out);
    });
  } else if (node && typeof node === "object") {
    for (const [k, v] of Object.entries(node)) {
      if (v && typeof v === "object") leaves(v, `${prefix}${k}.`, out);
      else out.push(`${prefix}${k}`);
    }
  }
  return out;
}

const koSet = new Set(leaves(ko));
const enSet = new Set(leaves(en));
const onlyKo = [...koSet].filter((k) => !enSet.has(k));
const onlyEn = [...enSet].filter((k) => !koSet.has(k));

// '{placeholder}' — ICU 이스케이프로 자리표시자가 죽는 패턴
const quoted = [];
// 키별 자리표시자 집합 — 같은 키인데 한쪽만 {count}를 쓰면 그 언어에서만 값이 사라진다
const placeholders = { ko: new Map(), en: new Map() };
for (const [name, tree] of [["ko", ko], ["en", en]]) {
  const walk = (node, path) => {
    if (typeof node === "string") {
      if (/'\{[a-zA-Z0-9_]+\}'/.test(node)) quoted.push(`${name}: ${path}`);
      const found = [...node.matchAll(/\{([a-zA-Z0-9_]+)\}/g)].map((m) => m[1]).sort();
      if (found.length > 0) placeholders[name].set(path, found.join(","));
    } else if (node && typeof node === "object") {
      for (const [k, v] of Object.entries(node)) walk(v, `${path}${path ? "." : ""}${k}`);
    }
  };
  walk(tree, "");
}
const phMismatch = [];
for (const key of new Set([...placeholders.ko.keys(), ...placeholders.en.keys()])) {
  const k = placeholders.ko.get(key) ?? "";
  const e = placeholders.en.get(key) ?? "";
  if (koSet.has(key) && enSet.has(key) && k !== e) phMismatch.push(`${key} — ko:{${k}} vs en:{${e}}`);
}

let failed = false;
if (onlyKo.length > 0) {
  failed = true;
  console.error(`en에 없는 키 ${onlyKo.length}개:`);
  for (const k of onlyKo) console.error(`  - ${k}`);
}
if (onlyEn.length > 0) {
  failed = true;
  console.error(`ko에 없는 키 ${onlyEn.length}개:`);
  for (const k of onlyEn) console.error(`  - ${k}`);
}
if (quoted.length > 0) {
  failed = true;
  console.error(`작은따옴표로 감싼 ICU 자리표시자 ('{…}' — 리터럴로 출력됨):`);
  for (const k of quoted) console.error(`  - ${k}`);
}
if (phMismatch.length > 0) {
  failed = true;
  console.error(`자리표시자 집합이 언어별로 다른 키 ${phMismatch.length}개:`);
  for (const k of phMismatch) console.error(`  - ${k}`);
}

if (failed) process.exit(1);
console.log(`ko/en 정합 — leaf ${koSet.size}개 일치`);
