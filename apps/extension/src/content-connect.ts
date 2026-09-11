/**
 * a11ychk.com/{locale}/extension/connect 페이지에서 실행되는 콘텐츠 스크립트.
 * 연결 페이지가 window.postMessage로 보내는 세션 토큰을 받아 확장 저장소에 보관한다.
 * 토큰이 DOM에 남지 않아(과거 방식) 다른 확장이 잔류물을 스크랩하는 표면이 없다.
 * 페이지에 확장 ID를 노출하지 않는다.
 */
import { exchangeTokenHash, expiresAtMs } from "./supabase";

interface ExtPayload {
  accessToken: string;
  expiresAt: number;
  email?: string;
  /** 1회용 토큰 해시 — 있으면 확장 전용 세션(자체 refresh token)으로 교환한다 */
  tokenHash?: string;
}

function isValidPayload(p: unknown): p is ExtPayload {
  return (
    !!p &&
    typeof (p as ExtPayload).accessToken === "string" &&
    typeof (p as ExtPayload).expiresAt === "number"
  );
}

let saved = false;

async function save(payload: ExtPayload) {
  if (saved) return;
  saved = true;
  // 확장 전용 세션: 웹 세션과 refresh token 회전이 얽히지 않아 1시간마다 재연결하지 않아도 된다.
  // 교환에 실패하면 예전 방식(웹 access token 그대로, 만료 시 재연결)으로 내려간다.
  const own = payload.tokenHash ? await exchangeTokenHash(payload.tokenHash).catch(() => null) : null;
  await chrome.storage.local.set({
    a11ychk_session: own
      ? {
          accessToken: own.access_token,
          refreshToken: own.refresh_token,
          expiresAt: expiresAtMs(own),
          email: own.user?.email ?? payload.email,
        }
      : {
          accessToken: payload.accessToken,
          expiresAt: payload.expiresAt,
          email: payload.email,
        },
  });
  // 페이지에 저장 완료 통지 → 페이지는 토큰을 메모리에서 제거하고 연결 상태로 전환
  window.postMessage({ __a11ychk: "saved" }, window.location.origin);
}

window.addEventListener("message", (e: MessageEvent) => {
  // 우리 오리진·우리 window에서 온 메시지만 신뢰
  if (e.origin !== window.location.origin || e.source !== window) return;
  const data = e.data as { __a11ychk?: string; payload?: unknown } | null;
  if (data?.__a11ychk === "token" && isValidPayload(data.payload)) {
    void save(data.payload);
  }
});

// 확장 준비 완료를 페이지에 알림 (페이지 세션 로드가 늦어도 재수신하도록 주기적으로 재통지)
function announce() {
  window.postMessage({ __a11ychk: "ext-ready" }, window.location.origin);
}
announce();
let tries = 0;
const timer = setInterval(() => {
  tries += 1;
  if (saved || tries > 20) {
    clearInterval(timer);
    return;
  }
  announce();
}, 500);
