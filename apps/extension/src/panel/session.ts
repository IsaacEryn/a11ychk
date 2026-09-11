// 세션·계정 렌더 + 비로그인 사용량 집계
import { isEnglish, msg } from "../i18n";
import { expiresAtMs, refreshWithToken, revokeSession } from "../supabase";
import { $, SITE_ORIGIN, type StoredSession } from "./state";

/** 저장된 세션 삭제 — 만료·서버 401 공통 경로 (저장소 변경이 계정 영역 재렌더를 부른다) */
export async function clearSession(): Promise<void> {
  await chrome.storage.local.remove("a11ychk_session");
}

/** 만료까지 이 시간 이내면 미리 갱신 — 요청 도중 만료로 401을 맞지 않게 */
const REFRESH_AHEAD_MS = 5 * 60_000;
/** 동시 호출(사용량 조회 + 저장 대상 목록 등)이 refresh token을 두 번 쓰지 않게 갱신을 한 번으로 합친다 */
let refreshing: Promise<StoredSession | null> | null = null;

async function refreshSession(s: StoredSession): Promise<StoredSession | null> {
  if (!s.refreshToken) return null;
  refreshing ??= (async () => {
    try {
      const fresh = await refreshWithToken(s.refreshToken!);
      if (!fresh) return null;
      const next: StoredSession = {
        accessToken: fresh.access_token,
        refreshToken: fresh.refresh_token,
        expiresAt: expiresAtMs(fresh),
        email: fresh.user?.email ?? s.email,
      };
      await chrome.storage.local.set({ a11ychk_session: next });
      return next;
    } catch {
      return null;
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

export async function getSession(): Promise<StoredSession | null> {
  const { a11ychk_session } = await chrome.storage.local.get("a11ychk_session");
  const s = a11ychk_session as StoredSession | undefined;
  if (!s?.accessToken) return null;
  if (s.expiresAt - Date.now() > REFRESH_AHEAD_MS) return s;
  // 만료 임박·만료: 확장 전용 세션이면 조용히 갱신
  const refreshed = await refreshSession(s);
  if (refreshed) return refreshed;
  if (s.expiresAt > Date.now()) return s; // 갱신 실패했지만 아직 유효 — 남은 시간은 쓴다
  // 만료분은 그 자리에서 지운다 — 남겨 두면 헤더는 "연결됨"인데 검사는 비로그인
  // 경로로 내려가 무료 횟수를 대신 소모하는 어긋난 상태가 된다
  await clearSession();
  return null;
}

/** 연결(로그인) 페이지 열기 */
function openConnect() {
  void chrome.tabs.create({ url: `${SITE_ORIGIN}/${isEnglish() ? "en" : "ko"}/extension/connect` });
}

/** 확장 연결 해제 — 서버 쪽 세션(refresh token)까지 철회하고 저장된 세션 삭제 */
async function logout() {
  const { a11ychk_session } = await chrome.storage.local.get("a11ychk_session");
  const s = a11ychk_session as StoredSession | undefined;
  if (s?.refreshToken && s.accessToken) await revokeSession(s.accessToken);
  await clearSession();
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
