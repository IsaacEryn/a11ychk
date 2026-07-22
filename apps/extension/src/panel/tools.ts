// ─── 시각 도구 컨트롤러 (패널 측 상태 + 주입 실행) ───
import type { Impact } from "@a11ychk/core/catalog";
import {
  applySimulationInPage,
  clearOverlayInPage,
  installOverlayHelpersInPage,
  linearizeInPage,
  overlayMarkersInPage,
  overlayQueryInPage,
  overlayStructureInPage,
  overlayTargetSizeInPage,
} from "../injected";
import { announce } from "../ui";
import { msg } from "../i18n";
import { $, getActiveTab, state } from "./state";
import { impactLabel } from "./render";
import { renderManual, setReview, type Verdict } from "./review";
import { exportAiFix } from "./save";

type StructKind = "headings" | "landmarks" | "focus" | "targets";
type OverlayView = "none" | "issues" | StructKind | "manual";

/** 오버레이·시뮬·선형화 토글 상태 — 부트스트랩(탭 전환 리셋)과 공유하므로 객체 필드로 관리 */
export const toolState = {
  currentView: "none" as OverlayView,
  currentSim: "none",
  linearizeOn: false,
  activeHighlightBtn: null as HTMLButtonElement | null,
};

/** 활성 탭에 주입 함수 실행 */
async function runInPage<Args extends unknown[], R>(
  func: (...args: Args) => R,
  ...args: Args
): Promise<Awaited<R> | undefined> {
  if (!state.currentTabId) return undefined;
  try {
    // chrome.scripting은 주입 함수가 Promise를 반환하면 값을 resolve해 전달한다
    const r = await chrome.scripting.executeScript({ target: { tabId: state.currentTabId }, func, args });
    return r[0]?.result as Awaited<R> | undefined;
  } catch {
    return undefined;
  }
}

/** 오버레이 계열 주입 — 공용 헬퍼(컨테이너·재배치 추종)를 먼저 설치한 뒤 실행 */
async function runOverlayInPage<Args extends unknown[], R>(
  func: (...args: Args) => R,
  ...args: Args
): Promise<Awaited<R> | undefined> {
  await runInPage(installOverlayHelpersInPage);
  return runInPage(func, ...args);
}

const MARKER_COLOR: Record<Impact, string> = {
  critical: "#e0533d",
  serious: "#e0533d",
  moderate: "#8a8a8a",
  minor: "#8a8a8a",
};

/** 오버레이만 지우고 시뮬레이션·선형화는 복원 (오버레이는 단일이라 서로 배타적) */
async function clearOverlayView() {
  await runInPage(clearOverlayInPage);
  toolState.currentView = "none";
  $("focusJudge").hidden = true;
  if (toolState.currentSim !== "none") await runInPage(applySimulationInPage, toolState.currentSim);
  if (toolState.linearizeOn) await runInPage(linearizeInPage, true);
}

/** 위반 표시 토글 (검사 결과 필요) */
async function setIssuesView(on: boolean) {
  if (on && state.lastPage) {
    const markers = state.lastPage.violations.flatMap((v) =>
      v.nodes.map((n) => ({
        selector: n.selector,
        color: MARKER_COLOR[v.impact],
        label: impactLabel(v.impact),
      })),
    );
    await runOverlayInPage(overlayMarkersInPage, markers);
    toolState.currentView = "issues";
  } else {
    await clearOverlayView();
  }
  syncToolButtons();
}

/** 구조·크기 오버레이 토글 */
async function setStructView(kind: StructKind, on: boolean) {
  if (on) {
    if (kind === "targets") await runOverlayInPage(overlayTargetSizeInPage);
    else await runOverlayInPage(overlayStructureInPage, kind, msg("skippedLabel"));
    toolState.currentView = kind;
  } else {
    await clearOverlayView();
  }
  // 초점 순서 오버레이가 켜진 동안만 6.1.2 판정 카드 노출 (확인→판정 즉시 기입)
  $("focusJudge").hidden = !(on && kind === "focus");
  if (on && kind === "focus") $("focusJudgeMsg").textContent = "";
  syncToolButtons();
}

/** 수동 항목 맞춤 강조 토글 */
export async function toggleManualHighlight(selector: string, label: string, btn: HTMLButtonElement) {
  const on = btn.getAttribute("aria-pressed") !== "true";
  if (on) {
    await runOverlayInPage(
      overlayQueryInPage,
      selector,
      msg("overlayCountSome", [label, "{n}"]),
      msg("overlayCountNone", [label]),
    );
    toolState.currentView = "manual";
    toolState.activeHighlightBtn = btn;
  } else {
    await clearOverlayView();
    toolState.activeHighlightBtn = null;
  }
  syncToolButtons();
}

/** 오버레이·시뮬·선형화 전체 지우기 + 상태 초기화 */
async function clearAll() {
  await runInPage(clearOverlayInPage);
  toolState.currentView = "none";
  toolState.currentSim = "none";
  toolState.linearizeOn = false;
  toolState.activeHighlightBtn = null;
  $("focusJudge").hidden = true;
  syncToolButtons();
}

/** 초점 순서 판정 카드 배선 — 답변을 KWCAG 6.1.2 판정으로 저장 (체크리스트와 동일 저장소) */
export function wireFocusJudge() {
  const decide = (outcome: Verdict) => async () => {
    const tab = await getActiveTab();
    const url = tab?.url ?? "";
    if (!/^https?:/.test(url)) return;
    await setReview(url, "6.1.2", { outcome });
    $("focusJudgeMsg").textContent = msg("focusJudgeSaved");
    announce(msg("srVerdictSaved", ["6.1.2"]));
    // 검사 탭 체크리스트에 즉시 반영
    await renderManual(url);
  };
  $("focusYes").addEventListener("click", decide("passed"));
  $("focusNo").addEventListener("click", decide("failed"));
  $("focusHold").addEventListener("click", decide("cannotTell"));
}

/** 버튼 aria-pressed 상태 동기화 */
export function syncToolButtons() {
  const issuesBtn = document.getElementById("toggleIssues");
  if (issuesBtn) issuesBtn.setAttribute("aria-pressed", String(toolState.currentView === "issues"));
  document.querySelectorAll<HTMLButtonElement>("[data-struct]").forEach((b) => {
    const k = b.dataset.struct!;
    const active = k === "linearize" ? toolState.linearizeOn : toolState.currentView === k;
    b.setAttribute("aria-pressed", String(active));
  });
  document.querySelectorAll<HTMLButtonElement>("[data-sim]").forEach((b) => {
    b.setAttribute("aria-pressed", String(toolState.currentSim === b.dataset.sim));
  });
  // 수동 강조 버튼: 현재 뷰가 manual이 아니면 모두 해제
  if (toolState.currentView !== "manual" && toolState.activeHighlightBtn) {
    toolState.activeHighlightBtn.setAttribute("aria-pressed", "false");
    toolState.activeHighlightBtn = null;
  }
}

export function wireVisualTools() {
  $("toggleIssues").addEventListener("click", () => setIssuesView(toolState.currentView !== "issues"));
  $("clearOverlay").addEventListener("click", clearAll);
  $("clearOverlay2").addEventListener("click", clearAll);
  $("exportAiFix").addEventListener("click", exportAiFix);

  document.querySelectorAll<HTMLButtonElement>("[data-struct]").forEach((btn) => {
    const kind = btn.dataset.struct!;
    btn.addEventListener("click", async () => {
      if (kind === "linearize") {
        toolState.linearizeOn = !toolState.linearizeOn;
        await runInPage(linearizeInPage, toolState.linearizeOn);
        syncToolButtons();
      } else {
        await setStructView(kind as StructKind, toolState.currentView !== kind);
      }
    });
  });

  document.querySelectorAll<HTMLButtonElement>("[data-sim]").forEach((btn) => {
    const mode = btn.dataset.sim!;
    btn.addEventListener("click", async () => {
      toolState.currentSim = toolState.currentSim === mode ? "none" : mode;
      await runInPage(applySimulationInPage, toolState.currentSim);
      syncToolButtons();
    });
  });

  wireContrastPicker();
}

// ─── 명도대비 스포이드 (배경색/글자색 각각 선택 + 가이드) ───
let ccBg: string | null = null;
let ccFg: string | null = null;

function relLum(hex: string): number {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m || !m[1]) return 0;
  const v = parseInt(m[1], 16);
  const ch = [(v >> 16) & 255, (v >> 8) & 255, v & 255].map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * (ch[0] ?? 0) + 0.7152 * (ch[1] ?? 0) + 0.0722 * (ch[2] ?? 0);
}
function ratioOf(a: string, b: string): number {
  const l1 = relLum(a);
  const l2 = relLum(b);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}
/** bg에 대해 AA(4.5:1)를 통과하는, fg에 가장 가까운 색 제안 (검정/흰색 방향 혼합) */
function suggestColor(bg: string, fg: string): string | null {
  const mix = (hex: string, tgt: number, t: number) => {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex)![1]!;
    const v = parseInt(m, 16);
    const parts = [(v >> 16) & 255, (v >> 8) & 255, v & 255].map((c) => Math.round(c + (tgt - c) * t));
    return "#" + parts.map((c) => c.toString(16).padStart(2, "0")).join("");
  };
  for (let t = 0.05; t <= 1; t += 0.05) {
    for (const tgt of [0, 255]) {
      const cand = mix(fg, tgt, t);
      if (ratioOf(bg, cand) >= 4.5) return cand;
    }
  }
  return null;
}

async function pickScreenColor(): Promise<string | null> {
  const w = window as unknown as { EyeDropper?: new () => { open: () => Promise<{ sRGBHex: string }> } };
  if (!w.EyeDropper) return "unsupported";
  try {
    const r = await new w.EyeDropper().open();
    return r.sRGBHex;
  } catch {
    return null;
  }
}

function renderContrast() {
  const out = $("ccResult");
  ($("bgSwatch") as HTMLElement).style.background = ccBg ?? "";
  ($("fgSwatch") as HTMLElement).style.background = ccFg ?? "";
  if (!ccBg || !ccFg) {
    out.textContent = ccBg || ccFg ? msg("ccPickOther") : "";
    return;
  }
  const ratio = Math.round(ratioOf(ccBg, ccFg) * 100) / 100;
  const aa = ratio >= 4.5;
  const aaLarge = ratio >= 3;
  const aaa = ratio >= 7;
  out.innerHTML = "";

  const preview = document.createElement("div");
  preview.className = "cc-preview";
  preview.style.background = ccBg;
  preview.style.color = ccFg;
  preview.textContent = msg("ccSample");
  out.appendChild(preview);

  const ratioEl = document.createElement("div");
  ratioEl.append(`${msg("ccRatioLabel")} `);
  const ratioVal = document.createElement("span");
  ratioVal.className = "cc-ratio";
  ratioVal.textContent = String(ratio);
  ratioEl.append(ratioVal, " : 1 ");
  const pair = document.createElement("span");
  pair.style.color = "var(--ink-faint)";
  pair.textContent = `(${ccBg} / ${ccFg})`;
  ratioEl.appendChild(pair);
  out.appendChild(ratioEl);

  const badges = document.createElement("div");
  badges.className = "cc-badges";
  const mk = (label: string, ok: boolean) => {
    const s = document.createElement("span");
    s.className = `cc-badge ${ok ? "pass" : "fail"}`;
    s.textContent = `${label} ${ok ? "✓" : "✗"}`;
    return s;
  };
  badges.append(mk(msg("ccAaNormal"), aa), mk(msg("ccAaLarge"), aaLarge), mk("AAA", aaa));
  out.appendChild(badges);

  if (!aa) {
    const guide = document.createElement("div");
    guide.className = "cc-guide";
    guide.append(msg("ccGuideFail"));
    const suggestion = suggestColor(ccBg, ccFg);
    if (suggestion) {
      guide.appendChild(document.createElement("br"));
      guide.append(`${msg("ccSuggestion")} `);
      const b = document.createElement("b");
      b.style.color = suggestion;
      b.textContent = suggestion;
      guide.append(b, " ");
      const swatch = document.createElement("span");
      swatch.style.cssText = `display:inline-block;width:12px;height:12px;border-radius:3px;background:${suggestion};border:1px solid var(--line);vertical-align:middle`;
      guide.appendChild(swatch);
      guide.append(msg("ccRatioSuffix", [Math.round(ratioOf(ccBg, suggestion) * 100) / 100]));
    }
    out.appendChild(guide);
  }
}

function wireContrastPicker() {
  const bgBtn = $<HTMLButtonElement>("pickBg");
  const fgBtn = $<HTMLButtonElement>("pickFg");
  const pick = async (which: "bg" | "fg", btn: HTMLButtonElement) => {
    const label = btn.childNodes[0];
    const prev = label?.textContent ?? "";
    if (label) label.textContent = which === "bg" ? msg("ccPickingBg") : msg("ccPickingFg");
    const c = await pickScreenColor();
    if (label) label.textContent = prev;
    if (c === "unsupported") {
      $("ccResult").textContent = msg("ccNoEyedropper");
      return;
    }
    if (!c) return;
    if (which === "bg") ccBg = c;
    else ccFg = c;
    renderContrast();
  };
  bgBtn.addEventListener("click", () => pick("bg", bgBtn));
  fgBtn.addEventListener("click", () => pick("fg", fgBtn));
}
