import type { ReactNode } from "react";

type Variant = "error" | "warn" | "info" | "success";

/**
 * 재사용 알림 박스 — 폼·페이지에서 일관된 안내/경고를 준다.
 * 색은 globals.css 토큰만 사용(모두 AA 대비 검증됨). 아이콘은 장식이라 aria-hidden.
 *
 * role: 오류/경고는 즉시 알림(assertive), 정보/성공은 부드럽게(polite).
 * live=false로 정적 안내(초기 렌더 시 읽히지 않게)로 쓸 수 있다.
 */
const STYLES: Record<Variant, { box: string; icon: string; mark: string }> = {
  error: {
    box: "border-[var(--color-crit)] bg-[var(--color-crit-tint)]",
    icon: "text-[var(--color-crit)]",
    mark: "!",
  },
  warn: {
    box: "border-[var(--color-line)] bg-[var(--color-warn-tint)]",
    icon: "text-[var(--color-ink)]",
    mark: "!",
  },
  info: {
    box: "border-[var(--color-line)] bg-[var(--color-seal-tint)]",
    icon: "text-[var(--color-seal)]",
    mark: "i",
  },
  success: {
    box: "border-[var(--color-seal)] bg-[var(--color-seal-tint)]",
    icon: "text-[var(--color-seal)]",
    mark: "✓",
  },
};

export function Notice({
  variant = "info",
  title,
  children,
  live = true,
  className = "",
}: {
  variant?: Variant;
  title?: ReactNode;
  children?: ReactNode;
  /** aria-live 영역으로 알릴지 (동적 등장 시 true). 정적 안내면 false */
  live?: boolean;
  className?: string;
}) {
  const s = STYLES[variant];
  const role = variant === "error" || variant === "warn" ? "alert" : "status";
  const liveProps = live ? { role, "aria-live": role === "alert" ? ("assertive" as const) : ("polite" as const) } : {};

  return (
    <div {...liveProps} className={`flex gap-3 border-[1.5px] p-4 ${s.box} ${className}`}>
      <span
        aria-hidden="true"
        className={`font-display mt-0.5 flex h-5 w-5 flex-none items-center justify-center rounded-full border-[1.5px] border-current text-xs font-extrabold ${s.icon}`}
      >
        {s.mark}
      </span>
      <div className="min-w-0 flex-1 text-sm">
        {title && <p className="font-bold text-[var(--color-ink)]">{title}</p>}
        {children && <div className={`text-[var(--color-ink-soft)] ${title ? "mt-1" : ""}`}>{children}</div>}
      </div>
    </div>
  );
}
