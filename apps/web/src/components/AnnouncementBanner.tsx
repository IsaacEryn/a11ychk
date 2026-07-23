"use client";

import { useSyncExternalStore } from "react";
import { Link } from "@/i18n/navigation";

const DISMISS_KEY = "a11ychk-announcement-dismissed";

/** localStorage 구독 — 닫은 공지 id를 기억해 같은 공지는 다시 띄우지 않는다 */
function subscribe(cb: () => void) {
  window.addEventListener("storage", cb);
  return () => window.removeEventListener("storage", cb);
}
function readDismissed(): string {
  try {
    return localStorage.getItem(DISMISS_KEY) ?? "";
  } catch {
    return "";
  }
}

/**
 * 서비스 공지 배너 — active인 최신 공지 1건을 헤더 아래에 표시한다.
 * 약관의 "서비스 내 공지" 조항을 구현하는 채널. 닫으면 해당 공지 id를 기억하고,
 * 새 공지(id 변경)가 오면 다시 표시된다. 서버가 공지 데이터를 props로 내려 CLS 없음.
 */
export function AnnouncementBanner({
  id,
  title,
  moreLabel,
  closeLabel,
  ariaLabel,
}: {
  id: string;
  title: string;
  moreLabel: string;
  closeLabel: string;
  ariaLabel: string;
}) {
  // 서버 스냅샷은 "" — SSR과 첫 하이드레이션은 배너를 렌더하고, 마운트 후 localStorage를
  // 읽어 닫았던 공지면 제거한다(불일치 없이 안전, 닫은 사용자에겐 짧은 표시 후 사라짐)
  const dismissed = useSyncExternalStore(subscribe, readDismissed, () => "");
  if (dismissed === id) return null;

  return (
    <aside
      aria-label={ariaLabel}
      className="border-b-[1.5px] border-[var(--color-ink)] bg-[var(--color-seal-tint)]"
    >
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 sm:px-6">
        <p className="min-w-0 flex-1 text-sm font-semibold">
          📢 {title}{" "}
          <Link href="/notices" className="whitespace-nowrap font-bold text-[var(--color-seal)] underline underline-offset-4">
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
              // localStorage 불가(사생활 보호 모드 등) — 세션 내 재표시 감수
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
