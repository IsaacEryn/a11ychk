// ─── 수동 점검 · 전문가 판정 ───
import { KWCAG_PRINCIPLE_LABEL, getManualCheckItems } from "@a11ychk/core/catalog";
import { normalizeUrlKey } from "../scan-cache";
import { buildGuidedSteps } from "../guided";
import { announce } from "../ui";
import { msg, pick } from "../i18n";
import { $ } from "./state";
import { toggleManualHighlight } from "./tools";

export type Verdict = "passed" | "failed" | "cannotTell";
interface ReviewEntry {
  outcome: Verdict;
  note: string;
}
type ReviewMap = Record<string, ReviewEntry>;

/** 판정 버튼 정의 — 라벨은 렌더 시점 msg() 호출 (initI18n 이전 모듈 로드 시점 msg() 금지) */
const VERDICTS: { value: Verdict; labelKey: string }[] = [
  { value: "passed", labelKey: "verdictPass" },
  { value: "failed", labelKey: "verdictFail" },
  { value: "cannotTell", labelKey: "verdictHold" },
];

// 판정 저장 키용 URL 정규화 — 캐시 키와 동일 규칙 공유 (scan-cache.ts)
const reviewKey = (url: string) => `review:${normalizeUrlKey(url)}`;

export async function getReviewState(url: string): Promise<ReviewMap> {
  const key = reviewKey(url);
  const stored = await chrome.storage.local.get(key);
  return (stored[key] as ReviewMap | undefined) ?? {};
}

export async function setReview(url: string, itemId: string, patch: Partial<ReviewEntry>) {
  const cur = await getReviewState(url);
  const prev = cur[itemId] ?? { outcome: "cannotTell", note: "" };
  cur[itemId] = { ...prev, ...patch };
  await chrome.storage.local.set({ [reviewKey(url)]: cur });
}

/** WCAG 성공기준 → 관련 요소 선택자·라벨 키 (수동 항목 맞춤 강조용).
 *  라벨은 사용 시점 msg() 호출 — 모듈 로드 시점 msg()는 initI18n 이전이라 언어 설정을 무시한다. */
const SC_HIGHLIGHT: Record<string, { selector: string; labelKey: string }> = {
  "1.1.1": { selector: "img,[role=img],input[type=image],area,svg", labelKey: "hlImages" },
  "1.2.1": { selector: "video,audio", labelKey: "hlMedia" },
  "1.2.2": { selector: "video,audio", labelKey: "hlMediaCaptions" },
  "1.2.3": { selector: "video", labelKey: "hlVideoAlt" },
  "1.3.1": { selector: "table,ul,ol,dl,fieldset", labelKey: "hlStructure" },
  "1.4.2": { selector: "video[autoplay],audio[autoplay]", labelKey: "hlAutoplay" },
  "2.1.1": { selector: "a[href],button,input,select,textarea,[onclick],[role=button]", labelKey: "hlOperable" },
  "2.4.1": { selector: "a[href^='#'],[id]", labelKey: "hlSkip" },
  "2.4.4": { selector: "a[href]", labelKey: "hlLinks" },
  "2.4.6": { selector: "h1,h2,h3,h4,h5,h6,[role=heading]", labelKey: "hlHeadings" },
  "2.5.8": { selector: "a[href],button,[role=button],input", labelKey: "hlTargetSize" },
  "3.3.2": { selector: "input:not([type=hidden]),select,textarea,label", labelKey: "hlForms" },
};
/** KWCAG 항목의 대응 WCAG SC들에서 강조 선택자 조합 */
function highlightForItem(item: { wcag: string[] }): { selector: string; label: string } | null {
  const parts: string[] = [];
  let label = "";
  for (const sc of item.wcag) {
    const h = SC_HIGHLIGHT[sc];
    if (h) {
      parts.push(h.selector);
      if (!label) label = msg(h.labelKey);
    }
  }
  if (parts.length === 0) return null;
  return { selector: [...new Set(parts.join(",").split(","))].join(","), label };
}

/** 미판정만 보기 필터 상태 — 부트스트랩 토글이 함께 쓰므로 객체 필드로 관리 */
export const manualView = { undoneOnly: false };

/** 판정 저장·해제 공통 처리 — 저장 + 버튼 상태 동기화 + SR 고지 + 진행률 갱신 */
async function applyVerdict(
  url: string,
  itemId: string,
  group: HTMLElement,
  value: Verdict | undefined,
) {
  if (value) await setReview(url, itemId, { outcome: value });
  else {
    const cur = await getReviewState(url);
    delete cur[itemId];
    await chrome.storage.local.set({ [reviewKey(url)]: cur });
  }
  group.querySelectorAll(".verdict").forEach((b) => b.setAttribute("aria-pressed", "false"));
  if (value) {
    group.querySelector(`.verdict.v-${value}`)?.setAttribute("aria-pressed", "true");
  }
  announce(value ? msg("srVerdictSaved", [itemId]) : msg("srVerdictCleared", [itemId]));
  await updateManualProgress(url);
}

/** 판정 진행률 표시 갱신 — 목록 재렌더 없이 텍스트·진행 바만 (메모 입력 포커스 보존) */
async function updateManualProgress(url: string) {
  const items = getManualCheckItems();
  const reviews = await getReviewState(url);
  const done = items.filter((i) => reviews[i.id]?.outcome).length;
  $("manualProgress").textContent = msg("manualProgress", [done, items.length]);
  $("manualProgressBar").style.width = items.length ? `${Math.round((done / items.length) * 100)}%` : "0";
}

export async function renderManual(url: string) {
  const items = getManualCheckItems();
  const reviews = await getReviewState(url);
  const list = $("manual");
  list.innerHTML = "";
  await updateManualProgress(url);

  let lastPrinciple = "";
  for (const item of items) {
    if (manualView.undoneOnly && reviews[item.id]?.outcome) continue;

    // 원칙별 그룹 헤더 (인식·운용·이해·견고)
    if (item.principle !== lastPrinciple) {
      lastPrinciple = item.principle;
      const groupLi = document.createElement("li");
      groupLi.className = "manual-group";
      const h3 = document.createElement("h3");
      h3.textContent = pick(KWCAG_PRINCIPLE_LABEL[item.principle]);
      groupLi.appendChild(h3);
      list.appendChild(groupLi);
    }

    const li = document.createElement("li");
    li.className = "review-item";

    const head = document.createElement("p");
    head.className = "ri-head";
    const mid = document.createElement("span");
    mid.className = "mid";
    mid.textContent = item.id;
    head.append(mid, document.createTextNode(pick(item.name)));
    li.appendChild(head);

    const actions = document.createElement("div");
    actions.className = "ri-actions";

    // 통과/실패/보류 라디오 버튼 그룹
    const group = document.createElement("div");
    group.className = "verdicts";
    group.setAttribute("role", "group");
    group.setAttribute("aria-label", msg("verdictGroupAria", [pick(item.name)]));
    for (const v of VERDICTS) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = `verdict v-${v.value}`;
      btn.textContent = msg(v.labelKey);
      btn.setAttribute("aria-pressed", String(reviews[item.id]?.outcome === v.value));
      btn.addEventListener("click", async () => {
        const already = btn.getAttribute("aria-pressed") === "true";
        await applyVerdict(url, item.id, group, already ? undefined : v.value);
      });
      group.appendChild(btn);
    }
    actions.appendChild(group);

    // 항목별 맞춤 강조 토글 (관련 요소가 있을 때만)
    const hl = highlightForItem(item);
    if (hl) {
      const hlBtn = document.createElement("button");
      hlBtn.type = "button";
      hlBtn.className = "ri-highlight";
      hlBtn.textContent = msg("highlight");
      hlBtn.setAttribute("aria-pressed", "false");
      hlBtn.setAttribute("aria-label", msg("highlightAria", [pick(item.name)]));
      hlBtn.addEventListener("click", () => toggleManualHighlight(hl.selector, hl.label, hlBtn));
      actions.appendChild(hlBtn);
    }
    li.appendChild(actions);

    // 가이드형 판정 — 확인 절차 단계 + 예/아니오/판단 불가 (자유 판정과 같은 저장소)
    const steps = buildGuidedSteps(item);
    if (steps.length > 0) {
      const guide = document.createElement("details");
      guide.className = "ri-guide";
      const summaryEl = document.createElement("summary");
      summaryEl.textContent = msg("guidedOpen");
      guide.appendChild(summaryEl);
      const stepsTitle = document.createElement("p");
      stepsTitle.className = "gq";
      stepsTitle.textContent = msg("guidedStepsTitle");
      guide.appendChild(stepsTitle);
      const ol = document.createElement("ol");
      ol.className = "gsteps";
      for (const s of steps) {
        const stepLi = document.createElement("li");
        stepLi.textContent = s;
        ol.appendChild(stepLi);
      }
      guide.appendChild(ol);
      const q = document.createElement("p");
      q.className = "gq";
      q.textContent = msg("guidedQuestion");
      guide.appendChild(q);
      const answers = document.createElement("div");
      answers.className = "verdicts";
      answers.setAttribute("role", "group");
      answers.setAttribute("aria-label", msg("verdictGroupAria", [pick(item.name)]));
      const mkAnswer = (labelKey: string, value: Verdict) => {
        const b = document.createElement("button");
        b.type = "button";
        b.className = `verdict v-${value}`;
        b.textContent = msg(labelKey);
        b.addEventListener("click", async () => {
          await applyVerdict(url, item.id, group, value);
          guide.open = false;
        });
        return b;
      };
      answers.append(
        mkAnswer("guidedYes", "passed"),
        mkAnswer("guidedNo", "failed"),
        mkAnswer("guidedUnsure", "cannotTell"),
      );
      guide.appendChild(answers);
      li.appendChild(guide);
    }

    // 메모
    const note = document.createElement("textarea");
    note.className = "ri-note";
    note.rows = 1;
    note.placeholder = msg("notePlaceholder");
    note.value = reviews[item.id]?.note ?? "";
    note.addEventListener("change", () => setReview(url, item.id, { note: note.value.slice(0, 2000) }));
    li.appendChild(note);

    list.appendChild(li);
  }
}
