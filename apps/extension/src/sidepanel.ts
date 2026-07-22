// 사이드 패널 부트스트랩 — 초기화·배선·활성 탭 갱신 (책임별 구현은 src/panel/*)
import { aggregateScan } from "@a11ychk/core/catalog";
import { getCachedScan, normalizeUrlKey } from "./scan-cache";
import { wireTabs, wireTheme, wireLang } from "./ui";
import { initI18n, isEnglish, localizeHtml, msg } from "./i18n";
import { $, AXE_VERSION, SITE_ORIGIN, getActiveTab, state } from "./panel/state";
import { renderAccount } from "./panel/session";
import { scan } from "./panel/scan";
import { renderResult } from "./panel/render";
import { saveToAccount } from "./panel/save";
import { manualView, renderManual } from "./panel/review";
import { syncToolButtons, toolState, wireFocusJudge, wireVisualTools } from "./panel/tools";

async function init() {
  // 정적 HTML 로컬라이즈 + 문서 언어 반영 (default_locale ko, en 지원)
  // 언어 설정(자동/한국어/영어) 반영 — msg()·localizeHtml보다 먼저 로드해야 함
  await initI18n();
  localizeHtml();

  await renderAccount();
  // 웹 연결 페이지에서 로그인하면 저장소가 바뀌므로 패널을 자동 갱신
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes.a11ychk_session) void renderAccount();
  });

  const webLocale = isEnglish() ? "en" : "ko";
  $("guideLink").setAttribute("href", `${SITE_ORIGIN}/${webLocale}/guide`);
  $("siteLink").setAttribute("href", `${SITE_ORIGIN}/${webLocale}`);

  $("scan").addEventListener("click", scan);
  $("save").addEventListener("click", saveToAccount);
  wireVisualTools();
  wireFocusJudge();

  // 수동 체크리스트 "미판정만 보기" 토글
  const undoneBtn = $<HTMLButtonElement>("manualFilterUndone");
  undoneBtn.addEventListener("click", async () => {
    manualView.undoneOnly = !manualView.undoneOnly;
    undoneBtn.setAttribute("aria-pressed", String(manualView.undoneOnly));
    const tab = await getActiveTab();
    if (tab?.url && /^https?:/.test(tab.url)) await renderManual(tab.url);
  });

  wireTabs();
  await wireTheme();
  await wireLang();

  await refreshActiveTab();
  // 사이드 패널은 탭을 바꿔도 떠 있으므로, 활성 탭 변경·주소 변경 시 갱신.
  // status "complete"도 트리거 — 권한이 없어 changeInfo.url이 오지 않는 탭(리로드)이나
  // 클라이언트 라우팅 후 로드 완료 시에도 대상 URL·체크리스트·캐시 복원이 따라간다.
  chrome.tabs.onActivated.addListener(() => void refreshActiveTab());
  chrome.tabs.onUpdated.addListener((_id, info, tab) => {
    if (tab.active && (info.url || info.status === "complete")) void refreshActiveTab();
  });
}

/** 현재 활성 탭을 다시 읽어 대상 URL·수동 체크리스트를 갱신 */
async function refreshActiveTab() {
  const tab = await getActiveTab();
  const url = tab?.url ?? "";
  const prevTabId = state.currentTabId;
  state.currentTabId = tab?.id ?? null;

  // 탭이 바뀌었거나 다른 페이지로 이동 → 이전 탭의 결과·오버레이 상태는 무효
  const pageChanged = prevTabId !== state.currentTabId || (state.lastPage !== null && state.lastPage.url !== url);
  if (pageChanged && state.lastPage) {
    state.lastPage = null;
    state.lastIncomplete = [];
    state.incompleteDecisions = {};
    $("result").hidden = true; // 결과 섹션(점수·위반 목록)은 lastPage 기준이므로 숨김
  }
  if (pageChanged) {
    // 오버레이는 이전 페이지에만 존재 — 패널 측 토글 상태를 리셋해 불일치 방지
    toolState.currentView = "none";
    toolState.currentSim = "none";
    toolState.linearizeOn = false;
    toolState.activeHighlightBtn?.setAttribute("aria-pressed", "false");
    toolState.activeHighlightBtn = null;
    syncToolButtons();
  }

  const scannable = /^https?:/.test(url);
  $("target").textContent = scannable ? url : url ? msg("errInternalPage") : msg("errNoTab");
  $<HTMLButtonElement>("scan").disabled = !scannable;
  if (scannable) {
    await renderManual(url);
    // 이 페이지의 최근 검사 결과가 세션 캐시에 있으면 복원 ("이전 결과" 안내와 함께)
    if (!state.lastPage) {
      const cached = await getCachedScan(url);
      if (cached && normalizeUrlKey(cached.page.url) === normalizeUrlKey(url)) {
        state.lastPage = cached.page;
        state.lastIncomplete = cached.incomplete;
        state.incompleteDecisions = cached.decisions;
        state.lastScannedAt = cached.scannedAt;
        const summary = aggregateScan([state.lastPage], AXE_VERSION);
        renderResult(state.lastPage, summary, state.lastPage.url);
        const note = $("cachedNote");
        const at = new Date(cached.scannedAt);
        const hh = String(at.getHours()).padStart(2, "0");
        const mm = String(at.getMinutes()).padStart(2, "0");
        note.textContent = msg("cachedResultNote", [`${hh}:${mm}`]);
        note.hidden = false;
      }
    }
  } else {
    $("manual").innerHTML = "";
  }
}

void init();
