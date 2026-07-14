import {
  AXE_RUN_TAGS,
  aggregateScan,
  getManualCheckItems,
  getRuleEntry,
  normalizeAxeResults,
  type AxeRunResults,
  type Impact,
} from "@a11ychk/core/catalog";

// 빌드 시 esbuild define으로 치환됨
declare const process: { env: { A11YCHK_SITE_ORIGIN: string } };
const SITE_ORIGIN = process.env.A11YCHK_SITE_ORIGIN;

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

const IMPACTS: Impact[] = ["critical", "serious", "moderate", "minor"];
const IMPACT_LABEL: Record<Impact, string> = {
  critical: "치명적",
  serious: "심각",
  moderate: "보통",
  minor: "경미",
};

/** MAIN world에서 axe 실행 — 단순 표현식이라 번들러 헬퍼 오염 위험 없음 */
function runAxeInPage(tags: string[]): Promise<AxeRunResults> {
  // @ts-expect-error axe는 vendor 스크립트로 주입됨
  return window.axe.run(document, {
    runOnly: { type: "tag", values: tags },
    resultTypes: ["violations", "passes", "incomplete"],
  });
}

async function scan() {
  const tab = await getActiveTab();
  if (!tab?.id || !tab.url || !/^https?:/.test(tab.url)) {
    $("target").innerHTML = '<span class="err">이 페이지는 검사할 수 없습니다 (http/https 페이지에서 실행하세요).</span>';
    return;
  }
  const scanBtn = $<HTMLButtonElement>("scan");
  scanBtn.disabled = true;
  scanBtn.textContent = "검사 중…";
  try {
    // 1) axe 라이브러리 주입 (MAIN world)
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      world: "MAIN",
      files: ["vendor/axe.min.js"],
    });
    // 2) axe 실행
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      world: "MAIN",
      args: [AXE_RUN_TAGS],
      func: runAxeInPage,
    });
    const raw = results[0]?.result as AxeRunResults | undefined;
    if (!raw) throw new Error("검사 결과를 가져오지 못했습니다.");
    const page = normalizeAxeResults(tab.url, raw);
    const summary = aggregateScan([page], "4.10");
    renderResult(page, summary, tab.url);
  } catch (e) {
    $("target").innerHTML = `<span class="err">검사에 실패했습니다: ${(e as Error).message}</span>`;
  } finally {
    scanBtn.disabled = false;
    scanBtn.textContent = "다시 검사";
  }
}

let lastPage: ReturnType<typeof normalizeAxeResults> | null = null;

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
    li.textContent = "자동 검사에서 위반이 발견되지 않았습니다. 수동 점검을 진행하세요.";
    li.style.borderColor = "var(--seal)";
    list.appendChild(li);
  }
  for (const v of sorted) {
    const entry = getRuleEntry(v.ruleId, v.tags);
    const li = document.createElement("li");
    const title = document.createElement("p");
    title.className = "vt";
    const badge = document.createElement("span");
    badge.className = "badge";
    badge.textContent = IMPACT_LABEL[v.impact];
    title.append(badge, document.createTextNode(entry.title.ko));
    const meta = document.createElement("p");
    meta.className = "vmeta";
    meta.textContent =
      `${v.nodes.length}개 요소` +
      (entry.wcag.length ? ` · WCAG ${entry.wcag.join(", ")}` : "") +
      (entry.kwcag.length ? ` · KWCAG ${entry.kwcag.join(", ")}` : "");
    li.append(title, meta);
    list.appendChild(li);
  }

  // 연결돼 있으면 저장 버튼 노출
  getSession().then((s) => {
    $("save").hidden = !s;
  });
  void url;
}

async function saveToAccount() {
  const session = await getSession();
  if (!session || !lastPage) return;
  const saveBtn = $<HTMLButtonElement>("save");
  const msg = $("saveMsg");
  saveBtn.disabled = true;
  msg.textContent = "저장 중…";
  try {
    const manual = await getManualState(lastPage.url);
    const res = await fetch(`${SITE_ORIGIN}/api/extension/scan`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.accessToken}`,
      },
      body: JSON.stringify({ page: lastPage, manual }),
    });
    const data = (await res.json()) as { id?: string; error?: string };
    if (!res.ok || !data.id) {
      msg.innerHTML = `<span class="err">${data.error ?? "저장에 실패했습니다."}</span>`;
    } else {
      msg.textContent = "저장되었습니다. 마이페이지에서 확인하세요.";
    }
  } catch {
    msg.innerHTML = '<span class="err">네트워크 오류가 발생했습니다.</span>';
  } finally {
    saveBtn.disabled = false;
  }
}

// ─── 수동 체크리스트 ───
async function getManualState(url: string): Promise<string[]> {
  const key = `manual:${url}`;
  const stored = await chrome.storage.local.get(key);
  return (stored[key] as string[] | undefined) ?? [];
}

async function renderManual(url: string) {
  const items = getManualCheckItems();
  const checked = new Set(await getManualState(url));
  const list = $("manual");
  list.innerHTML = "";
  for (const item of items) {
    const li = document.createElement("li");
    const label = document.createElement("label");
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = checked.has(item.id);
    cb.addEventListener("change", async () => {
      const cur = new Set(await getManualState(url));
      if (cb.checked) cur.add(item.id);
      else cur.delete(item.id);
      await chrome.storage.local.set({ [`manual:${url}`]: [...cur] });
    });
    const text = document.createElement("span");
    const mid = document.createElement("span");
    mid.className = "mid";
    mid.textContent = item.id;
    text.append(mid, document.createTextNode(item.name.ko));
    label.append(cb, text);
    li.appendChild(label);
    list.appendChild(li);
  }
}

async function init() {
  const tab = await getActiveTab();
  const url = tab?.url ?? "";
  $("target").textContent = url;

  const session = await getSession();
  const conn = $("conn");
  if (session) {
    conn.textContent = "연결됨";
    conn.classList.add("on");
  } else {
    conn.textContent = "미연결";
  }

  $("connectLink").setAttribute("href", `${SITE_ORIGIN}/ko/extension/connect`);
  $("siteLink").setAttribute("href", `${SITE_ORIGIN}/ko`);

  if (/^https?:/.test(url)) await renderManual(url);

  $("scan").addEventListener("click", scan);
  $("save").addEventListener("click", saveToAccount);
}

void init();
