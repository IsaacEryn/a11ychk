/**
 * 익명 데이터셋의 식별 정보 검사 — 공개 전 게이트.
 *
 * anonymize.mjs의 자체 점검은 "매핑표에 있는 호스트명"만 본다. 그것만으로는 부족하다는
 * 것이 실제로 두 번 드러났다.
 *   - CSS 선택자에 남은 URL 경로: `a[href="/tta/contents?contentId=226"]` → 검색하면 특정됨
 *   - HTML 스니펫의 제품명·가격·한국어 UI 문구
 * 이 스크립트는 호스트명과 무관하게 "검색하면 사이트를 찾을 수 있는 패턴"을 훑는다.
 *
 * 실행: node check-anonymity.mjs [--dir=dataset] [--mapping=<비공개 매핑표>]
 * 매핑표를 주면 실명 잔존까지 함께 검사한다(공개 저장소에는 없으므로 선택 인자).
 */
import fs from "node:fs";
import path from "node:path";

const argOf = (n) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split("=")[1];
const DIR = argOf("dir") ?? "dataset";
const MAPPING = argOf("mapping");

/** 식별 위험 패턴 — 각 항목은 [이름, 정규식, 허용 예외] */
const PATTERNS = [
  ["URL 경로", /["'(]\/[a-z0-9_-]+\/[a-z0-9_.-]+/i, /\/_next\/|\/node_modules\//],
  ["쿼리스트링", /\?[a-z0-9_]+=[a-z0-9]/i, null],
    // 익명 ID(site-XX)와 예시·표준 도메인은 제외. www. 접두를 포함해 배제해야
  // lookahead가 www. 뒤가 아니라 호스트 시작 위치에서 평가된다.
  ["절대 URL", /https?:\/\/(?!(?:www\.)?site-[A-Z])(?!(?:www\.)?example\.(?:com|org))(?!(?:www\.)?w3\.org)(?!(?:www\.)?github\.com)(?:www\.)?[a-z0-9-]+\.[a-z]/, null],
  ["도메인 꼬리", /\.(co\.kr|go\.kr|ac\.kr|or\.kr|com|net|org)\b/i, /example\.(com|org)|a11ychk\.com|github\.com|w3\.org|deque\.com|npmjs\.com|doi\.org/i],
  // 한국어는 문서 설명문이 대부분이라 전수 검사하면 소음이 된다. 원본 UI 문구가
  // 남는 자리는 HTML 스니펫과 선택자이므로 그 형태일 때만 본다.
  ["HTML 속 한국어", /<[a-z][^>]*>[^<]*[가-힣]/i, null],
  ["선택자 속 한국어", /`[^`\n]*[.#[][a-z0-9_-]*[가-힣][^`\n]*`/i, null],
];

/** 우리가 만든 마스킹 표시 — 검사 대상 아님 */
const OURS = /\(생략\)/;

if (!fs.existsSync(DIR)) {
  console.error(`디렉터리 없음: ${DIR}`);
  process.exit(2);
}

const findings = [];
const walk = (d) => {
  for (const f of fs.readdirSync(d)) {
    const p = path.join(d, f);
    if (fs.statSync(p).isDirectory()) {
      walk(p);
      continue;
    }
    const lines = fs.readFileSync(p, "utf8").split("\n");
    lines.forEach((line, i) => {
      for (const [name, re, allow] of PATTERNS) {
        const m = line.match(re);
        if (!m) continue;
        if (allow && allow.test(line)) continue;
        if (OURS.test(m[0])) continue;
        findings.push({ file: path.relative(DIR, p), line: i + 1, kind: name, sample: line.trim().slice(0, 110) });
      }
    });
  }
};
walk(DIR);

// 매핑표가 주어지면 실명 잔존도 검사
if (MAPPING && fs.existsSync(MAPPING)) {
  const hosts = Object.keys(JSON.parse(fs.readFileSync(MAPPING, "utf8")));
  const walk2 = (d) => {
    for (const f of fs.readdirSync(d)) {
      const p = path.join(d, f);
      if (fs.statSync(p).isDirectory()) {
        walk2(p);
        continue;
      }
      const t = fs.readFileSync(p, "utf8");
      for (const h of hosts) {
        if (t.includes(h) || f.includes(h)) {
          findings.push({ file: path.relative(DIR, p), line: 0, kind: "실명 잔존", sample: h });
        }
      }
    }
  };
  walk2(DIR);
}

if (findings.length === 0) {
  console.log(`✓ ${DIR} — 식별 위험 패턴 없음`);
  process.exit(0);
}

const byKind = {};
for (const f of findings) (byKind[f.kind] ??= []).push(f);
console.error(`✗ ${DIR} — 식별 위험 ${findings.length}건\n`);
for (const [kind, list] of Object.entries(byKind)) {
  console.error(`[${kind}] ${list.length}건`);
  for (const f of list.slice(0, 5)) {
    console.error(`  ${f.file}${f.line ? ":" + f.line : ""}  ${f.sample}`);
  }
  if (list.length > 5) console.error(`  … 외 ${list.length - 5}건`);
  console.error("");
}
process.exit(1);
