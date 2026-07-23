"use client";

/**
 * SaveState(useActionState) 폼의 공통 성공/실패 피드백 — 인라인(span) 표준.
 * 폼마다 제각각이던 role·색 토큰을 통일한다: 성공 role="status"(polite),
 * 실패 role="alert"(assertive), 색은 globals.css 토큰(AA 대비 검증됨)만.
 * 오류 문구는 errors[state.error] 코드 매핑, 없으면 fallback.
 */
export function FormFeedback({
  state,
  okLabel,
  errors,
  fallback,
}: {
  state: { ok?: boolean; error?: string };
  okLabel: string;
  errors?: Record<string, string>;
  fallback: string;
}) {
  if (state.ok) {
    return (
      <span role="status" className="text-xs font-bold text-[var(--color-seal)]">
        ✓ {okLabel}
      </span>
    );
  }
  if (state.error) {
    return (
      <span role="alert" className="text-xs font-bold text-[var(--color-crit)]">
        {errors?.[state.error] ?? fallback}
      </span>
    );
  }
  return null;
}
