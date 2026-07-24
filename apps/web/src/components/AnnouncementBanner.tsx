"use client";

import { useEffect, useSyncExternalStore } from "react";
import { Link } from "@/i18n/navigation";

const DISMISS_KEY = "a11ychk-announcement-dismissed";
const VIEWS_KEY = "a11ychk-announcement-views";
/** 같은 공지를 이 횟수만큼 본 뒤에는 배너를 접는다 (다음 방문부터 미노출) */
const MAX_VIEWS = 5;

/** localStorage 구독 — 닫기(같은 창)와 다른 탭의 변경을 모두 받는다 */
function subscribe(cb: () => void) {
  window.addEventListener("storage", cb);
  return () => window.removeEventListener("storage", cb);
}

function isDismissed(id: string): boolean {
  try {
    return localStorage.getItem(DISMISS_KEY) === id;
  } catch {
    return false;
  }
}

function readViews(id: string): number {
  try {
    const raw = JSON.parse(localStorage.getItem(VIEWS_KEY) ?? "{}") as Record<string, number>;
    return typeof raw[id] === "number" ? raw[id] : 0;
  } catch {
    return 0;
  }
}

/**
 * 노출 횟수 상한 도달 여부 — 이번 페이지 로드에서 1회만 판정하고 캐시한다.
 * 아래 적립(bumpViews)이 판정을 뒤집어 배너가 읽는 도중 사라지는 일을 막는다.
 */
const cappedCache = new Map<string, boolean>();
function isCapped(id: string): boolean {
  const cached = cappedCache.get(id);
  if (cached !== undefined) return cached;
  const capped = readViews(id) >= MAX_VIEWS;
  cappedCache.set(id, capped);
  return capped;
}

/** 이번 노출 적립 — 페이지 로드당 1회 (상한 도달 시엔 적립하지 않는다) */
const bumped = new Set<string>();
function bumpViews(id: string): void {
  if (bumped.has(id) || isCapped(id)) return;
  bumped.add(id);
  try {
    // 공지는 1건만 노출되므로 이전 공지의 카운트는 함께 정리한다
    localStorage.setItem(VIEWS_KEY, JSON.stringify({ [id]: readViews(id) + 1 }));
  } catch {
    // localStorage 불가(사생활 보호 모드 등) — 횟수 상한 없이 노출
  }
}

/**
 * 서비스 공지 배너 — 노출 중인 공지 1건을 헤더 위에 표시한다.
 * 약관의 "서비스 내 공지" 조항을 구현하는 채널.
 *
 * 사라지는 조건 3가지 — 모두 "보고 있는 화면에서 갑자기 없어지지 않는다":
 *  1) 사용자가 닫기 (id 기억 — 새 공지가 오면 다시 표시)
 *  2) 이미 MAX_VIEWS회 본 공지 (판정은 로드당 1회 — 읽는 중 사라지지 않음)
 *  3) 관리자가 지정한 노출 기간 만료 (서버에서 제외 — layout이 필터)
 *
 * 타이머로 자동 숨기지 않는 이유: 읽기에 시간 제한을 두면 WCAG 2.2.1(시간 조절)에
 * 어긋난다. 화면 확대·스크린리더 사용자는 배너에 도달하는 데만 시간이 걸린다.
 */
export function AnnouncementBanner({
  id,
  title,
  moreLabel,
  moreAriaLabel,
  closeLabel,
  ariaLabel,
}: {
  id: string;
  title: string;
  moreLabel: string;
  /** 링크 목록으로 탐색할 때도 어떤 공지인지 알 수 있게 제목을 포함한 접근 가능한 이름 */
  moreAriaLabel: string;
  closeLabel: string;
  ariaLabel: string;
}) {
  // 서버 스냅샷은 false — SSR·하이드레이션은 배너를 렌더하고, 그 뒤 클라이언트 판정을 반영한다
  // (getSnapshot이 원시값이라 안정적 — 매 렌더 새 객체를 만들지 않는다)
  const hidden = useSyncExternalStore(subscribe, () => isDismissed(id) || isCapped(id), () => false);

  // 외부 시스템(localStorage) 갱신만 — 이번 화면의 표시 여부는 위에서 이미 확정됐다
  useEffect(() => {
    bumpViews(id);
  }, [id]);

  if (hidden) return null;

  return (
    <aside
      aria-label={ariaLabel}
      className="border-b-[1.5px] border-[var(--color-ink)] bg-[var(--color-seal-tint)]"
    >
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 sm:px-6">
        <p className="min-w-0 flex-1 text-sm font-semibold">
          {/* 장식용 이모지 — 스크린리더가 "확성기"로 읽지 않도록 숨긴다.
              "공지"라는 정보는 위 aside의 aria-label이 전달한다 */}
          <span aria-hidden="true">📢</span> {title}{" "}
          <Link
            href="/notices"
            aria-label={moreAriaLabel}
            className="whitespace-nowrap font-bold text-[var(--color-seal)] underline underline-offset-4"
          >
            {moreLabel}
          </Link>
        </p>
        <button
          type="button"
          aria-label={closeLabel}
          onClick={() => {
            try {
              localStorage.setItem(DISMISS_KEY, id);
              window.dispatchEvent(new StorageEvent("storage", { key: DISMISS_KEY }));
            } catch {
              // localStorage 불가 — 세션 내 재표시 감수
            }
          }}
          className="rounded border-[1.5px] border-transparent px-2 py-1 text-sm font-bold text-[var(--color-ink-soft)] hover:border-[var(--color-line)]"
        >
          ✕
        </button>
      </div>
    </aside>
  );
}
