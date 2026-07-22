// 검사 실행(axe + 커스텀 검사) + 결과 세션 캐시 갱신
import {
  AXE_RUN_TAGS,
  aggregateScan,
  customFindingsFromSignals,
  mergePageSignals,
  normalizeAxeResults,
  type AxeRunResults,
  type PageCheckSignals,
} from "@a11ychk/core/catalog";
import { setCachedScan } from "../scan-cache";
import { deriveIncompleteFindings } from "../incomplete";
import { collectPageSignals, configureAxeLocaleInPage, runAxeInPage } from "../injected";
import { announce } from "../ui";
import { isEnglish, msg } from "../i18n";
// axe 공식 한국어 로케일 — UI가 한국어일 때 진단 메시지를 한국어로
import axeKoLocale from "axe-core/locales/ko.json";
import { $, AXE_VERSION, SITE_ORIGIN, getActiveTab, state, withTimeout } from "./state";
import { ANON_WEEKLY_LIMIT, bumpAnonUsage, getAnonUsage, getSession, setUsageNote } from "./session";
import { renderResult } from "./render";

/** axe 실행 최대 대기 시간 — 초과 시 친화적 오류로 전환(무한 대기 방지) */
const AXE_TIMEOUT_MS = 30_000;

/** MAIN world에서 axe 실행 — 단순 표현식이라 번들러 헬퍼 오염 위험 없음 */
export async function scan() {
  const tab = await getActiveTab();
  if (!tab?.id || !tab.url || !/^https?:/.test(tab.url)) {
    const target = $("target");
    target.textContent = "";
    const err = document.createElement("span");
    err.className = "err";
    err.textContent = msg("errUnscannable");
    target.appendChild(err);
    return;
  }
  state.currentTabId = tab.id;
  const scanBtn = $<HTMLButtonElement>("scan");

  // ── 사용량 확인: 로그인 = 서버 확장 한도(웹 검사와 분리) / 비로그인 = 로컬 주 3회·가입 유도 ──
  const session = await getSession();
  if (session) {
    try {
      const res = await fetch(`${SITE_ORIGIN}/api/extension/usage`, {
        method: "POST",
        headers: { Authorization: `Bearer ${session.accessToken}` },
      });
      const data = (await res.json()) as { ok?: boolean; used?: number; limit?: number; error?: string };
      if (res.status === 429) {
        setUsageNote({ text: data.error ?? msg("usageLimitReached"), err: true });
        return;
      }
      if (res.ok && data.used != null && data.limit != null) {
        setUsageNote({ text: msg("usageStatus", [data.used, data.limit]) });
      }
    } catch {
      // 네트워크 오류 — 검사는 로컬 실행이므로 차단하지 않음
    }
  } else {
    const used = await getAnonUsage();
    if (used >= ANON_WEEKLY_LIMIT) {
      setUsageNote({
        text: msg("anonLimitReached", [ANON_WEEKLY_LIMIT]),
        cta: true,
        err: true,
      });
      return;
    }
  }

  scanBtn.disabled = true;
  scanBtn.textContent = msg("scanning");
  $("scanStatus").hidden = false;
  try {
    // 1) axe 라이브러리 주입 (MAIN world) — allFrames로 접근 가능한 하위 프레임에도 주입해
    //    axe가 프레임 경계를 넘어 검사하도록 한다(권한 있는 프레임 한정). 상위 프레임만 실행.
    await chrome.scripting.executeScript({
      target: { tabId: tab.id, allFrames: true },
      world: "MAIN",
      files: ["vendor/axe.min.js"],
    });
    if (!isEnglish()) {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id, allFrames: true },
        world: "MAIN",
        args: [axeKoLocale],
        func: configureAxeLocaleInPage,
      });
    }
    // 2) axe 실행 — 무거운 페이지에서 무한 대기하지 않도록 타임아웃(멈춘 듯한 UX 방지)
    const results = await withTimeout(
      chrome.scripting.executeScript({
        target: { tabId: tab.id },
        world: "MAIN",
        args: [AXE_RUN_TAGS],
        func: runAxeInPage,
      }),
      AXE_TIMEOUT_MS,
      msg("errScanTimeout"),
    );
    const raw = results[0]?.result as AxeRunResults | undefined;
    if (!raw) throw new Error(msg("errFetchResults"));
    const page = normalizeAxeResults(tab.url, raw);
    // 확인 필요 항목 — 노드 포함 파생 (심사 흐름용), 새 검사이므로 이전 결정 초기화
    state.lastIncomplete = deriveIncompleteFindings(tab.url, raw);
    state.incompleteDecisions = {};
    state.lastScannedAt = Date.now();

    // 3) 자체 커스텀 검사 (서버 스캐너와 동일 규칙 — 리플로우 제외).
    //    axe와 마찬가지로 allFrames로 하위 프레임까지 수집해 사각지대를 없앤다 —
    //    상위 프레임(frameId 0)을 기준으로 하위 프레임 신호를 병합(mergePageSignals).
    try {
      const signalResults = await chrome.scripting.executeScript({
        target: { tabId: tab.id, allFrames: true },
        func: collectPageSignals,
      });
      const top = signalResults.find((r) => r.frameId === 0)?.result as PageCheckSignals | undefined;
      const subs = signalResults
        .filter((r) => r.frameId !== 0 && r.result)
        .map((r) => r.result as PageCheckSignals);
      if (top) {
        const custom = customFindingsFromSignals(mergePageSignals(top, subs));
        page.violations.push(...custom.violations);
        page.passes.push(...custom.passes);
        page.incomplete.push(...custom.incomplete);
      }
    } catch {
      // 커스텀 검사 실패 — axe 결과만으로 진행
    }

    const summary = aggregateScan([page], AXE_VERSION);
    renderResult(page, summary, tab.url);
    updateScanCache();
    // 완료 요약은 단일 라이브 리전으로 1회 고지 (결과 섹션 전체 낭독 방지)
    announce(msg("srScanDone", [summary.complianceRate, page.violations.length]));

    // 비로그인: 로컬 사용량 증가 + 가입 유도
    if (!session) {
      const used = await bumpAnonUsage();
      setUsageNote({
        text: msg("anonUsage", [used, ANON_WEEKLY_LIMIT]),
        cta: true,
      });
    }
  } catch (e) {
    // 에러 메시지는 페이지 컨텍스트에서 올 수 있으므로 textContent로만 렌더 (XSS 방지)
    const target = $("target");
    target.textContent = "";
    const err = document.createElement("span");
    err.className = "err";
    // host_permissions를 activeTab 위주로 좁혔으므로, 아이콘으로 열지 않은 탭은
    // 접근 권한이 없어 주입이 실패한다 → 아이콘 재클릭 안내로 전환.
    const em = (e as Error).message || "";
    const needsActivation = /access|permission|cannot be scripted|host permission/i.test(em);
    err.textContent = needsActivation ? msg("errNeedActivation") : msg("errScanFailed", [em]);
    target.appendChild(err);
  } finally {
    $("scanStatus").hidden = true;
    scanBtn.disabled = false;
    scanBtn.textContent = msg("rescan");
  }
}

/** 현재 결과 상태를 세션 캐시에 저장 (패널 재열기·탭 전환 대비) */
export function updateScanCache() {
  if (!state.lastPage) return;
  void setCachedScan(state.lastPage.url, {
    page: state.lastPage,
    incomplete: state.lastIncomplete,
    decisions: state.incompleteDecisions,
    scannedAt: state.lastScannedAt,
  });
}
