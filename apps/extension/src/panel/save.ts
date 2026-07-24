// 계정 저장 + AI 수정요청 내보내기
import { getRuleEntry } from "@a11ychk/core/catalog";
import { isEnglish, msg, pick } from "../i18n";
import { $, SITE_ORIGIN, state, type PageResult } from "./state";
import { getSession } from "./session";
import { getReviewState } from "./review";
import { IMPACTS, impactLabel } from "./render";

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
  } catch {
    // 목록 조회 실패 시 "새 보고서로 저장"만 사용 가능 — 저장 자체는 동작
  }
}

export async function saveToAccount() {
  const session = await getSession();
  if (!session || !state.lastPage) return;
  const saveBtn = $<HTMLButtonElement>("save");
  const msgEl = $("saveMsg");
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
    if (!res.ok || !data.id) {
      msgEl.textContent = "";
      const err = document.createElement("span");
      err.className = "err";
      err.textContent = data.error ?? msg("saveFailed");
      msgEl.appendChild(err);
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
  } catch {
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
const MAX_AIFIX_NODES = 10;

/**
 * 로컬 검사 결과를 AI 도구(Claude/ChatGPT/Copilot)에 붙여넣을 자기완결 마크다운으로 변환.
 * 웹 보고서의 ai-fix 내보내기와 동일한 목적 — 확장에서도 "점검→즉시 수정"이 완결되게 한다.
 */
function buildAiFixMarkdown(page: PageResult): string {
  const sorted = [...page.violations].sort((a, b) => IMPACTS.indexOf(a.impact) - IMPACTS.indexOf(b.impact));
  const lines: string[] = [`# A11y Check — ${msg("aiFixExport")}`, "", `- URL: ${page.url}`, `- ${msg("aiFixIntro")}`, ""];
  let i = 0;
  for (const v of sorted) {
    i++;
    const entry = getRuleEntry(v.ruleId, v.tags);
    const tags = [
      entry.wcag.length ? `WCAG ${entry.wcag.join(", ")}` : "",
      entry.kwcag.length ? `KWCAG ${entry.kwcag.join(", ")}` : "",
    ].filter(Boolean).join(" · ");
    lines.push(`## ${i}. [${impactLabel(v.impact)}] ${pick(entry.title)}`);
    lines.push(`- ${[tags, msg("nodeCount", [v.nodes.length])].filter(Boolean).join(" · ")}`);
    const guide = pick(entry.guide).split("\n\n")[0]?.trim();
    if (guide) lines.push("", guide);
    lines.push("");
    for (const node of v.nodes.slice(0, MAX_AIFIX_NODES)) {
      lines.push(`- \`${node.selector}\``, "  ```html", "  " + node.html.replace(/\n/g, "\n  "), "  ```");
      if (node.failureSummary) lines.push(`  - ${node.failureSummary.replace(/\s*\n\s*/g, " ")}`);
    }
    if (v.nodes.length > MAX_AIFIX_NODES) lines.push(`- ${msg("moreNodes", [v.nodes.length - MAX_AIFIX_NODES])}`);
    lines.push("");
  }
  return lines.join("\n");
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
