"use client";

import { useEffect, useSyncExternalStore } from "react";
import { Link } from "@/i18n/navigation";
import { readAuthHint, useAuthHint } from "@/lib/authHint";

/**
 * 관리자 메뉴 주소 — 관리자에게만 서버(/api/shell/nav)가 알려 준다.
 *
 * 헤더는 정적 HTML이라 관리자 여부를 렌더할 때 알 수 없고, 관리자 경로 슬러그는 비밀이라 HTML·번들에
 * 넣을 수도 없다. 로그인 힌트가 켜졌을 때만 한 번 묻고, 이 탭 세션 동안 sessionStorage에 기억한다
 * (로그아웃하면 지운다). 데스크톱 헤더와 모바일 메뉴가 같은 요청을 나눠 쓴다.
 */

const CACHE_KEY = "a11ychk-admin-href";

let adminHref: string | null = null;
let requested = false;
const listeners = new Set<() => void>();

function emit(next: string | null) {
  if (next === adminHref) return;
  adminHref = next;
  for (const l of listeners) l();
}

function load() {
  if (requested) return;
  requested = true;
  try {
    const cached = sessionStorage.getItem(CACHE_KEY);
    if (cached !== null) {
      emit(cached || null);
      return;
    }
  } catch {
    // sessionStorage 불가 — 매 페이지 로드마다 묻는다
  }
  fetch("/api/shell/nav", { cache: "no-store" })
    .then((res) => (res.ok ? (res.json() as Promise<{ adminHref?: unknown }>) : null))
    .then((data) => {
      const href = typeof data?.adminHref === "string" ? data.adminHref : null;
      try {
        sessionStorage.setItem(CACHE_KEY, href ?? "");
      } catch {
        // 기억 못 해도 동작은 같다
      }
      emit(href);
    })
    .catch(() => {
      // 다음 로그인 힌트 변화나 페이지 로드에서 다시 묻는다
      requested = false;
    });
}

function reset() {
  requested = false;
  try {
    sessionStorage.removeItem(CACHE_KEY);
  } catch {
    // 무시
  }
  emit(null);
}

function subscribe(callback: () => void): () => void {
  listeners.add(callback);
  return () => listeners.delete(callback);
}

/** 관리자면 관리자 메뉴 주소, 아니면(또는 아직 모르면) null */
export function useAdminHref(): string | null {
  const signedIn = useAuthHint();
  const href = useSyncExternalStore(
    subscribe,
    () => adminHref,
    () => null,
  );
  // 렌더 값(signedIn)이 아니라 DOM의 힌트를 본다 — 하이드레이션 직후 첫 effect는 서버 스냅샷(false)으로
  // 렌더된 상태에서 돌기 때문에, signedIn으로 판단하면 로그인 사용자의 기억값을 매번 지워 버린다
  useEffect(() => {
    if (readAuthHint()) load();
    else reset();
  }, [signedIn]);
  return signedIn ? href : null;
}

export function AdminNavLink({ label, className }: { label: string; className: string }) {
  const href = useAdminHref();
  if (!href) return null;
  return (
    <Link href={href} className={className}>
      {label}
    </Link>
  );
}
