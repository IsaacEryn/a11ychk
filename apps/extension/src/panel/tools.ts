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
import * as log from "../log";
import { $, getActiveTab, state } from "./state";
import { impactLabel } from "./render";
import { renderManual, setReview, type Verdict } from "./review";
import { exportAiFix } from "./save";
import { wireContrastPicker } from "./contrast";

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
  } catch (e) {
    // 주입 실패(권한·CSP·탭 이동 등) — 호출부가 성공 여부로 UI 상태를 판단하도록 undefined 반환
    log.warn(`page injection failed: ${func.name || "anonymous"}`, e);
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
    // 주입이 실패하면(undefined) 오버레이가 안 그려진 것이므로 뷰를 켜짐으로 표시하지 않는다
    const drawn = await runOverlayInPage(overlayMarkersInPage, markers);
    if (drawn !== undefined) toolState.currentView = "issues";
  } else {
    await clearOverlayView();
  }
  syncToolButtons();
}

/** 구조·크기 오버레이 토글 */
async function setStructView(kind: StructKind, on: boolean) {
  if (on) {
    const drawn =
      kind === "targets"
        ? await runOverlayInPage(overlayTargetSizeInPage)
        : await runOverlayInPage(overlayStructureInPage, kind, msg("skippedLabel"));
    if (drawn !== undefined) toolState.currentView = kind;
  } else {
    await clearOverlayView();
  }
  // 초점 순서 오버레이가 실제로 켜진 동안만 6.1.2 판정 카드 노출 (확인→판정 즉시 기입)
  const focusShown = kind === "focus" && toolState.currentView === "focus";
  $("focusJudge").hidden = !focusShown;
  if (focusShown) $("focusJudgeMsg").textContent = "";
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
