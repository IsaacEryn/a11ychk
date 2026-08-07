/**
 * 산출물 익명화 — 사이트 실명을 안정적인 익명 ID(site-A, site-B, …)로 치환한다.
 *
 * 왜 필요한가: 실험 산출물에는 "어느 사이트에 접근성 위반이 몇 건"이라는 평가 결과가
 * 사이트별로 붙어 있다. 학술 관례상 실명 공개가 불가능하지는 않으나 민원 소지가 있어,
 * 공개 데이터셋은 익명 ID로 내고 실명 매핑표는 비공개로 보관하는 선택지를 남긴다.
 *
 * 매핑은 **결정적**이다 — 입력 순서와 무관하게 호스트명을 정렬해 ID를 부여하므로,
 * 같은 데이터를 다시 익명화해도 같은 ID가 나온다. 매핑표(mapping.json)를 비공개로
 * 보관하면 나중에 특정 site-X가 어디였는지 되짚을 수 있어 연구 무결성이 유지된다.
 *
 * 익명화 대상:
 *   - results-*.json / labeling-assist.json  : host·url 필드
 *   - label-verify-<host>.json               : 파일명과 내부 host·url
 *   - *.md 리포트                             : 본문에 등장하는 호스트 문자열
 *   - shots/<host>/                          : 디렉터리명 (--shots 지정 시)
 *
 * 실행:
 *   node anonymize.mjs --in=exp-out --out=exp-out-anon [--mapping=mapping.json] [--shots]
 *
 * 주의: 매핑표는 **공개 저장소에 커밋하지 말 것.** 익명화의 의미가 사라진다.
 */
import fs from "node:fs";
import path from "node:path";

const argOf = (n) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split("=")[1];
const IN = argOf("in") ?? "exp-out";
const OUT = argOf("out") ?? "exp-out-anon";
const MAPPING = argOf("mapping") ?? "mapping.json";
const DO_SHOTS = process.argv.includes("--shots");

if (!fs.existsSync(IN)) {
  console.error(`입력 디렉터리 없음: ${IN}`);
  process.exit(1);
}

/** 호스트 → site-A 형식 ID. 26곳 초과 시 site-AA, site-AB … */
function idFor(index) {
  let n = index;
  let s = "";
  do {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return `site-${s}`;
}

// ── 1) 등장하는 호스트를 모두 수집 ──
const hosts = new Set();
const collectFromJson = (obj) => {
  if (Array.isArray(obj)) return obj.forEach(collectFromJson);
  if (obj && typeof obj === "object") {
    if (typeof obj.host === "string") hosts.add(obj.host);
    Object.values(obj).forEach(collectFromJson);
  }
};
for (const f of fs.readdirSync(IN)) {
  const full = path.join(IN, f);
  if (!fs.statSync(full).isFile()) continue;
  if (f.endsWith(".json")) {
    try {
      collectFromJson(JSON.parse(fs.readFileSync(full, "utf8")));
    } catch {
      /* 파싱 불가 파일은 건너뛴다 */
    }
  }
  const m = f.match(/^label-verify-(.+)\.json$/);
  if (m && m[1] !== "summary") hosts.add(m[1]);
}
if (fs.existsSync(path.join(IN, "shots"))) {
  for (const d of fs.readdirSync(path.join(IN, "shots"))) {
    if (d !== "_skip") hosts.add(d);
  }
}

// ── 2) 결정적 매핑 생성 (호스트명 정렬 기준) ──
const sorted = [...hosts].sort();
const map = new Map(sorted.map((h, i) => [h, idFor(i)]));
if (map.size === 0) {
  console.error("호스트를 하나도 찾지 못했다 — 입력 디렉터리를 확인할 것");
  process.exit(1);
}

/** 긴 호스트부터 치환해야 부분 문자열이 먼저 걸리지 않는다 */
const byLength = [...map.keys()].sort((a, b) => b.length - a.length);
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
function anonText(text) {
  let out = text;
  for (const h of byLength) {
    out = out.replaceAll(new RegExp(escapeRe(h), "g"), map.get(h));
  }
  return out;
}

// ── 3) 파일별 치환 ──
fs.mkdirSync(OUT, { recursive: true });
let files = 0;
for (const f of fs.readdirSync(IN)) {
  const full = path.join(IN, f);
  if (!fs.statSync(full).isFile()) continue;
  const outName = anonText(f);
  fs.writeFileSync(path.join(OUT, outName), anonText(fs.readFileSync(full, "utf8")));
  files++;
}

if (DO_SHOTS && fs.existsSync(path.join(IN, "shots"))) {
  const shotsOut = path.join(OUT, "shots");
  fs.mkdirSync(shotsOut, { recursive: true });
  for (const d of fs.readdirSync(path.join(IN, "shots"))) {
    fs.cpSync(path.join(IN, "shots", d), path.join(shotsOut, map.get(d) ?? d), { recursive: true });
  }
  console.log(`  스크린샷 디렉터리 ${fs.readdirSync(path.join(IN, "shots")).length}개 복사`);
}

fs.writeFileSync(MAPPING, JSON.stringify(Object.fromEntries(map), null, 2));

console.log(`익명화 완료 — ${IN} → ${OUT}`);
console.log(`  파일 ${files}개 · 호스트 ${map.size}곳`);
console.log(`  매핑표: ${MAPPING}  ⚠️ 공개 저장소에 커밋하지 말 것`);

// 잔여 실명 자체 점검
const leftovers = [];
for (const f of fs.readdirSync(OUT)) {
  const full = path.join(OUT, f);
  if (!fs.statSync(full).isFile()) continue;
  const t = fs.readFileSync(full, "utf8");
  for (const h of map.keys()) if (t.includes(h)) leftovers.push(`${f}: ${h}`);
}
if (leftovers.length > 0) {
  console.error("\n⚠️ 익명화 후에도 실명이 남았다:");
  for (const l of leftovers.slice(0, 10)) console.error("  " + l);
  process.exit(1);
}
console.log("  자체 점검: 잔여 실명 없음");
