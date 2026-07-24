// ─── 수동 점검 · 전문가 판정 (WCAG 성공기준 축 — 검사 방법은 대응 KWCAG 항목에서) ───
import {
  KWCAG_BY_ID,
  KWCAG_PRINCIPLE_LABEL,
  getKwcagOnlyManualItems,
  getManualChecksByWcag,
  type LocalizedText,
} from "@a11ychk/core/catalog";
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

/**
 * 레거시(KWCAG 항목 키, 5~8.x.x) 판정을 대응 WCAG SC 키로 팬아웃 변환한다.
 * 순수 함수·멱등: 이미 SC 키가 있으면 건너뛰고(신규 판정 우선), 변환된 원본 키는
 * 삭제한다. KWCAG 고유 항목(5.4.3·6.4.4 — 대응 SC 없음)은 그대로 유지.
 * (키 공간이 겹치지 않아 — KWCAG 5~8.x.x vs WCAG 1~4.x.x — 충돌이 없다)
 */
export function migrateLegacyReviews(map: ReviewMap): { map: ReviewMap; changed: boolean } {
  let changed = false;
  const out: ReviewMap = { ...map };
  for (const [key, entry] of Object.entries(map)) {
    const item = /^[5-8]\./.test(key) ? KWCAG_BY_ID.get(key) : undefined;
    if (!item) continue;
    const scs = item.wcag.filter((sc) => /^[1-4]\./.test(sc));
    if (scs.length === 0) continue; // KWCAG 고유 항목 — 유지
    for (const sc of scs) {
      if (!out[sc]) {
        out[sc] = { ...entry };
        changed = true;
      }
    }
    delete out[key];
    changed = true;
  }
  return { map: out, changed };
}

export async function getReviewState(url: string): Promise<ReviewMap> {
  const key = reviewKey(url);
  const stored = await chrome.storage.local.get(key);
  const raw = (stored[key] as ReviewMap | undefined) ?? {};
  const { map, changed } = migrateLegacyReviews(raw);
  if (changed) await chrome.storage.local.set({ [key]: map });
  return map;
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

/** 체크리스트 렌더 단위 — WCAG SC 파생 항목과 KWCAG 고유 항목을 공통 형태로 */
interface ChecklistEntry {
  /** 판정 저장 키 — SC 번호 또는 KWCAG 고유 항목 번호 */
  id: string;
  name: LocalizedText;
  /** A/AA — KWCAG 고유 항목은 없음 */
  level?: string;
  /** "7.3.1 콘텐츠의 선형구조" 형태 KWCAG 대응 표기 */
  kwcagRef?: string;
  howToTests: LocalizedText[];
  highlight?: { selector: string; labelKey: string };
  /** 원칙 그룹 헤더 텍스트 (앞 항목과 다를 때만 렌더) */
  groupLabel: string;
}

function buildChecklist(): ChecklistEntry[] {
  const entries: ChecklistEntry[] = [];
  for (const c of getManualChecksByWcag()) {
    entries.push({
      id: c.scId,
      name: c.name,
      level: c.level,
      kwcagRef: c.sources.map((s) => `${s.kwcagId} ${pick(s.name)}`).join(" · "),
      howToTests: c.sources.map((s) => s.howToTest).filter((h): h is LocalizedText => !!h),
      highlight: SC_HIGHLIGHT[c.scId],
      groupLabel: pick(KWCAG_PRINCIPLE_LABEL[c.principle]),
    });
  }
  for (const item of getKwcagOnlyManualItems()) {
    entries.push({
      id: item.id,
      name: item.name,
      howToTests: item.howToTest ? [item.howToTest] : [],
      groupLabel: msg("manualGroupKwcagOnly"),
    });
  }
  return entries;
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
  const entries = buildChecklist();
  const reviews = await getReviewState(url);
  const done = entries.filter((e) => reviews[e.id]?.outcome).length;
  $("manualProgress").textContent = msg("manualProgress", [done, entries.length]);
  $("manualProgressBar").style.width = entries.length ? `${Math.round((done / entries.length) * 100)}%` : "0";
}

export async function renderManual(url: string) {
  const entries = buildChecklist();
  const reviews = await getReviewState(url);
  const list = $("manual");
  list.innerHTML = "";
  await updateManualProgress(url);

  let lastGroup = "";
  for (const entry of entries) {
    if (manualView.undoneOnly && reviews[entry.id]?.outcome) continue;

    // 그룹 헤더 (원칙 4종 + KWCAG 추가 항목)
    if (entry.groupLabel !== lastGroup) {
      lastGroup = entry.groupLabel;
      const groupLi = document.createElement("li");
      groupLi.className = "manual-group";
      const h3 = document.createElement("h3");
      h3.textContent = entry.groupLabel;
      groupLi.appendChild(h3);
      list.appendChild(groupLi);
    }

    const li = document.createElement("li");
    li.className = "review-item";

    const head = document.createElement("p");
    head.className = "ri-head";
    const mid = document.createElement("span");
    mid.className = "mid";
    mid.textContent = entry.id;
    head.append(mid, document.createTextNode(pick(entry.name)));
    if (entry.level) {
      const lv = document.createElement("span");
      lv.className = "ri-level";
      lv.textContent = entry.level;
      lv.setAttribute("aria-label", msg("levelAria", [entry.level]));
      head.appendChild(lv);
    }
    li.appendChild(head);

    // KWCAG 대응 표기 — 인증 실무자가 항목 번호로 교차 확인할 수 있게
    if (entry.kwcagRef) {
      const refP = document.createElement("p");
      refP.className = "ri-ref";
      refP.textContent = `${msg("manualKwcagRef")}: ${entry.kwcagRef}`;
      li.appendChild(refP);
    }

    const actions = document.createElement("div");
    actions.className = "ri-actions";

    // 통과/실패/보류 라디오 버튼 그룹
    const group = document.createElement("div");
    group.className = "verdicts";
    group.setAttribute("role", "group");
    group.setAttribute("aria-label", msg("verdictGroupAria", [pick(entry.name)]));
    for (const v of VERDICTS) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = `verdict v-${v.value}`;
      btn.textContent = msg(v.labelKey);
      btn.setAttribute("aria-pressed", String(reviews[entry.id]?.outcome === v.value));
      btn.addEventListener("click", async () => {
        const already = btn.getAttribute("aria-pressed") === "true";
        await applyVerdict(url, entry.id, group, already ? undefined : v.value);
      });
      group.appendChild(btn);
    }
    actions.appendChild(group);

    // 항목별 맞춤 강조 토글 (관련 요소가 있을 때만)
    if (entry.highlight) {
      const hl = entry.highlight;
      const hlBtn = document.createElement("button");
      hlBtn.type = "button";
      hlBtn.className = "ri-highlight";
      hlBtn.textContent = msg("highlight");
      hlBtn.setAttribute("aria-pressed", "false");
      hlBtn.setAttribute("aria-label", msg("highlightAria", [pick(entry.name)]));
      hlBtn.addEventListener("click", () => toggleManualHighlight(hl.selector, msg(hl.labelKey), hlBtn));
      actions.appendChild(hlBtn);
    }
    li.appendChild(actions);

    // 가이드형 판정 — 출처별 검사 방법을 절차 단계로 이어붙임 (1.3.1은 3출처 연속)
    const steps = entry.howToTests.flatMap((h) => buildGuidedSteps({ howToTest: h }));
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
      answers.setAttribute("aria-label", msg("verdictGroupAria", [pick(entry.name)]));
      const mkAnswer = (labelKey: string, value: Verdict) => {
        const b = document.createElement("button");
        b.type = "button";
        b.className = `verdict v-${value}`;
        b.textContent = msg(labelKey);
        b.addEventListener("click", async () => {
          await applyVerdict(url, entry.id, group, value);
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
    note.value = reviews[entry.id]?.note ?? "";
    note.addEventListener("change", () => setReview(url, entry.id, { note: note.value.slice(0, 2000) }));
    li.appendChild(note);

    list.appendChild(li);
  }
}
