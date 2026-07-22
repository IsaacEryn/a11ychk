// 세션·계정 렌더 + 비로그인 사용량 집계
import { isEnglish, msg } from "../i18n";
import { $, SITE_ORIGIN, type StoredSession } from "./state";

export async function getSession(): Promise<StoredSession | null> {
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
export async function renderAccount() {
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

/** 비로그인 주간 무료 검사 횟수 (로컬 집계 — 가입 유도) */
export const ANON_WEEKLY_LIMIT = 3;

/** 이번 주 월요일 날짜(YYYY-MM-DD) — 주가 바뀌면 카운트가 자연 리셋된다 */
function weekKey(): string {
  const d = new Date();
  const day = d.getDay(); // 0=일
  d.setDate(d.getDate() - (day === 0 ? 6 : day - 1));
  return d.toISOString().slice(0, 10);
}

export async function getAnonUsage(): Promise<number> {
  const { anon_usage } = await chrome.storage.local.get("anon_usage");
  const u = anon_usage as { day: string; count: number } | undefined;
  // day 필드에 주 시작일을 저장(키 이름은 기존 데이터 호환을 위해 유지 — 구 일일 키는 불일치로 자연 리셋)
  return u && u.day === weekKey() ? u.count : 0;
}

export async function bumpAnonUsage(): Promise<number> {
  const next = (await getAnonUsage()) + 1;
  await chrome.storage.local.set({ anon_usage: { day: weekKey(), count: next } });
  return next;
}

/** 사용량 안내/가입 유도 문구 갱신 */
export function setUsageNote(html: { text: string; cta?: boolean; err?: boolean }) {
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
