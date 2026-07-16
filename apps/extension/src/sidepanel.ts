import {
  AXE_RUN_TAGS,
  aggregateScan,
  customFindingsFromSignals,
  getManualCheckItems,
  getRuleEntry,
  normalizeAxeResults,
  type AxeRunResults,
  type Impact,
  type PageCheckSignals,
} from "@a11ychk/core/catalog";
import {
  applySimulationInPage,
  clearOverlayInPage,
  configureAxeLocaleInPage,
  collectPageSignals,
  highlightInPage,
  linearizeInPage,
  overlayMarkersInPage,
  overlayQueryInPage,
  overlayStructureInPage,
  overlayTargetSizeInPage,
  runAxeInPage,
} from "./injected";
import { wireTabs, wireTheme } from "./ui";
import { isEnglish, localizeHtml, msg, pick } from "./i18n";
// axe 공식 한국어 로케일 — UI가 한국어일 때 진단 메시지를 한국어로
import axeKoLocale from "axe-core/locales/ko.json";

// 빌드 시 esbuild define으로 치환됨
declare const process: { env: { A11YCHK_SITE_ORIGIN: string; A11YCHK_AXE_VERSION: string } };
const SITE_ORIGIN = process.env.A11YCHK_SITE_ORIGIN;
const AXE_VERSION = process.env.A11YCHK_AXE_VERSION;

interface StoredSession {
  accessToken: string;
  expiresAt: number;
  email?: string;
}

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

async function getActiveTab(): Promise<chrome.tabs.Tab | undefined> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function getSession(): Promise<StoredSession | null> {
  const { a11ychk_session } = await chrome.storage.local.get("a11ychk_session");
  const s = a11ychk_session as StoredSession | undefined;
  if (s && s.accessToken && s.expiresAt > Date.now()) return s;
  return null;
}

/** 연결(로그인) 페이지 열기 */
function openConnect() {
  void chrome.tabs.create({ url: `${SITE_ORIGIN}/${isEnglish() ? "en" : "ko"}/extension/connect` });
}

/** 확장 연결 해제 — 저장된 세션 삭제 */
async function logout() {
  await chrome.storage.local.remove("a11ychk_session");
  await renderAccount();
}

/** 계정 영역(로그인/로그아웃) + 헤더 연결 배지 렌더 */
async function renderAccount() {
  const session = await getSession();
  const conn = $("conn");
  const box = $("account");
  box.innerHTML = "";

  if (session) {
    conn.textContent = msg("connOn");
    conn.classList.add("on");
    box.className = "account connected";
    const who = document.createElement("span");
    who.className = "who";
    who.append(`${msg("connOn")} · `);
    const b = document.createElement("b");
    b.textContent = session.email ?? msg("accountTitle");
    who.appendChild(b);
    const out = document.createElement("button");
    out.type = "button";
    out.className = "logout";
    out.textContent = msg("logout");
    out.addEventListener("click", logout);
    box.append(who, out);
    // 저장 버튼·프로세스 태그는 검사 결과가 있을 때만 별도 노출
  } else {
    conn.textContent = msg("connOff");
    conn.classList.remove("on");
    box.className = "account disconnected";
    const p = document.createElement("p");
    p.textContent = msg("loginPitch");
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = msg("loginCta");
    btn.addEventListener("click", openConnect);
    box.append(p, btn);
    // 로그아웃 시 저장 UI 숨김
    $("save").hidden = true;
    $("procWrap").hidden = true;
  }
}

/** 비로그인 일일 무료 검사 횟수 (로컬 집계 — 가입 유도) */
const ANON_DAILY_LIMIT = 3;

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

async function getAnonUsage(): Promise<number> {
  const { anon_usage } = await chrome.storage.local.get("anon_usage");
  const u = anon_usage as { day: string; count: number } | undefined;
  return u && u.day === todayKey() ? u.count : 0;
}

async function bumpAnonUsage(): Promise<number> {
  const next = (await getAnonUsage()) + 1;
  await chrome.storage.local.set({ anon_usage: { day: todayKey(), count: next } });
  return next;
}

/** 사용량 안내/가입 유도 문구 갱신 */
function setUsageNote(html: { text: string; cta?: boolean; err?: boolean }) {
  const el = $("usage");
  el.innerHTML = "";
  const span = document.createElement("span");
  if (html.err) span.className = "err";
  span.textContent = html.text;
  el.appendChild(span);
  if (html.cta) {
    el.appendChild(document.createTextNode(" "));
    const a = document.createElement("a");
    a.href = `${SITE_ORIGIN}/${isEnglish() ? "en" : "ko"}/login`;
    a.target = "_blank";
    a.rel = "noopener";
    a.textContent = msg("signupCta");
    el.appendChild(a);
  }
}

const IMPACTS: Impact[] = ["critical", "serious", "moderate", "minor"];
const IMPACT_LABEL: Record<Impact, string> = {
  critical: msg("impactCritical"),
  serious: msg("impactSerious"),
  moderate: msg("impactModerate"),
  minor: msg("impactMinor"),
};

/** MAIN world에서 axe 실행 — 단순 표현식이라 번들러 헬퍼 오염 위험 없음 */
async function scan() {
  const tab = await getActiveTab();
  if (!tab?.id || !tab.url || !/^https?:/.test(tab.url)) {
    $("target").innerHTML = `<span class="err">${msg("errUnscannable")}</span>`;
    return;
  }
  currentTabId = tab.id;
  const scanBtn = $<HTMLButtonElement>("scan");

  // ── 사용량 확인: 로그인 = 서버 확장 한도(웹 검사와 분리) / 비로그인 = 로컬 3회·가입 유도 ──
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
    if (used >= ANON_DAILY_LIMIT) {
      setUsageNote({
        text: msg("anonLimitReached", [ANON_DAILY_LIMIT]),
        cta: true,
        err: true,
      });
      return;
    }
  }

  scanBtn.disabled = true;
  scanBtn.textContent = msg("scanning");
  try {
    // 1) axe 라이브러리 주입 (MAIN world)
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      world: "MAIN",
      files: ["vendor/axe.min.js"],
    });
    if (!isEnglish()) {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        world: "MAIN",
        args: [axeKoLocale],
        func: configureAxeLocaleInPage,
      });
    }
    // 2) axe 실행
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      world: "MAIN",
      args: [AXE_RUN_TAGS],
      func: runAxeInPage,
    });
    const raw = results[0]?.result as AxeRunResults | undefined;
    if (!raw) throw new Error(msg("errFetchResults"));
    const page = normalizeAxeResults(tab.url, raw);

    // 3) 자체 커스텀 검사 (서버 스캐너와 동일 규칙 — 리플로우 제외)
    try {
      const signalResults = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: collectPageSignals,
      });
      const signals = signalResults[0]?.result as PageCheckSignals | undefined;
      if (signals) {
        const custom = customFindingsFromSignals(signals);
        page.violations.push(...custom.violations);
        page.passes.push(...custom.passes);
        page.incomplete.push(...custom.incomplete);
      }
    } catch {
      // 커스텀 검사 실패 — axe 결과만으로 진행
    }

    const summary = aggregateScan([page], AXE_VERSION);
    renderResult(page, summary, tab.url);

    // 비로그인: 로컬 사용량 증가 + 가입 유도
    if (!session) {
      const used = await bumpAnonUsage();
      setUsageNote({
        text: msg("anonUsage", [used, ANON_DAILY_LIMIT]),
        cta: true,
      });
    }
  } catch (e) {
    // 에러 메시지는 페이지 컨텍스트에서 올 수 있으므로 textContent로만 렌더 (XSS 방지)
    const target = $("target");
    target.textContent = "";
    const err = document.createElement("span");
    err.className = "err";
    err.textContent = msg("errScanFailed", [(e as Error).message]);
    target.appendChild(err);
  } finally {
    scanBtn.disabled = false;
    scanBtn.textContent = msg("rescan");
  }
}

let lastPage: ReturnType<typeof normalizeAxeResults> | null = null;
let currentTabId: number | null = null;

function renderResult(
  page: ReturnType<typeof normalizeAxeResults>,
  summary: ReturnType<typeof aggregateScan>,
  url: string,
) {
  lastPage = page;
  $("result").hidden = false;
  $("rate").textContent = String(summary.complianceRate);

  const impact = $("impact");
  impact.innerHTML = "";
  for (const key of IMPACTS) {
    const li = document.createElement("li");
    const label = document.createElement("span");
    label.textContent = IMPACT_LABEL[key];
    const val = document.createElement("b");
    val.textContent = String(summary.byImpact[key]);
    li.append(label, val);
    impact.appendChild(li);
  }

  const list = $("violations");
  list.innerHTML = "";
  const byRule = new Map<string, number>();
  for (const v of page.violations) byRule.set(v.ruleId, v.nodes.length);
  const sorted = [...page.violations].sort(
    (a, b) => IMPACTS.indexOf(a.impact) - IMPACTS.indexOf(b.impact),
  );
  if (sorted.length === 0) {
    const li = document.createElement("li");
    li.textContent = msg("noViolations");
    li.style.borderColor = "var(--seal)";
    list.appendChild(li);
  }
  const tabId = currentTabId;
  for (const v of sorted) {
    const entry = getRuleEntry(v.ruleId, v.tags);
    const li = document.createElement("li");
    const title = document.createElement("p");
    title.className = "vt";
    const badge = document.createElement("span");
    badge.className = "badge";
    badge.textContent = IMPACT_LABEL[v.impact];
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
            btn.textContent = r[0]?.result ? msg("shown") : msg("notFound");
          } catch {
            btn.textContent = msg("failedShort");
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

  // 연결돼 있으면 저장 버튼·프로세스 태그·저장 위치 선택 노출
  getSession().then((s) => {
    $("save").hidden = !s;
    $("procWrap").hidden = !s;
    $("saveDest").hidden = !s;
    if (s) void populateSaveTargets(s.accessToken, url);
  });
  void url;
}

/** 저장 위치 셀렉트 채우기 — 새 보고서 + 사용자의 기존 보고서(같은 사이트 우선) */
async function populateSaveTargets(accessToken: string, pageUrl: string) {
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

async function saveToAccount() {
  const session = await getSession();
  if (!session || !lastPage) return;
  const saveBtn = $<HTMLButtonElement>("save");
  const msgEl = $("saveMsg");
  saveBtn.disabled = true;
  msgEl.textContent = msg("saving");
  try {
    const reviewMap = await getReviewState(lastPage.url);
    const reviews = Object.entries(reviewMap).map(([itemId, v]) => ({
      standard: "kwcag" as const,
      itemId,
      outcome: v.outcome,
      note: v.note ?? "",
      // 확장은 현재 페이지 단위이므로 판정을 그 페이지에 귀속
      pages: [lastPage!.url],
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
        page: lastPage,
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
      void populateSaveTargets(session.accessToken, lastPage.url);
    }
  } catch {
    msgEl.innerHTML = `<span class="err">${msg("errNetwork")}</span>`;
  } finally {
    saveBtn.disabled = false;
  }
}

// ─── 수동 점검 · 전문가 판정 ───
type Verdict = "passed" | "failed" | "cannotTell";
interface ReviewEntry {
  outcome: Verdict;
  note: string;
}
type ReviewMap = Record<string, ReviewEntry>;

const VERDICTS: { value: Verdict; label: string }[] = [
  { value: "passed", label: msg("verdictPass") },
  { value: "failed", label: msg("verdictFail") },
  { value: "cannotTell", label: msg("verdictHold") },
];

/**
 * 판정 저장 키용 URL 정규화 — 해시·쿼리 순서 변형·기본 포트·트레일링 슬래시로
 * 같은 페이지의 판정이 갈라지는 것을 방지한다.
 */
function normalizeReviewUrl(raw: string): string {
  try {
    const u = new URL(raw);
    u.hash = "";
    if ((u.protocol === "http:" && u.port === "80") || (u.protocol === "https:" && u.port === "443")) u.port = "";
    u.searchParams.sort();
    let s = u.toString();
    if (u.pathname === "/" && !u.search && s.endsWith("/")) s = s.slice(0, -1);
    return s;
  } catch {
    return raw;
  }
}

const reviewKey = (url: string) => `review:${normalizeReviewUrl(url)}`;

async function getReviewState(url: string): Promise<ReviewMap> {
  const key = reviewKey(url);
  const stored = await chrome.storage.local.get(key);
  return (stored[key] as ReviewMap | undefined) ?? {};
}

async function setReview(url: string, itemId: string, patch: Partial<ReviewEntry>) {
  const cur = await getReviewState(url);
  const prev = cur[itemId] ?? { outcome: "cannotTell", note: "" };
  cur[itemId] = { ...prev, ...patch };
  await chrome.storage.local.set({ [reviewKey(url)]: cur });
}

/** WCAG 성공기준 → 관련 요소 선택자·라벨 (수동 항목 맞춤 강조용) */
const SC_HIGHLIGHT: Record<string, { selector: string; label: string }> = {
  "1.1.1": { selector: "img,[role=img],input[type=image],area,svg", label: msg("hlImages") },
  "1.2.1": { selector: "video,audio", label: msg("hlMedia") },
  "1.2.2": { selector: "video,audio", label: msg("hlMediaCaptions") },
  "1.2.3": { selector: "video", label: msg("hlVideoAlt") },
  "1.3.1": { selector: "table,ul,ol,dl,fieldset", label: msg("hlStructure") },
  "1.4.2": { selector: "video[autoplay],audio[autoplay]", label: msg("hlAutoplay") },
  "2.1.1": { selector: "a[href],button,input,select,textarea,[onclick],[role=button]", label: msg("hlOperable") },
  "2.4.1": { selector: "a[href^='#'],[id]", label: msg("hlSkip") },
  "2.4.4": { selector: "a[href]", label: msg("hlLinks") },
  "2.4.6": { selector: "h1,h2,h3,h4,h5,h6,[role=heading]", label: msg("hlHeadings") },
  "2.5.8": { selector: "a[href],button,[role=button],input", label: msg("hlTargetSize") },
  "3.3.2": { selector: "input:not([type=hidden]),select,textarea,label", label: msg("hlForms") },
};
/** KWCAG 항목의 대응 WCAG SC들에서 강조 선택자 조합 */
function highlightForItem(item: { wcag: string[] }): { selector: string; label: string } | null {
  const parts: string[] = [];
  let label = "";
  for (const sc of item.wcag) {
    const h = SC_HIGHLIGHT[sc];
    if (h) {
      parts.push(h.selector);
      if (!label) label = h.label;
    }
  }
  if (parts.length === 0) return null;
  return { selector: [...new Set(parts.join(",").split(","))].join(","), label };
}

async function renderManual(url: string) {
  const items = getManualCheckItems();
  const reviews = await getReviewState(url);
  const list = $("manual");
  list.innerHTML = "";
  for (const item of items) {
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
      btn.textContent = v.label;
      btn.setAttribute("aria-pressed", String(reviews[item.id]?.outcome === v.value));
      btn.addEventListener("click", async () => {
        const already = btn.getAttribute("aria-pressed") === "true";
        const next = already ? undefined : v.value;
        if (next) await setReview(url, item.id, { outcome: next });
        else {
          const cur = await getReviewState(url);
          delete cur[item.id];
          await chrome.storage.local.set({ [reviewKey(url)]: cur });
        }
        group.querySelectorAll(".verdict").forEach((b) => b.setAttribute("aria-pressed", "false"));
        if (next) btn.setAttribute("aria-pressed", "true");
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

// ─── 시각 도구 컨트롤러 (패널 측 상태 + 주입 실행) ───

type StructKind = "headings" | "landmarks" | "focus" | "targets";
type OverlayView = "none" | "issues" | StructKind | "manual";
let currentView: OverlayView = "none";
let currentSim = "none";
let linearizeOn = false;
let activeHighlightBtn: HTMLButtonElement | null = null;

/** 활성 탭에 주입 함수 실행 */
async function runInPage<Args extends unknown[], R>(
  func: (...args: Args) => R,
  ...args: Args
): Promise<Awaited<R> | undefined> {
  if (!currentTabId) return undefined;
  try {
    // chrome.scripting은 주입 함수가 Promise를 반환하면 값을 resolve해 전달한다
    const r = await chrome.scripting.executeScript({ target: { tabId: currentTabId }, func, args });
    return r[0]?.result as Awaited<R> | undefined;
  } catch {
    return undefined;
  }
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
  currentView = "none";
  if (currentSim !== "none") await runInPage(applySimulationInPage, currentSim);
  if (linearizeOn) await runInPage(linearizeInPage, true);
}

/** 위반 표시 토글 (검사 결과 필요) */
async function setIssuesView(on: boolean) {
  if (on && lastPage) {
    const markers = lastPage.violations.flatMap((v) =>
      v.nodes.map((n) => ({
        selector: n.selector,
        color: MARKER_COLOR[v.impact],
        label: IMPACT_LABEL[v.impact],
      })),
    );
    await runInPage(overlayMarkersInPage, markers);
    currentView = "issues";
  } else {
    await clearOverlayView();
  }
  syncToolButtons();
}

/** 구조·크기 오버레이 토글 */
async function setStructView(kind: StructKind, on: boolean) {
  if (on) {
    if (kind === "targets") await runInPage(overlayTargetSizeInPage);
    else await runInPage(overlayStructureInPage, kind, msg("skippedLabel"));
    currentView = kind;
  } else {
    await clearOverlayView();
  }
  syncToolButtons();
}

/** 수동 항목 맞춤 강조 토글 */
async function toggleManualHighlight(selector: string, label: string, btn: HTMLButtonElement) {
  const on = btn.getAttribute("aria-pressed") !== "true";
  if (on) {
    await runInPage(
    overlayQueryInPage,
    selector,
    msg("overlayCountSome", [label, "{n}"]),
    msg("overlayCountNone", [label]),
  );
    currentView = "manual";
    activeHighlightBtn = btn;
  } else {
    await clearOverlayView();
    activeHighlightBtn = null;
  }
  syncToolButtons();
}

/** 오버레이·시뮬·선형화 전체 지우기 + 상태 초기화 */
async function clearAll() {
  await runInPage(clearOverlayInPage);
  currentView = "none";
  currentSim = "none";
  linearizeOn = false;
  activeHighlightBtn = null;
  syncToolButtons();
}

/** 버튼 aria-pressed 상태 동기화 */
function syncToolButtons() {
  const issuesBtn = document.getElementById("toggleIssues");
  if (issuesBtn) issuesBtn.setAttribute("aria-pressed", String(currentView === "issues"));
  document.querySelectorAll<HTMLButtonElement>("[data-struct]").forEach((b) => {
    const k = b.dataset.struct!;
    const active = k === "linearize" ? linearizeOn : currentView === k;
    b.setAttribute("aria-pressed", String(active));
  });
  document.querySelectorAll<HTMLButtonElement>("[data-sim]").forEach((b) => {
    b.setAttribute("aria-pressed", String(currentSim === b.dataset.sim));
  });
  // 수동 강조 버튼: 현재 뷰가 manual이 아니면 모두 해제
  if (currentView !== "manual" && activeHighlightBtn) {
    activeHighlightBtn.setAttribute("aria-pressed", "false");
    activeHighlightBtn = null;
  }
}

function wireVisualTools() {
  $("toggleIssues").addEventListener("click", () => setIssuesView(currentView !== "issues"));
  $("clearOverlay").addEventListener("click", clearAll);
  $("clearOverlay2").addEventListener("click", clearAll);

  document.querySelectorAll<HTMLButtonElement>("[data-struct]").forEach((btn) => {
    const kind = btn.dataset.struct!;
    btn.addEventListener("click", async () => {
      if (kind === "linearize") {
        linearizeOn = !linearizeOn;
        await runInPage(linearizeInPage, linearizeOn);
        syncToolButtons();
      } else {
        await setStructView(kind as StructKind, currentView !== kind);
      }
    });
  });

  document.querySelectorAll<HTMLButtonElement>("[data-sim]").forEach((btn) => {
    const mode = btn.dataset.sim!;
    btn.addEventListener("click", async () => {
      currentSim = currentSim === mode ? "none" : mode;
      await runInPage(applySimulationInPage, currentSim);
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
  ratioEl.innerHTML = `${msg("ccRatioLabel")} <span class="cc-ratio">${ratio}</span> : 1 <span style="color:var(--ink-faint)">(${ccBg} / ${ccFg})</span>`;
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
    const suggestion = suggestColor(ccBg, ccFg);
    let html =
      msg("ccGuideFail");
    if (suggestion) {
      html += `<br>${msg("ccSuggestion")} <b style="color:${suggestion}">${suggestion}</b> `;
      html += `<span style="display:inline-block;width:12px;height:12px;border-radius:3px;background:${suggestion};border:1px solid var(--line);vertical-align:middle"></span>`;
      html += msg("ccRatioSuffix", [Math.round(ratioOf(ccBg, suggestion) * 100) / 100]);
    }
    guide.innerHTML = html;
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

async function init() {
  // 정적 HTML 로컬라이즈 + 문서 언어 반영 (default_locale ko, en 지원)
  localizeHtml();
  document.documentElement.lang = isEnglish() ? "en" : "ko";

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
  wireTabs();
  await wireTheme();

  await refreshActiveTab();
  // 사이드 패널은 탭을 바꿔도 떠 있으므로, 활성 탭 변경·주소 변경 시 갱신
  chrome.tabs.onActivated.addListener(() => void refreshActiveTab());
  chrome.tabs.onUpdated.addListener((_id, info, tab) => {
    if (tab.active && info.url) void refreshActiveTab();
  });
}

/** 현재 활성 탭을 다시 읽어 대상 URL·수동 체크리스트를 갱신 */
async function refreshActiveTab() {
  const tab = await getActiveTab();
  const url = tab?.url ?? "";
  const prevTabId = currentTabId;
  currentTabId = tab?.id ?? null;

  // 탭이 바뀌었거나 다른 페이지로 이동 → 이전 탭의 결과·오버레이 상태는 무효
  const pageChanged = prevTabId !== currentTabId || (lastPage !== null && lastPage.url !== url);
  if (pageChanged && lastPage) {
    lastPage = null;
    $("result").hidden = true; // 결과 섹션(점수·위반 목록)은 lastPage 기준이므로 숨김
  }
  if (pageChanged) {
    // 오버레이는 이전 페이지에만 존재 — 패널 측 토글 상태를 리셋해 불일치 방지
    currentView = "none";
    currentSim = "none";
    linearizeOn = false;
    activeHighlightBtn?.setAttribute("aria-pressed", "false");
    activeHighlightBtn = null;
    syncToolButtons();
  }

  const scannable = /^https?:/.test(url);
  $("target").textContent = scannable ? url : url ? msg("errInternalPage") : msg("errNoTab");
  $<HTMLButtonElement>("scan").disabled = !scannable;
  if (scannable) await renderManual(url);
  else $("manual").innerHTML = "";
}

void init();
