/**
 * 논문 B 실험 결과 분석 — results.json → 논문 표·통계 요약.
 *
 * 하네스(contrast-falsepos.mjs)가 만든 요소별 발생률 데이터를 논문이 필요로 하는
 * 형태로 집계한다. 라벨링(오탐/진탐)은 사람이 해야 하므로, 여기서는 라벨링이
 * 필요한 케이스를 추려 주고 라벨 무관 지표(조건별 위반 수·비결정 위반 수)를 낸다.
 *
 * 실행: node research/contrast-flakiness/analyze.mjs [--in=exp-out/results.json]
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, "exp-out");
const argOf = (n) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split("=")[1];
const inFile = argOf("in") ?? path.join(OUT, "results.json");

const results = JSON.parse(fs.readFileSync(inFile, "utf8"));
const CONDS = ["base", "rm", "font", "rm+font"];

/** 조건별 요소 수 — 결정 위반(발생률 1.0)과 비결정 위반(0<x<1)을 나눈다 */
function summarize(cond) {
  if (!cond?.ok) return null;
  const nodes = cond.nodes ?? [];
  const stable = nodes.filter((n) => n.incidence >= 1).length;
  const flaky = nodes.filter((n) => n.incidence > 0 && n.incidence < 1).length;
  return { total: nodes.length, stable, flaky, okRuns: cond.okRuns, totalRuns: cond.totalRuns };
}

const rows = [];
for (const site of results) {
  const row = { host: site.host, runs: site.runs };
  for (const k of CONDS) row[k] = summarize(site.conditions?.[k]);
  rows.push(row);
}

const measured = rows.filter((r) => CONDS.every((k) => r[k]));
const failed = rows.filter((r) => !CONDS.every((k) => r[k]));

const sum = (k, f) => measured.reduce((a, r) => a + f(r[k]), 0);

const L = [];
L.push("# 명도 대비 오탐 실험 — 분석 요약 (자동 생성)");
L.push("");
L.push(`- 입력: \`${path.relative(HERE, inFile)}\``);
L.push(`- 대상 ${rows.length}곳 중 4조건 모두 측정 성공 **${measured.length}곳**, 일부 실패 ${failed.length}곳`);
L.push(`- 조건당 반복 ${results[0]?.runs ?? "?"}회`);
L.push("");
L.push("조건: base=대조군(RM off·폰트차단) / rm=RM만 on / font=폰트허용만 on / rm+font=둘 다 on");
L.push("");

// ── 표 1: 조건별 위반 요소 수 ──
L.push("## [표 1] 조건별 명도 대비 위반 요소 수");
L.push("");
L.push("괄호 안은 비결정 위반(반복 중 일부 회차에서만 보고된 요소) 수.");
L.push("");
L.push("| 사이트 | base | rm | font | rm+font |");
L.push("|---|---|---|---|---|");
for (const r of rows) {
  const cell = (k) => (r[k] ? `${r[k].total}${r[k].flaky > 0 ? ` (${r[k].flaky})` : ""}` : "측정 실패");
  L.push(`| ${r.host} | ${cell("base")} | ${cell("rm")} | ${cell("font")} | ${cell("rm+font")} |`);
}
if (measured.length > 0) {
  L.push(
    `| **합계(성공 ${measured.length}곳)** | ${CONDS.map((k) => `**${sum(k, (c) => c.total)}**`).join(" | ")} |`,
  );
}
L.push("");

// ── 표 2: 대조군 대비 감소 ──
L.push("## [표 2] 대조군(base) 대비 위반 감소");
L.push("");
L.push("각 제어를 켰을 때 base 대비 줄어든 요소 수. **감소분이 곧 오탐은 아니다** — 라벨링으로 확정할 것.");
L.push("");
L.push("| 조건 | 위반 요소 합 | base 대비 증감 | 증감률 |");
L.push("|---|---|---|---|");
if (measured.length > 0) {
  const baseTotal = sum("base", (c) => c.total);
  for (const k of CONDS) {
    const t = sum(k, (c) => c.total);
    const d = t - baseTotal;
    const pct = baseTotal > 0 ? ((d / baseTotal) * 100).toFixed(1) : "—";
    L.push(`| ${k} | ${t} | ${d > 0 ? "+" : ""}${d} | ${k === "base" ? "—" : `${d > 0 ? "+" : ""}${pct}%`} |`);
  }
}
L.push("");

// ── 표 3: 측정 안정성 ──
L.push("## [표 3] 측정 안정성 — 비결정 위반");
L.push("");
L.push("반복 측정에서 회차마다 결과가 달라진 요소. 값이 클수록 그 조건의 측정이 불안정하다.");
L.push("");
L.push("| 조건 | 비결정 요소 합 | 전체 대비 |");
L.push("|---|---|---|");
if (measured.length > 0) {
  for (const k of CONDS) {
    const f = sum(k, (c) => c.flaky);
    const t = sum(k, (c) => c.total);
    L.push(`| ${k} | ${f} | ${t > 0 ? ((f / t) * 100).toFixed(1) + "%" : "—"} |`);
  }
}
L.push("");

// ── 라벨링 대상 ──
L.push("## 라벨링이 필요한 케이스 (양방향)");
L.push("");
L.push("**사라진 방향**: base에는 있고 제어 조건에는 없음 → 제어가 오탐을 걷어냈는지 확인.");
L.push("**생긴 방향**: base에는 없고 제어 조건에 있음 → 제어가 오탐을 새로 만들었는지, 아니면");
L.push("base가 놓치던 진짜 위반을 드러냈는지(미탐 해소) 확인. 어느 쪽인지는 라벨링으로만 갈린다.");
L.push("");
let goneTotal = 0;
let addedTotal = 0;
const perCond = { gone: {}, added: {} };
for (const site of results) {
  const base = site.conditions?.base;
  if (!base?.ok) continue;
  const baseSet = new Set(base.nodes.map((n) => n.selector));
  const lines = [];
  for (const k of CONDS.slice(1)) {
    const c = site.conditions?.[k];
    if (!c?.ok) continue;
    const cSet = new Set(c.nodes.map((n) => n.selector));
    const gone = base.nodes.filter((n) => !cSet.has(n.selector));
    const added = c.nodes.filter((n) => !baseSet.has(n.selector));
    goneTotal += gone.length;
    addedTotal += added.length;
    perCond.gone[k] = (perCond.gone[k] ?? 0) + gone.length;
    perCond.added[k] = (perCond.added[k] ?? 0) + added.length;
    if (gone.length) lines.push(`- ${k}에서 사라짐 ${gone.length}건 — ${gone.slice(0, 3).map((n) => `\`${n.selector.slice(0, 40)}\``).join(", ")}${gone.length > 3 ? " …" : ""}`);
    if (added.length) lines.push(`- ${k}에서 생김 ${added.length}건 — ${added.slice(0, 3).map((n) => `\`${n.selector.slice(0, 40)}\``).join(", ")}${added.length > 3 ? " …" : ""}`);
  }
  if (lines.length === 0) continue;
  L.push(`### ${site.host}`);
  L.push(...lines);
  L.push("");
}
L.push(`**라벨링 대상: 사라진 ${goneTotal}건 · 생긴 ${addedTotal}건**`);
L.push("");
L.push("| 조건 | 사라짐 | 생김 |");
L.push("|---|---|---|");
for (const k of CONDS.slice(1)) L.push(`| ${k} | ${perCond.gone[k] ?? 0} | ${perCond.added[k] ?? 0} |`);
L.push("");

if (failed.length > 0) {
  L.push("## 측정 실패");
  L.push("");
  for (const r of failed) {
    const bad = CONDS.filter((k) => !r[k]);
    L.push(`- ${r.host} — 실패 조건: ${bad.join(", ")}`);
  }
  L.push("");
  L.push("실패 사이트는 표본에서 제외하고 그 사유를 논문에 명시할 것.");
}

const outFile = path.join(OUT, "analysis-summary.md");
fs.writeFileSync(outFile, L.join("\n") + "\n");
console.log(L.join("\n"));
console.log(`\n생성 — ${outFile}`);
