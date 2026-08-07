/**
 * 논문 B 실험 하네스 — 명도 대비 오탐에 대한 렌더링 상태 제어 2요인 실험.
 * 조건: F1 reducedMotion(off/on) × F2 웹폰트(차단/허용) = 사이트당 4조건.
 * 고정: 뷰포트 1280×800, image/media 차단(프로덕션 동일), 대기 전략 동일.
 * 산출: exp-out/results.json + exp-out/labeling-report.md (+ 위반 요소 스크린샷)
 *
 * 실행(저장소 루트):
 *   본 실험:  node research/contrast-flakiness/contrast-falsepos.mjs [--sites=N] [--runs=K] [--candidates=파일]
 *     --runs=K       조건당 K회 반복(기본 1). 파일럿에서 확인된 실행 간 변동(1↔14건) 때문에
 *                    본 실험은 K≥5로 요소별 "발생률(K회 중 보고 횟수)"을 측정한다.
 *     --candidates=F 대상 URL 목록 파일(줄당 1개, # 주석). **필수**.
 *   스크리닝:  node research/contrast-flakiness/contrast-falsepos.mjs --screen [--candidates=파일]
 *     로드 시 진행 중인 애니메이션/오파시티 전환을 탐지해 "페이드인 확인 사이트"를 선별
 *     (표본 구성용 — 본 실험 설계 관찰 2 반영). 산출: exp-out/screening-report.md
 */
import { chromium } from "playwright";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const AXE_SOURCE = fs.readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), "exp-out");

const CONDITIONS = [
  { key: "base",    reducedMotion: false, blockFonts: true  }, // 대조군 (두 제어 모두 off)
  { key: "rm",      reducedMotion: true,  blockFonts: true  }, // RM만 on
  { key: "font",    reducedMotion: false, blockFonts: false }, // 폰트 허용만 on
  // 웹 서비스(apps/web/src/lib/scan/runScan.ts)의 현행 조건에 대응 — 단 프로덕션은
  // document.fonts.ready 대기(최대 3초)를 추가로 수행하므로 이 조건과 완전히 같지는 않다.
  { key: "rm+font", reducedMotion: true,  blockFonts: false }, // RM on + 폰트 허용
];

const MAX_SHOTS_PER_COND = 15;

async function scanOnce(browser, url, cond, shotDir) {
  const context = await browser.newContext({
    reducedMotion: cond.reducedMotion ? "reduce" : "no-preference",
    viewport: { width: 1280, height: 800 },
    locale: "ko-KR",
    userAgent: "Mozilla/5.0 (compatible; a11ychk-exp/0.1; research)",
  });
  try {
    const page = await context.newPage();
    await page.route("**/*", (route) => {
      const type = route.request().resourceType();
      if (type === "image" || type === "media") return route.abort(); // 고정 (프로덕션 동일)
      if (cond.blockFonts && type === "font") return route.abort();   // F2
      return route.continue();
    });
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 25_000 });
    await page.waitForLoadState("load", { timeout: 8_000 }).catch(() => {});

    await page.addScriptTag({ content: AXE_SOURCE });
    const raw = await page.evaluate(
      `window.axe.run(document, { runOnly: { type: "rule", values: ["color-contrast"] }, resultTypes: ["violations"] })`,
    );

    const nodes = [];
    for (const v of raw.violations ?? []) {
      for (const n of v.nodes ?? []) {
        const data = n.any?.[0]?.data ?? {};
        nodes.push({
          selector: Array.isArray(n.target) ? n.target.join(" ") : String(n.target),
          fgColor: data.fgColor ?? null,
          bgColor: data.bgColor ?? null,
          contrastRatio: data.contrastRatio ?? null,
          fontSize: data.fontSize ?? null,
          fontWeight: data.fontWeight ?? null,
          html: (n.html ?? "").slice(0, 160),
        });
      }
    }

    // 요소 스크린샷 (라벨링 보조 — 상한 내)
    fs.mkdirSync(shotDir, { recursive: true });
    for (let i = 0; i < Math.min(nodes.length, MAX_SHOTS_PER_COND); i++) {
      const node = nodes[i];
      try {
        const loc = page.locator(node.selector).first();
        await loc.scrollIntoViewIfNeeded({ timeout: 1500 });
        const file = path.join(shotDir, `${i}.jpg`);
        await loc.screenshot({ path: file, type: "jpeg", quality: 70, timeout: 4000 });
        node.shot = path.relative(OUT, file);
      } catch {
        /* 캡처 실패 무시 */
      }
    }
    return { ok: true, nodes };
  } catch (e) {
    return { ok: false, error: String(e).slice(0, 200), nodes: [] };
  } finally {
    await context.close().catch(() => {});
  }
}

function diffSelectors(a, b) {
  const setB = new Set(b.map((n) => n.selector));
  return a.filter((n) => !setB.has(n.selector));
}

// ── CLI 인자 ──
const argOf = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=")[1];
const RUNS = Math.max(1, Number(argOf("runs")) || 1);
const SCREEN_MODE = process.argv.includes("--screen");
const candidatesFile = argOf("candidates");
if (!candidatesFile) {
  console.error("--candidates=<파일> 필수 — 대상 URL 목록(줄당 1개, # 주석 허용)을 지정할 것");
  process.exit(2);
}
const candidateSites = fs
  .readFileSync(candidatesFile, "utf8")
  .split("\n")
  .map((l) => l.trim())
  .filter((l) => l && !l.startsWith("#"));
const limit = Number(argOf("sites")) || candidateSites.length;
const sites = candidateSites.slice(0, limit);

// ── 스크리닝 모드 — 로드 시 애니메이션·오파시티 전환 활동을 탐지해 표본 후보 선별 ──
async function screenSite(browser, url) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: "ko-KR" });
  try {
    const page = await context.newPage();
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 25_000 });
    // 로드 직후(애니메이션 진행 가능 시점) 측정 — RM 미적용 상태
    const probe = await page.evaluate(() => {
      const anims = document.getAnimations?.() ?? [];
      const running = anims.filter((a) => a.playState === "running").length;
      // opacity/transform을 다루는 CSS 애니메이션·전환 요소 수 (페이드인 신호)
      let opacityAnimated = 0;
      for (const el of document.querySelectorAll("body *")) {
        const cs = getComputedStyle(el);
        if (
          (cs.animationName !== "none" && cs.animationDuration !== "0s") ||
          (cs.transitionProperty.includes("opacity") && cs.transitionDuration !== "0s")
        ) {
          opacityAnimated++;
          if (opacityAnimated > 200) break; // 상한 (대형 페이지 보호)
        }
      }
      return { running, opacityAnimated };
    });
    // 1.5초 후 재측정 — 로드 시점에만 도는 애니메이션(페이드인)인지 상시 애니메이션인지 구분
    await page.waitForTimeout(1500);
    const later = await page.evaluate(() => (document.getAnimations?.() ?? []).filter((a) => a.playState === "running").length);
    return { ok: true, ...probe, runningLater: later };
  } catch (e) {
    return { ok: false, error: String(e).slice(0, 160) };
  } finally {
    await context.close().catch(() => {});
  }
}

const browser = await chromium.launch({ headless: true });

if (SCREEN_MODE) {
  const rows = [];
  for (const url of sites) {
    const host = new URL(url).hostname.replace(/^www\./, "");
    const r = await screenSite(browser, url);
    rows.push({ url, host, ...r });
    process.stdout.write(`▶ ${host.padEnd(28)} ${r.ok ? `애니메이션 ${r.running}(로드)→${r.runningLater}(1.5s) · 오파시티 후보 ${r.opacityAnimated}` : `실패: ${r.error}`}\n`);
  }
  await browser.close();
  fs.mkdirSync(OUT, { recursive: true });
  const S = ["# 표본 스크리닝 — 로드 시 페이드인 후보 (본 실험 대상 선별)", ""];
  S.push("선별 기준: 로드 시 실행 중 애니메이션 > 0 **또는** 오파시티 전환 요소 > 0 → 본 실험 표본 후보.");
  S.push("로드→1.5s 비교로 '로드 시에만 도는' 페이드인(대상)과 상시 애니메이션(통제 필요)을 구분한다.");
  S.push("");
  S.push("| 사이트 | 로드 시 실행 | 1.5s 후 | 오파시티 후보 | 판정 |");
  S.push("|---|---|---|---|---|");
  for (const r of rows.sort((a, b) => (b.running ?? -1) - (a.running ?? -1))) {
    const verdict = !r.ok ? "측정 실패" : r.running > 0 || r.opacityAnimated > 0 ? "**후보**" : "제외";
    S.push(`| ${r.host} | ${r.ok ? r.running : "—"} | ${r.ok ? r.runningLater : "—"} | ${r.ok ? r.opacityAnimated : "—"} | ${verdict} |`);
  }
  fs.writeFileSync(path.join(OUT, "screening-report.md"), S.join("\n") + "\n");
  console.log(`\n완료 — ${path.join(OUT, "screening-report.md")}`);
  process.exit(0);
}

// ── 본 실험 — 조건당 RUNS회 반복, 요소별 발생률 집계 ──
const results = [];
for (const url of sites) {
  const host = new URL(url).hostname.replace(/^www\./, "");
  process.stdout.write(`\n▶ ${host} (조건당 ${RUNS}회)\n`);
  const bySite = { url, host, runs: RUNS, conditions: {} };
  for (const cond of CONDITIONS) {
    // 반복 실행 — 스크린샷은 1회차만 캡처(라벨링 보조 목적, 시간 절약)
    const runsOut = [];
    for (let k = 0; k < RUNS; k++) {
      const shotDir = k === 0 ? path.join(OUT, "shots", host, cond.key) : null;
      const r = await scanOnce(browser, url, cond, shotDir ?? path.join(OUT, "shots", "_skip"));
      runsOut.push(r);
    }
    // 요소(selector)별 발생률: RUNS회 중 보고된 횟수. 0<발생률<1 = 비결정 위반(오탐 후보 핵심 신호)
    const bySelector = new Map();
    for (const r of runsOut) {
      if (!r.ok) continue;
      for (const n of r.nodes) {
        const cur = bySelector.get(n.selector) ?? { ...n, hits: 0 };
        cur.hits += 1;
        bySelector.set(n.selector, cur);
      }
    }
    const okRuns = runsOut.filter((r) => r.ok).length;
    const incidence = [...bySelector.values()].map((n) => ({ ...n, incidence: okRuns > 0 ? n.hits / okRuns : 0, okRuns }));
    const flaky = incidence.filter((n) => n.incidence > 0 && n.incidence < 1).length;
    bySite.conditions[cond.key] = {
      ok: okRuns > 0,
      okRuns,
      totalRuns: RUNS,
      // 하위 호환: nodes = 1회 이상 보고된 전체 (기존 diff 로직 재사용)
      nodes: incidence,
      error: okRuns === 0 ? runsOut[0]?.error : undefined,
    };
    process.stdout.write(
      `  ${cond.key.padEnd(8)} ${okRuns > 0 ? `요소 ${incidence.length}건 (성공 ${okRuns}/${RUNS}회${flaky > 0 ? `, 비결정 ${flaky}건` : ""})` : `실패: ${runsOut[0]?.error}`}\n`,
    );
  }
  results.push(bySite);
}
await browser.close();

fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, "results.json"), JSON.stringify(results, null, 2));

// ── 라벨링 리포트 ──
const L = [];
L.push("# 명도 대비 오탐 실험 — 라벨링 리포트 (파일럿)");
L.push("");
L.push("조건: base=RM꺼짐·폰트차단 / rm=RM켜짐·폰트차단(현행) / font=RM꺼짐·폰트허용 / rm+font=RM켜짐·폰트허용");
L.push("라벨 기준: 해당 요소의 **안정 상태(애니메이션 종료·실제 폰트)** 대비가 기준(일반 4.5:1, 대형 3:1)을 충족하면 → 자동 보고는 **오탐**. 충족하지 못하면 **진탐**.");
L.push("");
L.push("| 사이트 | base | rm | font | rm+font |");
L.push("|---|---|---|---|---|");
for (const s of results) {
  const c = (k) => (s.conditions[k]?.ok ? s.conditions[k].nodes.length : "실패");
  L.push(`| ${s.host} | ${c("base")} | ${c("rm")} | ${c("font")} | ${c("rm+font")} |`);
}
L.push("");
for (const s of results) {
  const base = s.conditions["base"];
  const rm = s.conditions["rm"];
  const font = s.conditions["font"];
  if (!base?.ok) continue;

  // F1 효과: base에만 있고 rm에는 없는 위반 = RM으로 사라진 케이스 (오탐 후보)
  const rmDiff = rm?.ok ? diffSelectors(base.nodes, rm.nodes) : [];
  // F2 효과: base에만 있고 font에는 없는 위반 = 실폰트 로드로 사라진 케이스 (오탐 후보)
  const fontDiff = font?.ok ? diffSelectors(base.nodes, font.nodes) : [];
  // 역방향(기법 적용 시 새로 생긴 위반)도 기록 — 미탐 위험 평가용
  const rmNew = rm?.ok ? diffSelectors(rm.nodes, base.nodes) : [];
  const fontNew = font?.ok ? diffSelectors(font.nodes, base.nodes) : [];

  if (rmDiff.length + fontDiff.length + rmNew.length + fontNew.length === 0) continue;
  L.push(`## ${s.host}`);
  const section = (title, arr) => {
    if (arr.length === 0) return;
    L.push(`### ${title} (${arr.length}건)`);
    for (const n of arr) {
      const inc = n.incidence !== undefined && n.okRuns > 1 ? ` · 발생률 ${n.hits}/${n.okRuns}` : "";
      L.push(`- [ ] 오탐 / [ ] 진탐 — \`${n.selector}\`${inc}`);
      L.push(`  - 색상 ${n.fgColor ?? "?"} on ${n.bgColor ?? "?"} (대비 ${n.contrastRatio ?? "?"}), ${n.fontSize ?? "?"} / weight ${n.fontWeight ?? "?"}${n.shot ? ` · 캡처 shots 참조: ${n.shot}` : ""}`);
      L.push(`  - \`${n.html.replaceAll("`", "'")}\``);
    }
  };
  section("RM 적용으로 사라진 위반 (애니메이션 기인 오탐 후보)", rmDiff);
  section("폰트 허용으로 사라진 위반 (폰트 폴백 기인 오탐 후보)", fontDiff);
  section("RM 적용 시 새로 생긴 위반 (미탐 위험 점검)", rmNew);
  section("폰트 허용 시 새로 생긴 위반 (미탐 위험 점검)", fontNew);
  L.push("");
}
fs.writeFileSync(path.join(OUT, "labeling-report.md"), L.join("\n") + "\n");
console.log(`\n완료 — ${path.join(OUT, "labeling-report.md")}`);
