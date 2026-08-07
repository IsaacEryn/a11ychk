/**
 * 라벨링 보조 — 오탐/진탐 판정을 위한 "안정 상태" 재측정.
 *
 * 판정 기준(라벨링 리포트와 동일): 해당 요소의 **안정 상태**(애니메이션 종료·실제 폰트
 * 적용) 대비가 기준을 충족하면 자동 보고는 **오탐**, 충족하지 못하면 **진탐**.
 *
 * 사람이 스크린샷을 눈으로 보고 정하는 대신, 같은 엔진(axe color-contrast)으로 안정
 * 상태를 재측정해 그 요소가 여전히 보고되는지를 근거로 라벨을 **제안**한다. 최종 확정은
 * 사람이 한다 — 제안은 근거(대비값·색상·판정 사유)와 함께 출력된다.
 *
 * 안정 상태의 조작적 정의:
 *   reducedMotion 미적용(애니메이션이 실제로 끝나도록 둔다) + 웹폰트 허용 +
 *   document.fonts.ready + 실행 중 애니메이션이 없어질 때까지 대기(최대 8초) + 여유 1.5초
 *
 * ⚠️ 한계: 실험 하네스와 동일하게 image/media를 차단한다(프로덕션 조건과 일치시키기
 * 위함). 배경 이미지 위의 텍스트는 axe가 배경색을 확정하지 못해 판정에서 빠질 수 있다.
 * 이 경우 "판정 보류"로 표시하며, 해당 건은 사람이 직접 확인해야 한다.
 *
 * 실행: node research/contrast-flakiness/label-assist.mjs [--in=exp-out/results-combined.json]
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
const inFile = argOf("in") ?? path.join(OUT, "results-combined.json");

const CONDS = ["rm", "font", "rm+font"];
const results = JSON.parse(fs.readFileSync(inFile, "utf8"));

/**
 * 조건 간 차이가 난 요소를 양방향으로 모은다.
 *   gone  = base에는 있고 제어 조건에는 없음
 *   added = base에는 없고 제어 조건에 있음
 * 어느 쪽이든 "안정 상태에서 실제로 위반인가"를 물어야 오탐/진탐이 갈린다.
 */
function candidatesOf(site) {
  const base = site.conditions?.base;
  if (!base?.ok) return [];
  const baseSet = new Set((base.nodes ?? []).map((n) => n.selector));
  const out = new Map();
  const put = (n, dir, k) => {
    const key = `${dir}|${n.selector}`;
    const cur = out.get(key) ?? { ...n, direction: dir, conds: [] };
    cur.conds.push(k);
    out.set(key, cur);
  };
  for (const k of CONDS) {
    const c = site.conditions?.[k];
    if (!c?.ok) continue;
    const cSet = new Set((c.nodes ?? []).map((n) => n.selector));
    for (const n of base.nodes ?? []) if (!cSet.has(n.selector)) put(n, "gone", k);
    for (const n of c.nodes ?? []) if (!baseSet.has(n.selector)) put(n, "added", k);
  }
  return [...out.values()];
}

/** 안정 상태에서 axe color-contrast 재측정 */
async function measureStable(browser, url) {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    locale: "ko-KR",
    userAgent: "Mozilla/5.0 (compatible; a11ychk-exp/0.1; research)",
    // reducedMotion 미지정 = no-preference (애니메이션이 실제로 끝나게 둔다)
  });
  try {
    const page = await context.newPage();
    await page.route("**/*", (route) => {
      const t = route.request().resourceType();
      if (t === "image" || t === "media") return route.abort(); // 하네스와 동일 조건
      return route.continue();
    });
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 25_000 });
    await page.waitForLoadState("load", { timeout: 8_000 }).catch(() => {});
    await page.evaluate(() => document.fonts?.ready).catch(() => {});
    // 실행 중 애니메이션이 사라질 때까지 — 페이드인이 끝난 상태를 만든다
    await page
      .waitForFunction(() => (document.getAnimations?.() ?? []).every((a) => a.playState !== "running"), {
        timeout: 8_000,
      })
      .catch(() => {});
    await page.waitForTimeout(1_500);

    await page.addScriptTag({ content: AXE_SOURCE });
    const raw = await page.evaluate(
      `window.axe.run(document, { runOnly: { type: "rule", values: ["color-contrast"] }, resultTypes: ["violations", "incomplete"] })`,
    );
    const reported = new Map();
    for (const v of [...(raw.violations ?? [])]) {
      for (const n of v.nodes ?? []) {
        const d = n.any?.[0]?.data ?? {};
        reported.set(Array.isArray(n.target) ? n.target.join(" ") : String(n.target), {
          contrastRatio: d.contrastRatio ?? null,
          fgColor: d.fgColor ?? null,
          bgColor: d.bgColor ?? null,
          expected: d.expectedContrastRatio ?? null,
        });
      }
    }
    // axe가 배경을 확정하지 못한 건 — 판정 보류 대상
    const undetermined = new Set();
    for (const v of raw.incomplete ?? []) {
      for (const n of v.nodes ?? []) {
        undetermined.add(Array.isArray(n.target) ? n.target.join(" ") : String(n.target));
      }
    }
    return { ok: true, reported, undetermined };
  } catch (e) {
    return { ok: false, error: String(e).slice(0, 200), reported: new Map(), undetermined: new Set() };
  } finally {
    await context.close().catch(() => {});
  }
}

const browser = await chromium.launch({ headless: true });
const rows = [];

for (const site of results) {
  const cands = candidatesOf(site);
  if (cands.length === 0) continue;
  process.stdout.write(`▶ ${site.host} — 후보 ${cands.length}건\n`);
  const stable = await measureStable(browser, site.url);
  if (!stable.ok) {
    process.stdout.write(`  안정 상태 측정 실패: ${stable.error}\n`);
    for (const c of cands) rows.push({ host: site.host, url: site.url, ...c, label: "측정 실패", reason: stable.error });
    continue;
  }
  for (const c of cands) {
    const still = stable.reported.get(c.selector);
    const pending = stable.undetermined.has(c.selector);
    let label, reason;
    if (still) {
      label = "진탐";
      reason =
        `안정 상태에서도 위반 (대비 ${still.contrastRatio ?? "?"}, 기준 ${still.expected ?? "?"})` +
        (c.direction === "gone"
          ? " — 제어 조건이 진짜 위반을 가렸다(미탐 유발)"
          : " — 제어 조건이 base가 놓친 위반을 드러냈다(미탐 해소)");
    } else if (pending) {
      label = "판정 보류";
      reason = "안정 상태에서 axe가 배경색을 확정하지 못함(배경 이미지·투명도 등) — 사람이 직접 확인";
    } else {
      label = "오탐";
      reason =
        "안정 상태에서는 위반 아님" +
        (c.direction === "gone" ? " — 제어 조건이 오탐을 걷어냈다" : " — 제어 조건이 오탐을 새로 만들었다");
    }
    rows.push({ host: site.host, url: site.url, ...c, label, reason, stable: still ?? null });
    process.stdout.write(`  ${label.padEnd(6)} ${c.selector.slice(0, 60)}\n`);
  }
}
await browser.close();

// ── 리포트 ──
const counts = rows.reduce((a, r) => ((a[r.label] = (a[r.label] ?? 0) + 1), a), {});
const L = [];
L.push("# 라벨링 보조 — 안정 상태 재측정 결과 (제안)");
L.push("");
L.push("**이 문서는 제안이다. 최종 라벨은 사람이 확정한다.**");
L.push("");
L.push("판정 기준: 안정 상태(애니메이션 종료·실제 폰트 적용)에서 axe color-contrast가");
L.push("해당 요소를 여전히 위반으로 보고하면 **진탐**, 보고하지 않으면 **오탐**.");
L.push("배경색을 확정하지 못한 건은 **판정 보류** — 사람이 직접 확인해야 한다.");
L.push("");
L.push("⚠️ 한계: 실험 하네스와 동일하게 image/media를 차단하고 측정했다. 배경 이미지 위의");
L.push("텍스트는 실제 사용자가 보는 대비와 다를 수 있다. 판정 보류 건이 특히 그렇다.");
L.push("");
L.push(`- 대상 ${rows.length}건 — ${Object.entries(counts).map(([k, v]) => `${k} ${v}`).join(" · ")}`);
L.push("");
L.push("| 사이트 | 방향 | 요소 | 조건 | 발생률 | 제안 라벨 | 근거 |");
L.push("|---|---|---|---|---|---|---|");
for (const r of rows) {
  const inc = r.okRuns > 1 ? `${r.hits}/${r.okRuns}` : "—";
  L.push(
    `| ${r.host} | ${r.direction === "gone" ? "사라짐" : "생김"} | \`${r.selector.slice(0, 44)}\` | ${(r.conds ?? []).join(", ")} | ${inc} | **${r.label}** | ${r.reason} |`,
  );
}
L.push("");
L.push("## 확정용 체크리스트");
L.push("");
L.push("제안에 동의하면 체크만, 다르면 옆에 실제 라벨을 적을 것.");
L.push("");
for (const r of rows) {
  L.push(`- [ ] ${r.host} (${r.direction === "gone" ? "사라짐" : "생김"}) \`${r.selector.slice(0, 55)}\` → 제안: **${r.label}**`);
  L.push(`  - base 측정: ${r.fgColor ?? "?"} on ${r.bgColor ?? "?"} (대비 ${r.contrastRatio ?? "?"})`);
  if (r.stable) L.push(`  - 안정 상태: ${r.stable.fgColor ?? "?"} on ${r.stable.bgColor ?? "?"} (대비 ${r.stable.contrastRatio ?? "?"})`);
  L.push(`  - ${r.reason}`);
}
fs.writeFileSync(path.join(OUT, "labeling-assist.md"), L.join("\n") + "\n");
fs.writeFileSync(path.join(OUT, "labeling-assist.json"), JSON.stringify(rows, null, 2));
console.log(`\n완료 — ${path.join(OUT, "labeling-assist.md")}`);
console.log(Object.entries(counts).map(([k, v]) => `  ${k}: ${v}`).join("\n"));
