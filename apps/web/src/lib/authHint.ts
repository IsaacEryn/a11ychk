import { useSyncExternalStore } from "react";
import { hasAuthCookie } from "./authCookie";

/**
 * 화면용 로그인 힌트 — <html data-auth="in|out">.
 *
 * 레이아웃이 정적이라 서버는 렌더할 때 사용자를 모른다. 첫 페인트 전에 boot 스크립트(lib/inlineScripts.ts)가
 * 인증 쿠키 유무로 값을 정하고, 그 뒤 변화는 AuthSync가 syncAuthHint로 따라간다. 화면에서 한쪽 상태만
 * 보이게 하는 용도이고 권한 판단이 아니다 — 보호 페이지·API는 서버가 세션을 검증한다.
 */

const EVENT = "a11ychk:auth";

export function readAuthHint(): boolean {
  return document.documentElement.getAttribute("data-auth") === "in";
}

/** 지금 쿠키로 힌트를 다시 정한다 — 바뀌었으면 구독자에게 알린다 */
export function syncAuthHint(): { was: boolean; now: boolean } {
  const was = readAuthHint();
  const now = hasAuthCookie(document.cookie);
  if (was !== now) {
    document.documentElement.setAttribute("data-auth", now ? "in" : "out");
    window.dispatchEvent(new Event(EVENT));
  }
  return { was, now };
}

function subscribe(callback: () => void): () => void {
  window.addEventListener(EVENT, callback);
  return () => window.removeEventListener(EVENT, callback);
}

/** 서버 스냅샷은 비로그인 — 정적 HTML과 같은 상태로 하이드레이션한 뒤 실제 값으로 바뀐다 */
export function useAuthHint(): boolean {
  return useSyncExternalStore(subscribe, readAuthHint, () => false);
}
