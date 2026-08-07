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
 * 호스트명 치환만으로는 익명성이 보장되지 않는다. CSS 선택자의 고유 클래스명, HTML
 * 스니펫의 제품명·가격, URL 경로(`/site/xxx_kor/main.do`)는 검색하면 원 사이트를
 * 특정할 수 있다. 기본 모드(--measurements-only)는 이런 필드를 아예 제거하고 측정값만
 * 남긴다 — 논문 표는 전부 재현되지만 개별 요소를 원 사이트에서 되찾을 수는 없다.
 *
 * 익명화 대상:
 *   - host·url                : 익명 ID로 치환 (url은 경로 제거)
 *   - selector·html           : 제거 (--keep-selectors로 유지 가능 — 식별 위험 있음)
 *   - 파일명·리포트 본문       : 호스트 문자열 치환
 *   - shots/<host>/           : 스크린샷은 화면 자체가 식별 정보라 기본 제외
 *
 * 실행:
 *   node anonymize.mjs --in=exp-out --out=dataset [--mapping=mapping.json]
 *   node anonymize.mjs --in=exp-out --out=dataset --keep-selectors   # 식별 위험 감수
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
const KEEP_SELECTORS = process.argv.includes("--keep-selectors");

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
  // 리포트 본문에 등장하는 호스트도 수집한다. 스크리닝에서 제외·실패한 사이트는
  // 본 실험 결과(results.json)에 없어 위 수집만으로는 매핑에 빠지고, 그러면
  // 스크리닝 리포트나 오류 메시지에 실명이 그대로 남는다.
  if (f.endsWith(".md") || f.endsWith(".json")) {
    const text = fs.readFileSync(full, "utf8");
    for (const h of text.matchAll(/\b((?:[a-z0-9-]+\.)+(?:kr|com|net|org|io|go\.kr|ac\.kr|or\.kr))\b/gi)) {
      const host = h[1].toLowerCase().replace(/^www\./, "");
      // 도구·표준 도메인은 대상이 아니다
      if (/^(github\.com|w3\.org|deque\.com|a11ychk\.com|npmjs\.com|example\.(com|org))$/.test(host)) continue;
      hosts.add(host);
    }
  }
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

/** URL에서 경로를 떼고 익명 오리진만 남긴다 — 경로는 사이트 식별 단서다 */
function anonUrl(u) {
  const id = map.get(String(u).replace(/^https?:\/\/(www\.)?/, "").replace(/\/.*$/, ""));
  return id ? `https://${id}/` : anonText(String(u));
}

/**
 * JSON 트리에서 식별 가능 필드를 정리한다.
 * host는 ID로, url은 경로 없는 ID로, selector·html·shot은 기본 제거.
 * 요소 간 동일성 비교는 유지해야 하므로 selector 자리에 안정적인 대체 키를 넣는다.
 */
const selKey = new Map();
/** 선택자 → el-N. JSON과 마크다운이 같은 ID를 쓰도록 한 곳에서 관리한다 */
function elIdFor(sel) {
  if (!selKey.has(sel)) selKey.set(sel, `el-${selKey.size + 1}`);
  return selKey.get(sel);
}

function scrubJson(obj) {
  if (Array.isArray(obj)) return obj.map(scrubJson);
  if (!obj || typeof obj !== "object") return obj;
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (k === "host" && typeof v === "string") out[k] = map.get(v) ?? anonText(v);
    else if (k === "url" && typeof v === "string") out[k] = anonUrl(v);
    else if (!KEEP_SELECTORS && k === "selector" && typeof v === "string") {
      // 내용은 감추되 같은 요소가 여러 조건에 등장하는지는 비교 가능해야 한다
      out[k] = elIdFor(v);
    } else if (!KEEP_SELECTORS && (k === "html" || k === "shot")) continue;
    else if (typeof v === "string") out[k] = anonText(v); // error 메시지 등에 URL이 박혀 있다
    else out[k] = scrubJson(v);
  }
  return out;
}

/**
 * 마크다운 리포트의 선택자·코드 조각을 가린다.
 *
 * 규칙(길이·패턴)으로 판별하지 않는다 — 그 방식은 URL 경로가 든 선택자
 * (`a[href="/tta/contents?contentId=226"]`)처럼 규칙에 안 걸리는 형태를 놓친다.
 * 대신 JSON에서 쓴 selKey 사전을 그대로 적용해 알려진 선택자를 el-N으로 바꾸고,
 * 남은 백틱 조각 중 코드처럼 보이는 것은 통째로 가린다.
 */
function scrubMarkdown(text) {
  let t = anonText(text);
  if (KEEP_SELECTORS) return t;
  // 긴 선택자부터 치환 (짧은 것이 긴 것의 부분 문자열일 수 있다)
  for (const sel of [...selKey.keys()].sort((a, b) => b.length - a.length)) {
    t = t.replaceAll(sel, selKey.get(sel));
  }
  // 사전에 없는 잔여 코드 조각 — HTML 태그, URL 경로, 쿼리스트링이 보이면 가린다.
  // [\s\S]로 여러 줄에 걸친 조각까지 잡는다 — HTML 스니펫은 줄바꿈을 품고 있다.
  t = t.replace(/`([\s\S]*?)`/g, (m, inner) =>
    /[<>]|https?:|\/\w+\/|\?\w+=|[a-zA-Z]{4,}[_-][a-zA-Z]{3,}/.test(inner) ? "`(생략)`" : m,
  );
  // 스크린샷 경로는 캡처가 공개되지 않으므로 참조를 지운다
  t = t.replace(/ ?· 캡처 shots 참조: \S+/g, "");
  return t;
}

// ── 3) 파일별 치환 ──
fs.mkdirSync(OUT, { recursive: true });
let files = 0;
// JSON을 먼저 처리해 selKey를 채운 뒤 마크다운을 처리한다 — 두 형식이 같은 el-N을 쓰도록
const entries = fs.readdirSync(IN).filter((f) => fs.statSync(path.join(IN, f)).isFile());
for (const f of [...entries.filter((f) => f.endsWith(".json")), ...entries.filter((f) => !f.endsWith(".json"))]) {
  const full = path.join(IN, f);
  const outName = anonText(f);
  const raw = fs.readFileSync(full, "utf8");
  let content;
  if (f.endsWith(".json")) {
    try {
      content = JSON.stringify(scrubJson(JSON.parse(raw)), null, 2);
    } catch {
      content = anonText(raw);
    }
  } else if (f.endsWith(".md")) {
    content = scrubMarkdown(raw);
  } else {
    content = anonText(raw);
  }
  fs.writeFileSync(path.join(OUT, outName), content);
  files++;
}

if (DO_SHOTS && fs.existsSync(path.join(IN, "shots"))) {
  console.warn("  ⚠️ --shots: 스크린샷은 화면 자체가 식별 정보다. 공개 전 검토할 것.");
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
