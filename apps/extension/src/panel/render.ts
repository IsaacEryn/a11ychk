// 검사 결과 렌더 — 요약·위반 목록(필터)·확인 필요 심사 섹션
import {
  aggregateScan,
  getRuleEntry,
  type Impact,
} from "@a11ychk/core/catalog";
import { applyIncompleteDecision, type IncompleteDecision } from "../incomplete";
import { highlightInPage } from "../injected";
import { announce } from "../ui";
import { msg, pick } from "../i18n";
import { $, AXE_VERSION, state, type PageResult } from "./state";
import { getSession } from "./session";
import { updateScanCache } from "./scan";
import { populateSaveTargets } from "./save";

export const IMPACTS: Impact[] = ["critical", "serious", "moderate", "minor"];
/** 심각도 라벨 — initI18n 이후에 호출되도록 지연 평가(모듈 로드 시점 msg() 금지) */
export function impactLabel(impact: Impact): string {
  return msg({ critical: "impactCritical", serious: "impactSerious", moderate: "impactModerate", minor: "impactMinor" }[impact]);
}

/** 결과가 렌더된 URL — 같은 URL 재렌더(심사 결정 등)면 필터 상태를 유지한다 */
let lastRenderedUrl = "";
/** 위반 목록 필터 — impacts 비어 있으면 전체, ruleId 빈 문자열이면 전체 */
const vFilter = { impacts: new Set<Impact>(), ruleId: "" };

export function renderResult(
  page: PageResult,
  summary: ReturnType<typeof aggregateScan>,
  url: string,
) {
  state.lastPage = page;
  $("intro").hidden = true;
  $("result").hidden = false;
  $("cachedNote").hidden = true;
  $("rate").textContent = String(summary.complianceRate);

  // 같은 URL 재렌더(확인 필요 심사 결정 등)면 필터 상태 유지, 새 페이지면 초기화
  if (lastRenderedUrl !== url) {
    vFilter.impacts.clear();
    vFilter.ruleId = "";
  }
  lastRenderedUrl = url;

  const impact = $("impact");
  impact.innerHTML = "";
  for (const key of IMPACTS) {
    const li = document.createElement("li");
    const label = document.createElement("span");
    label.textContent = impactLabel(key);
    const val = document.createElement("b");
    val.textContent = String(summary.byImpact[key]);
    li.append(label, val);
    impact.appendChild(li);
  }

  renderViolationFilter(page, summary);
  renderViolationList();
  renderIncompleteSection();

  // 연결돼 있으면 저장 버튼·프로세스 태그·저장 위치 선택 노출
  getSession().then((s) => {
    $("save").hidden = !s;
    $("procWrap").hidden = !s;
    $("saveDest").hidden = !s;
    if (s) void populateSaveTargets(s.accessToken, url);
  });
}

/** 위반 목록 필터 바 — 심각도 칩(개수)·규칙 셀렉트. 결과가 있을 때만 표시 */
function renderViolationFilter(
  page: PageResult,
  summary: ReturnType<typeof aggregateScan>,
) {
  const bar = $("vFilter");
  const chips = $("vImpactChips");
  const ruleSel = $<HTMLSelectElement>("vRule");
  const hasViolations = page.violations.length > 0;
  bar.hidden = !hasViolations;
  if (!hasViolations) return;

  chips.innerHTML = "";
  for (const key of IMPACTS) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "chip chip-sm";
    btn.textContent = `${impactLabel(key)} ${summary.byImpact[key]}`;
    btn.setAttribute("aria-pressed", String(vFilter.impacts.has(key)));
    btn.addEventListener("click", () => {
      if (vFilter.impacts.has(key)) vFilter.impacts.delete(key);
      else vFilter.impacts.add(key);
      btn.setAttribute("aria-pressed", String(vFilter.impacts.has(key)));
      renderViolationList();
    });
    chips.appendChild(btn);
  }

  // 규칙별 셀렉트 — 규칙 제목(요소 수)
  ruleSel.innerHTML = "";
  const all = document.createElement("option");
  all.value = "";
  all.textContent = msg("filterRuleAll");
  ruleSel.appendChild(all);
  const byRule = new Map<string, { count: number; title: string }>();
  for (const v of page.violations) {
    const prev = byRule.get(v.ruleId);
    byRule.set(v.ruleId, {
      count: (prev?.count ?? 0) + v.nodes.length,
      title: prev?.title ?? pick(getRuleEntry(v.ruleId, v.tags).title),
    });
  }
  for (const [ruleId, info] of byRule) {
    const opt = document.createElement("option");
    opt.value = ruleId;
    opt.textContent = `${info.title} (${info.count})`;
    ruleSel.appendChild(opt);
  }
  ruleSel.value = vFilter.ruleId && byRule.has(vFilter.ruleId) ? vFilter.ruleId : "";
  vFilter.ruleId = ruleSel.value;
  ruleSel.onchange = () => {
    vFilter.ruleId = ruleSel.value;
    renderViolationList();
  };
}

/** 위반 상세 목록 렌더 — vFilter 상태를 반영해 목록만 다시 그린다 */
function renderViolationList() {
  const page = state.lastPage;
  const list = $("violations");
  list.innerHTML = "";
  if (!page) return;
  const sorted = [...page.violations].sort(
    (a, b) => IMPACTS.indexOf(a.impact) - IMPACTS.indexOf(b.impact),
  );
  if (sorted.length === 0) {
    const li = document.createElement("li");
    li.textContent = msg("noViolations");
    li.style.borderColor = "var(--seal)";
    list.appendChild(li);
    return;
  }
  const filtered = sorted.filter(
    (v) =>
      (vFilter.impacts.size === 0 || vFilter.impacts.has(v.impact)) &&
      (!vFilter.ruleId || v.ruleId === vFilter.ruleId),
  );
  if (filtered.length === 0) {
    const li = document.createElement("li");
    li.textContent = msg("filterEmpty");
    list.appendChild(li);
    return;
  }
  const tabId = state.currentTabId;
  for (const v of filtered) {
    const entry = getRuleEntry(v.ruleId, v.tags);
    const li = document.createElement("li");
    const title = document.createElement("p");
    title.className = "vt";
    const badge = document.createElement("span");
    badge.className = "badge";
    badge.textContent = impactLabel(v.impact);
    title.append(badge, document.createTextNode(pick(entry.title)));
    const meta = document.createElement("p");
    meta.className = "vmeta";
    meta.textContent =
      msg("nodeCount", [v.nodes.length]) +
      (entry.wcag.length ? ` · WCAG ${entry.wcag.join(", ")}` : "") +
      (entry.kwcag.length ? ` · KWCAG ${entry.kwcag.join(", ")}` : "");
    li.append(title, meta);

    // 위반 요소 목록 (최대 3) — msg("show") 버튼으로 페이지에서 강조
    const nodesUl = document.createElement("ul");
    nodesUl.className = "vnodes";
    for (const node of v.nodes.slice(0, 3)) {
      const nli = document.createElement("li");
      const sel = document.createElement("code");
      sel.textContent = node.selector;
      sel.title = node.html;
      nli.appendChild(sel);
      if (tabId) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "locate";
        btn.textContent = msg("show");
        btn.setAttribute("aria-label", msg("showAria", [node.selector]));
        btn.addEventListener("click", async () => {
          try {
            const r = await chrome.scripting.executeScript({
              target: { tabId },
              args: [node.selector],
              func: highlightInPage,
            });
            const found = Boolean(r[0]?.result);
            btn.textContent = found ? msg("shown") : msg("notFound");
            // 버튼 텍스트 교체만으로는 스크린리더에 결과가 전달되지 않음 — 라이브 리전 고지
            announce(found ? msg("srShown") : msg("srNotFound"));
          } catch {
            btn.textContent = msg("failedShort");
            announce(msg("srNotFound"));
          }
          setTimeout(() => (btn.textContent = msg("show")), 2500);
        });
        nli.appendChild(btn);
      }
      nodesUl.appendChild(nli);
    }
    if (v.nodes.length > 3) {
      const more = document.createElement("li");
      more.className = "vmore";
      more.textContent = msg("moreNodes", [v.nodes.length - 3]);
      nodesUl.appendChild(more);
    }
    li.appendChild(nodesUl);

    // 개선 가이드 (첫 단락) — 접기형
    const guideFirst = pick(entry.guide).split("\n\n")[0]?.trim();
    if (guideFirst) {
      const details = document.createElement("details");
      details.className = "vguide";
      const summaryEl = document.createElement("summary");
      summaryEl.textContent = msg("guide");
      const p = document.createElement("p");
      p.textContent = guideFirst;
      details.append(summaryEl, p);
      li.appendChild(details);
    }

    list.appendChild(li);
  }
}

/** 확인 필요(incomplete) 심사 섹션 — 항목별 확인 후 위반 확정/문제없음 결정 */
function renderIncompleteSection() {
  const sec = $<HTMLDetailsElement>("incompleteSec");
  const list = $("incompleteList");
  const page = state.lastPage;
  const ids = page?.incomplete ?? [];
  $("incompleteCount").textContent = String(ids.length);
  sec.hidden = !page || ids.length === 0;
  list.innerHTML = "";
  if (!page || ids.length === 0) return;

  const tabId = state.currentTabId;
  for (const id of ids) {
    const finding = state.lastIncomplete.find((f) => f.ruleId === id) ?? null;
    const entry = getRuleEntry(id, finding?.tags ?? []);
    const li = document.createElement("li");

    const title = document.createElement("p");
    title.className = "vt";
    const badge = document.createElement("span");
    badge.className = "badge";
    badge.textContent = finding ? impactLabel(finding.impact) : msg("incompleteTitle");
    title.append(badge, document.createTextNode(pick(entry.title)));
    li.appendChild(title);

    if (finding && finding.nodes.length > 0) {
      const meta = document.createElement("p");
      meta.className = "vmeta";
      meta.textContent = msg("nodeCount", [finding.nodes.length]);
      li.appendChild(meta);
    }

    // 확인 방법 힌트 — 규칙 가이드 첫 단락 (위반 목록과 동일 패턴)
    const guideFirst = pick(entry.guide).split("\n\n")[0]?.trim();
    if (guideFirst) {
      const details = document.createElement("details");
      details.className = "vguide";
      const summaryEl = document.createElement("summary");
      summaryEl.textContent = msg("guide");
      const p = document.createElement("p");
      p.textContent = guideFirst;
      details.append(summaryEl, p);
      li.appendChild(details);
    }

    const actions = document.createElement("div");
    actions.className = "inc-actions";
    if (tabId && finding && finding.nodes.length > 0) {
      const showBtn = document.createElement("button");
      showBtn.type = "button";
      showBtn.className = "locate";
      showBtn.textContent = msg("show");
      const combined = finding.nodes.map((n) => n.selector).join(", ");
      showBtn.addEventListener("click", async () => {
        try {
          const r = await chrome.scripting.executeScript({
            target: { tabId },
            args: [combined],
            func: highlightInPage,
          });
          const found = Boolean(r[0]?.result);
          showBtn.textContent = found ? msg("shown") : msg("notFound");
          announce(found ? msg("srShown") : msg("srNotFound"));
        } catch {
          showBtn.textContent = msg("failedShort");
        }
        setTimeout(() => (showBtn.textContent = msg("show")), 2500);
      });
      actions.appendChild(showBtn);
    }
    const failBtn = document.createElement("button");
    failBtn.type = "button";
    failBtn.className = "verdict v-failed";
    failBtn.textContent = msg("incompleteConfirmFail");
    failBtn.addEventListener("click", () => void decideIncomplete(id, "failed"));
    const passBtn = document.createElement("button");
    passBtn.type = "button";
    passBtn.className = "verdict v-passed";
    passBtn.textContent = msg("incompleteConfirmPass");
    passBtn.addEventListener("click", () => void decideIncomplete(id, "passed"));
    actions.append(failBtn, passBtn);
    li.appendChild(actions);

    list.appendChild(li);
  }
}

/** 확인 필요 항목 심사 결정 반영 — 점수 재계산 + 재렌더(같은 URL이라 필터 유지) */
async function decideIncomplete(ruleId: string, decision: IncompleteDecision) {
  if (!state.lastPage) return;
  applyIncompleteDecision(state.lastPage, state.lastIncomplete, ruleId, decision);
  state.incompleteDecisions[ruleId] = decision;
  const summary = aggregateScan([state.lastPage], AXE_VERSION);
  renderResult(state.lastPage, summary, state.lastPage.url);
  updateScanCache();
  announce(msg(decision === "failed" ? "srIncompleteFail" : "srIncompletePass"));
}
