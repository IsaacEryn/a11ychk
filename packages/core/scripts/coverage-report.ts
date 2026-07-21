/**
 * 자동 검사 커버리지 정량화 리포트 생성기.
 *
 * 규칙 카탈로그(RULE_CATALOG)의 WCAG/KWCAG 매핑을 집계해 "자동 검사가 어디까지
 * 커버하고 어디부터 수동인가"를 표로 산출한다. 결과는 docs/coverage.md(.json)로
 * 저장되어 ① 서비스 문서(정직한 자동화의 근거) ② 연구 인용용 재현 가능한 수치가 된다.
 *
 * 용어(중요): "자동 검출 가능"은 해당 기준의 **위반을 검출할 수 있는 자동 규칙이
 * 1개 이상 존재**한다는 뜻이다. 자동 통과가 기준 전체의 준수를 보장한다는 뜻이
 * 아니다(부분 커버) — KWCAG의 autoCoverage full/partial 구분이 이를 명시한다.
 *
 * 실행: npm run coverage -w @a11ychk/core
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { RULE_CATALOG } from "../src/catalog/rules";
import { WCAG_CRITERIA } from "../src/catalog/wcag";
import { KWCAG_ITEMS } from "../src/catalog/kwcag";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

// ── 규칙 → 기준 매핑 집계 ──
const isCustom = (ruleId: string) => ruleId.startsWith("a11ychk");
const byWcag = new Map<string, { axe: string[]; custom: string[] }>();
const byKwcag = new Map<string, { axe: string[]; custom: string[] }>();
for (const rule of RULE_CATALOG) {
  const bucket = isCustom(rule.ruleId) ? "custom" : "axe";
  for (const sc of rule.wcag) {
    const cur = byWcag.get(sc) ?? { axe: [], custom: [] };
    cur[bucket].push(rule.ruleId);
    byWcag.set(sc, cur);
  }
  for (const item of rule.kwcag) {
    const cur = byKwcag.get(item) ?? { axe: [], custom: [] };
    cur[bucket].push(rule.ruleId);
    byKwcag.set(item, cur);
  }
}

// ── WCAG 2.2 A/AA 성공기준별 분류 ──
const PRINCIPLE_KO: Record<string, string> = {
  perceivable: "인식의 용이성",
  operable: "운용의 용이성",
  understandable: "이해의 용이성",
  robust: "견고성",
};
const wcagRows = WCAG_CRITERIA.map((c) => {
  const rules = byWcag.get(c.id) ?? { axe: [], custom: [] };
  const total = rules.axe.length + rules.custom.length;
  return {
    id: c.id,
    name: c.name.ko,
    level: c.level,
    principle: c.principle,
    axeRules: rules.axe.length,
    customRules: rules.custom.length,
    coverage: total > 0 ? ("automated" as const) : ("manual-only" as const),
  };
});
const covered = wcagRows.filter((r) => r.coverage === "automated");
const pct = (n: number, d: number) => (d === 0 ? 0 : Math.round((n / d) * 1000) / 10);

// ── KWCAG 33항목 분류 (카탈로그의 autoCoverage 명시 필드 사용) ──
const kwcagRows = KWCAG_ITEMS.map((item) => {
  const rules = byKwcag.get(item.id) ?? { axe: [], custom: [] };
  return {
    id: item.id,
    name: item.name.ko,
    autoCoverage: item.autoCoverage,
    axeRules: rules.axe.length,
    customRules: rules.custom.length,
  };
});
const kwcagByCoverage = { full: 0, partial: 0, none: 0 } as Record<string, number>;
for (const r of kwcagRows) kwcagByCoverage[r.autoCoverage] = (kwcagByCoverage[r.autoCoverage] ?? 0) + 1;

// ── 산출물 ──
const totalRules = RULE_CATALOG.length;
const customRuleCount = RULE_CATALOG.filter((r) => isCustom(r.ruleId)).length;
const summary = {
  generatedFrom: "packages/core/src/catalog (RULE_CATALOG, WCAG_CRITERIA, KWCAG_ITEMS)",
  rules: { total: totalRules, axe: totalRules - customRuleCount, custom: customRuleCount },
  wcag: {
    totalCriteria: wcagRows.length,
    automated: covered.length,
    manualOnly: wcagRows.length - covered.length,
    automatedPct: pct(covered.length, wcagRows.length),
    byLevel: (["A", "AA"] as const).map((lv) => {
      const rows = wcagRows.filter((r) => r.level === lv);
      const auto = rows.filter((r) => r.coverage === "automated").length;
      return { level: lv, total: rows.length, automated: auto, automatedPct: pct(auto, rows.length) };
    }),
    byPrinciple: Object.keys(PRINCIPLE_KO).map((p) => {
      const rows = wcagRows.filter((r) => r.principle === p);
      const auto = rows.filter((r) => r.coverage === "automated").length;
      return { principle: p, total: rows.length, automated: auto, automatedPct: pct(auto, rows.length) };
    }),
  },
  kwcag: {
    totalItems: kwcagRows.length,
    full: kwcagByCoverage.full,
    partial: kwcagByCoverage.partial,
    none: kwcagByCoverage.none,
    anyAutomationPct: pct(kwcagByCoverage.full + kwcagByCoverage.partial, kwcagRows.length),
  },
};

fs.writeFileSync(
  path.join(ROOT, "docs", "coverage.json"),
  JSON.stringify({ summary, wcag: wcagRows, kwcag: kwcagRows }, null, 2) + "\n",
);

const M: string[] = [];
M.push("# 자동 검사 커버리지 (생성 문서 — 수정 금지)");
M.push("");
M.push("`npm run coverage -w @a11ychk/core`가 규칙 카탈로그에서 생성한다. 카탈로그가 바뀌면 재생성할 것.");
M.push("");
M.push('**"자동 검출 가능" = 해당 기준의 위반을 검출하는 자동 규칙이 1개 이상 존재.**');
M.push("자동 통과가 기준 전체 준수를 보장한다는 뜻이 아니다 — 자동화의 한계를 정직하게 표시하기 위한 지표다.");
M.push("");
M.push("## 요약");
M.push("");
M.push(`- 규칙: 총 **${summary.rules.total}개** (axe-core ${summary.rules.axe} + 자체 규칙 ${summary.rules.custom})`);
M.push(
  `- WCAG 2.2 A/AA **${summary.wcag.totalCriteria}개 성공기준** 중 자동 검출 가능 **${summary.wcag.automated}개 (${summary.wcag.automatedPct}%)** · 수동 전용 ${summary.wcag.manualOnly}개`,
);
M.push(
  `- KWCAG 2.2 **33개 검사항목** 중 완전 자동 ${summary.kwcag.full} · 부분 자동 ${summary.kwcag.partial} · 수동 전용 ${summary.kwcag.none} (자동화 관여 ${summary.kwcag.anyAutomationPct}%)`,
);
M.push("");
M.push("| 구분 | 기준 수 | 자동 검출 가능 | 비율 |");
M.push("|---|---|---|---|");
for (const lv of summary.wcag.byLevel) M.push(`| WCAG 레벨 ${lv.level} | ${lv.total} | ${lv.automated} | ${lv.automatedPct}% |`);
for (const p of summary.wcag.byPrinciple)
  M.push(`| ${PRINCIPLE_KO[p.principle]} | ${p.total} | ${p.automated} | ${p.automatedPct}% |`);
M.push("");
M.push("## WCAG 2.2 성공기준별");
M.push("");
M.push("| SC | 이름 | 레벨 | axe 규칙 | 자체 규칙 | 분류 |");
M.push("|---|---|---|---|---|---|");
for (const r of wcagRows)
  M.push(
    `| ${r.id} | ${r.name} | ${r.level} | ${r.axeRules || "—"} | ${r.customRules || "—"} | ${r.coverage === "automated" ? "자동 검출 가능" : "**수동 전용**"} |`,
  );
M.push("");
M.push("## KWCAG 2.2 검사항목별");
M.push("");
M.push("| 항목 | 이름 | 자동화 | axe 규칙 | 자체 규칙 |");
M.push("|---|---|---|---|---|");
const KW_LABEL: Record<string, string> = { full: "완전 자동", partial: "부분 자동", none: "**수동 전용**" };
for (const r of kwcagRows)
  M.push(`| ${r.id} | ${r.name} | ${KW_LABEL[r.autoCoverage]} | ${r.axeRules || "—"} | ${r.customRules || "—"} |`);
M.push("");
fs.writeFileSync(path.join(ROOT, "docs", "coverage.md"), M.join("\n"));

console.log(
  `coverage: WCAG ${summary.wcag.automated}/${summary.wcag.totalCriteria} (${summary.wcag.automatedPct}%) 자동 검출 가능 · ` +
    `KWCAG full ${summary.kwcag.full}/partial ${summary.kwcag.partial}/none ${summary.kwcag.none} · 규칙 ${summary.rules.total}개 → docs/coverage.md`,
);
