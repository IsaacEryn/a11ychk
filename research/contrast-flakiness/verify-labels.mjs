/**
 * 라벨 검증 — 안정 상태를 여러 번 재측정해 라벨의 신뢰도를 확인한다.
 *
 * label-assist.mjs는 안정 상태를 1회만 측정한다. 그런데 이 논문의 핵심 발견이
 * "측정은 비결정적"이라는 것이므로, 안정 상태 측정 자체도 회차마다 다를 수 있다.
 * 특정 사이트의 후보 요소를 안정 상태에서 N회 재측정해, 그 요소가 위반으로 보고되는
 * 발생률을 낸다. 발생률이 1이면 확실한 진탐, 0이면 확실한 오탐, 그 사이면 안정
 * 상태에서조차 비결정적 = 라벨을 단정할 수 없는 경계 케이스다.
 *
 * 실행: node verify-labels.mjs --host=example.com [--runs=5]
 */
import { chromium } from "playwright";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const AXE_SOURCE = fs.readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");
const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, "exp-out");
const argOf = (n) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split("=")[1];
const HOST = argOf("host");
const RUNS = Math.max(1, Number(argOf("runs")) || 5);
if (!HOST) {
  console.error("--host=... 필요");
  process.exit(2);
}

const lab = JSON.parse(fs.readFileSync(path.join(OUT, "labeling-assist.json"), "utf8"));
const rows = lab.filter((x) => x.host === HOST);
if (rows.length === 0) {
  console.error(`${HOST} 라벨 없음`);
  process.exit(1);
}
const url = rows[0].url;
const targets = new Set(rows.map((r) => r.selector));

/** 안정 상태에서 axe color-contrast 1회 측정 → 위반으로 보고된 selector 집합 */
async function measure(browser) {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    locale: "ko-KR",
    userAgent: "Mozilla/5.0 (compatible; a11ychk-exp/0.1; research)",
  });
  try {
    const page = await context.newPage();
    await page.route("**/*", (r) => {
      const t = r.request().resourceType();
      return t === "image" || t === "media" ? r.abort() : r.continue();
    });
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 25_000 });
    await page.waitForLoadState("load", { timeout: 8_000 }).catch(() => {});
    await page.evaluate(() => document.fonts?.ready).catch(() => {});
    await page
      .waitForFunction(() => (document.getAnimations?.() ?? []).every((a) => a.playState !== "running"), { timeout: 8_000 })
      .catch(() => {});
    await page.waitForTimeout(1_500);
    await page.addScriptTag({ content: AXE_SOURCE });
    const raw = await page.evaluate(
      `window.axe.run(document, { runOnly: { type: "rule", values: ["color-contrast"] }, resultTypes: ["violations"] })`,
    );
    const reported = new Set();
    for (const v of raw.violations ?? []) {
      for (const n of v.nodes ?? []) {
        reported.add(Array.isArray(n.target) ? n.target.join(" ") : String(n.target));
      }
    }
    return reported;
  } catch (e) {
    return null; // 측정 실패
  } finally {
    await context.close().catch(() => {});
  }
}

const browser = await chromium.launch({ headless: true });
const hits = new Map([...targets].map((s) => [s, 0]));
let okRuns = 0;
process.stdout.write(`${HOST} 안정 상태 ${RUNS}회 재측정 (후보 ${targets.size}건)\n`);
for (let k = 0; k < RUNS; k++) {
  const reported = await measure(browser);
  if (!reported) {
    process.stdout.write(`  ${k + 1}회차: 측정 실패\n`);
    continue;
  }
  okRuns++;
  for (const s of targets) if (reported.has(s)) hits.set(s, hits.get(s) + 1);
  process.stdout.write(`  ${k + 1}회차: 후보 중 ${[...targets].filter((s) => reported.has(s)).length}건 위반 보고\n`);
}
await browser.close();

// 안정 상태 발생률로 라벨 재판정
let confirmedFP = 0,
  confirmedTP = 0,
  borderline = 0;
const detail = [];
for (const r of rows) {
  const h = hits.get(r.selector) ?? 0;
  const inc = okRuns > 0 ? h / okRuns : null;
  let verdict;
  if (inc === null) verdict = "측정 실패";
  else if (inc === 0) verdict = "오탐 확정"; // 안정 상태 5회 모두 위반 아님
  else if (inc === 1) verdict = "진탐 확정"; // 안정 상태 5회 모두 위반
  else verdict = "경계(안정 상태도 비결정)";
  if (verdict === "오탐 확정") confirmedFP++;
  else if (verdict === "진탐 확정") confirmedTP++;
  else if (verdict.startsWith("경계")) borderline++;
  detail.push({ selector: r.selector, direction: r.direction, proposed: r.label, stableIncidence: inc, verdict });
}

console.log(`\n안정 상태 성공 ${okRuns}/${RUNS}회`);
console.log(`  오탐 확정 ${confirmedFP} · 진탐 확정 ${confirmedTP} · 경계 ${borderline}`);

fs.writeFileSync(
  path.join(OUT, `label-verify-${HOST}.json`),
  JSON.stringify({ host: HOST, url, runs: RUNS, okRuns, confirmedFP, confirmedTP, borderline, detail }, null, 2),
);
console.log(`\n저장 — label-verify-${HOST}.json`);
