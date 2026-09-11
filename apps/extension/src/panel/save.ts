// 계정 저장 + AI 수정요청 내보내기
import { aggregateScan, automatedComplianceRate, buildAiFix, groupViolationsForAiFix } from "@a11ychk/core/catalog";
import { isEnglish, msg } from "../i18n";
import * as log from "../log";
import { $, AXE_VERSION, SITE_ORIGIN, state, type PageResult } from "./state";
import { clearSession, getSession, renderAccount } from "./session";
import { getReviewState } from "./review";

/** 저장 위치 셀렉트 채우기 — 새 보고서 + 사용자의 기존 보고서(같은 사이트 우선) */
export async function populateSaveTargets(accessToken: string, pageUrl: string) {
  const sel = $<HTMLSelectElement>("saveTarget");
  let host = "";
  try {
    host = new URL(pageUrl).hostname;
  } catch {
    host = "";
  }
  try {
    const res = await fetch(`${SITE_ORIGIN}/api/extension/scan?host=${encodeURIComponent(host)}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) return;
    const data = (await res.json()) as {
      reports?: { id: string; rootUrl: string; pageCount: number; createdAt: string; sameHost: boolean }[];
    };
    const reports = data.reports ?? [];
    // "새 보고서" 옵션은 유지하고 그 뒤로 기존 보고서를 채운다
    sel.length = 1;
    let firstSameHostId = "";
    for (const r of reports) {
      const opt = document.createElement("option");
      opt.value = r.id;
      let hostLabel = r.rootUrl;
      try {
        hostLabel = new URL(r.rootUrl).hostname;
      } catch {
        /* rootUrl 그대로 사용 */
      }
      const date = new Date(r.createdAt).toLocaleDateString("ko-KR", { month: "numeric", day: "numeric" });
      opt.textContent = `${r.sameHost ? "＊ " : ""}${hostLabel} · ${r.pageCount}p · ${date}`;
      sel.appendChild(opt);
      if (r.sameHost && !firstSameHostId) firstSameHostId = r.id;
    }
    // 같은 사이트 보고서가 있으면 기본 선택(페이지 추가가 자연스러움), 없으면 새 보고서
    sel.value = firstSameHostId || "new";
  } catch (e) {
    // 목록 조회 실패 시 "새 보고서로 저장"만 사용 가능 — 저장 자체는 동작
    log.warn("save-target list fetch failed", e);
  }
}

/** 저장 실패 문구 — 서버 문구가 섞이므로 텍스트 노드로만 렌더 */
function showSaveError(text: string) {
  const msgEl = $("saveMsg");
  msgEl.textContent = "";
  const err = document.createElement("span");
  err.className = "err";
  err.textContent = text;
  msgEl.appendChild(err);
}

export async function saveToAccount() {
  const session = await getSession();
  const saveBtn = $<HTMLButtonElement>("save");
  const msgEl = $("saveMsg");
  if (!session || !state.lastPage) {
    // 결과를 렌더한 뒤 세션이 끊긴 경우 — 조용히 아무 일도 안 하면 버튼이 고장난 것처럼 보인다
    if (!session) {
      await renderAccount();
      showSaveError(msg("sessionExpired"));
    }
    return;
  }
  saveBtn.disabled = true;
  msgEl.textContent = msg("saving");
  try {
    const reviewMap = await getReviewState(state.lastPage.url);
    const reviews = Object.entries(reviewMap).map(([itemId, v]) => ({
      // 체크리스트가 WCAG SC 축(1~4.x.x) — 서버 점수에 직접 반영된다.
      // KWCAG 고유 항목(5~8.x.x — 5.4.3·6.4.4)만 kwcag로 저장
      standard: /^[5-8]\./.test(itemId) ? ("kwcag" as const) : ("wcag" as const),
      itemId,
      outcome: v.outcome,
      note: v.note ?? "",
      // 확장은 현재 페이지 단위이므로 판정을 그 페이지에 귀속
      pages: [state.lastPage!.url],
    }));
    const isProcess = ($("isProcess") as HTMLInputElement).checked;
    const target = $<HTMLSelectElement>("saveTarget").value || "new";
    const res = await fetch(`${SITE_ORIGIN}/api/extension/scan`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.accessToken}`,
      },
      body: JSON.stringify({
        page: state.lastPage,
        reviews,
        sampleType: isProcess ? "process" : "structured",
        target,
      }),
    });
    const data = (await res.json()) as { id?: string; error?: string; merged?: boolean; rootUrl?: string };
    if (res.status === 401) {
      // 서버가 세션을 거절했다 — 저장된 세션을 지워 계정 영역이 재연결 안내로 돌아가게 한다
      await clearSession();
      await renderAccount();
      showSaveError(data.error ?? msg("sessionExpired"));
    } else if (!res.ok || !data.id) {
      showSaveError(data.error ?? msg("saveFailed"));
    } else {
      msgEl.textContent = data.merged
        ? msg("savedMerged", [data.rootUrl ?? ""])
        : msg("saved");
      const link = document.createElement("a");
      link.href = `${SITE_ORIGIN}/${isEnglish() ? "en" : "ko"}/scans/${data.id}`;
      link.target = "_blank";
      link.rel = "noopener";
      link.textContent = msg("viewReport");
      msgEl.appendChild(link);
      // 새로 만든/갱신된 보고서가 다음 저장 시 선택지에 나타나도록 목록 갱신
      void populateSaveTargets(session.accessToken, state.lastPage!.url);
    }
  } catch (e) {
    log.warn("report save failed", e);
    msgEl.textContent = "";
    const err = document.createElement("span");
    err.className = "err";
    err.textContent = msg("errNetwork");
    msgEl.appendChild(err);
  } finally {
    saveBtn.disabled = false;
  }
}

/** AI 수정요청 프롬프트에 규칙당 포함할 최대 발생 위치 */
/**
 * AI 수정 요청 문서 — core의 공용 빌더로 생성해 웹 보고서·MCP와 같은 형식이 나온다
 * (판정 3면 일치의 문서판). 준수율도 화면과 같은 aggregateScan → automatedComplianceRate.
 */
function buildAiFixMarkdown(page: PageResult): string {
  const summary = aggregateScan([page], AXE_VERSION);
  return buildAiFix({
    site: page.url,
    scannedAt: page.scannedAt,
    axeVersion: AXE_VERSION,
    complianceRate: automatedComplianceRate(summary),
    totalViolationNodes: page.violations.reduce((n, v) => n + v.nodes.length, 0),
    lang: isEnglish() ? "en" : "ko",
    groups: groupViolationsForAiFix([page]),
  }).markdown;
}

/** AI 수정요청 마크다운 파일 다운로드 (Blob + anchor — downloads 권한 불필요) */
export function exportAiFix() {
  const msgEl = $("saveMsg");
  if (!state.lastPage || state.lastPage.violations.length === 0) {
    msgEl.textContent = msg("aiFixEmpty");
    return;
  }
  const md = buildAiFixMarkdown(state.lastPage);
  let host = "page";
  try { host = new URL(state.lastPage.url).hostname; } catch { /* about:blank 등 */ }
  const blob = new Blob([md], { type: "text/markdown;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `a11ychk-ai-fix-${host}.md`;
  a.click();
  URL.revokeObjectURL(a.href);
}
