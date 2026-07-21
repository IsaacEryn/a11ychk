"use client";

import { useCallback, useRef, useState } from "react";

/**
 * 클립보드 복사 공통 훅 — 성공/실패 상태와 스크린리더 알림 텍스트를 함께 관리한다.
 * (BadgeEmbed·ShareLinkButton 등에서 중복되던 clipboard+setTimeout 패턴 통합)
 *
 * 사용: const { status, copy } = useCopyToClipboard();
 * 버튼 라벨은 status로 전환하고, 근처에 <span role="status">로 알림 텍스트를 렌더하면
 * 시각·보조기술 사용자 모두에게 결과가 전달된다. 실패(권한 거부 등) 시 "failed".
 */
export function useCopyToClipboard(resetMs = 2000) {
  const [status, setStatus] = useState<"idle" | "copied" | "failed">("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const copy = useCallback(
    (text: string) => {
      if (timer.current) clearTimeout(timer.current);
      navigator.clipboard
        .writeText(text)
        .then(() => setStatus("copied"))
        .catch(() => setStatus("failed"));
      timer.current = setTimeout(() => setStatus("idle"), resetMs);
    },
    [resetMs],
  );

  return { status, copy };
}
