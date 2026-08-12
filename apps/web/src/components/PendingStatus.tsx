"use client";

/**
 * 처리 중 상태 표시 — 버튼 라벨 변경만으로는 진행 여부를 알기 어려운 폼에 쓴다.
 *
 * 왜 필요한가: 인증 코드 제출처럼 성공 시 전체 페이지 이동이 뒤따르는 폼은
 * 요청이 끝나도 화면이 그대로라, 사용자가 "눌린 건지" 확신하지 못한다.
 * 눈에 보이는 표시(점 애니메이션 + 문구)와 보조기기 안내(aria-live)를 함께 낸다.
 *
 * 접근성: 항상 DOM에 남는 role="status" 영역이라 문구가 바뀔 때마다 읽힌다
 * (조건부 마운트하면 스크린 리더가 놓칠 수 있다). 애니메이션은 motion-safe로
 * 한정해 prefers-reduced-motion 사용자에게는 정지 상태로 보인다.
 */
export function PendingStatus({ message }: { message: string | null }) {
  return (
    <p
      role="status"
      aria-live="polite"
      className="mt-3 flex min-h-5 items-center gap-2 text-sm font-medium text-[var(--color-ink-soft)]"
    >
      {message && (
        <>
          <span aria-hidden="true" className="flex gap-1">
            {[0, 1, 2].map((i) => (
              <span
                key={i}
                className="size-1.5 rounded-full bg-[var(--color-seal)] opacity-70 motion-safe:animate-pulse"
                style={{ animationDelay: `${i * 160}ms` }}
              />
            ))}
          </span>
          {message}
        </>
      )}
    </p>
  );
}
