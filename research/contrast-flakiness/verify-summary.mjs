/**
 * 전 사이트 라벨 검증(label-verify-*.json)을 모아 최종 라벨 집계를 낸다.
 * 안정 상태 5회 재측정 기준으로 오탐 확정 / 진탐 확정 / 경계(안정 상태도 비결정)를 센다.
 *
 * 실행: node verify-summary.mjs [--in=dataset]
 * 기본 입력은 exp-out(직접 실험한 산출물). 공개 데이터셋으로 논문 표 3을 재현하려면
 * --in=dataset을 준다. 요약 md는 입력 디렉터리에 쓴다.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const argOf = (n) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split("=")[1];
const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), argOf("in") ?? "exp-out");
if (!fs.existsSync(OUT)) {
  console.error(`입력 디렉터리 없음: ${OUT} — 공개 데이터셋이면 --in=dataset을 주세요.`);
  process.exit(1);
}
const files = fs.readdirSync(OUT).filter((f) => f.startsWith("label-verify-") && f.endsWith(".json"));
if (files.length === 0) {
  console.error(`label-verify-*.json이 없음: ${OUT} — verify-labels.mjs를 먼저 실행하거나 --in=dataset을 확인하세요.`);
  process.exit(1);
}

let fp = 0, tp = 0, border = 0, fail = 0;
const perSite = [];
const perCond = {}; // direction 유지가 필요하면 detail로

for (const f of files) {
  const v = JSON.parse(fs.readFileSync(path.join(OUT, f), "utf8"));
  const row = { host: v.host, n: v.detail.length, fp: v.confirmedFP, tp: v.confirmedTP, border: v.borderline, okRuns: v.okRuns };
  fp += v.confirmedFP;
  tp += v.confirmedTP;
  border += v.borderline;
  fail += v.detail.filter((d) => d.verdict === "측정 실패").length;
  perSite.push(row);
}
perSite.sort((a, b) => b.n - a.n || a.host.localeCompare(b.host)); // 동률은 이름순 — 재실행해도 표가 같게

const L = [];
L.push("# 라벨 최종 검증 — 안정 상태 5회 재측정 집계");
L.push("");
L.push("각 후보 요소를 안정 상태에서 5회 재측정. 5회 모두 위반 아님 = 오탐 확정,");
L.push("5회 모두 위반 = 진탐 확정, 그 사이 = 경계(안정 상태에서도 비결정 → 라벨 불가).");
L.push("");
const total = fp + tp + border + fail;
L.push(`- 검증 사이트 ${perSite.length}곳 · 총 ${total}건`);
L.push(`- **오탐 확정 ${fp} · 진탐 확정 ${tp} · 경계 ${border}${fail ? ` · 측정 실패 ${fail}` : ""}**`);
L.push(`- 경계 비율: ${((border / total) * 100).toFixed(1)}% — 안정 상태에서조차 라벨을 확정할 수 없는 요소`);
L.push("");
L.push("| 사이트 | 후보 | 오탐 확정 | 진탐 확정 | 경계 | 안정측정 성공 |");
L.push("|---|---|---|---|---|---|");
for (const r of perSite) {
  L.push(`| ${r.host} | ${r.n} | ${r.fp} | ${r.tp} | ${r.border} | ${r.okRuns}/5 |`);
}
L.push(`| **합계** | **${total}** | **${fp}** | **${tp}** | **${border}** | |`);
L.push("");

fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, "label-verify-summary.md"), L.join("\n") + "\n");
console.log(L.join("\n"));
