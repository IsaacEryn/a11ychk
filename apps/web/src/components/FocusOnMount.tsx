"use client";

import { useEffect, useRef, type ReactNode } from "react";

/**
 * 화면에 들어오자마자 포커스를 받는 영역 — 결제창에서 돌아온 결과 안내처럼, 페이지를 연 직후 가장 먼저 읽혀야 하는 내용에 쓴다.
 * 페이지 로드 때 이미 있는 role="alert"는 화면 낭독기가 읽지 않을 수 있어 포커스로 첫 낭독 대상을 만든다.
 * 포커스 링은 지우지 않는다(전역 포커스 스타일 그대로).
 */
export function FocusOnMount({ children, className }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.focus();
  }, []);
  return (
    <div ref={ref} tabIndex={-1} className={className}>
      {children}
    </div>
  );
}
