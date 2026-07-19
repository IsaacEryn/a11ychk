"use client";

import { useOptimistic, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

/**
 * 쿼리 파라미터 세그먼트 토글 공용 구현 (출력 범위·표시 표준).
 * - 인셋 스타일: 활성 배경이 컨테이너 테두리와 닿지 않아 모서리 어긋남이 없다
 * - 낙관적 선택(useOptimistic): 클릭 즉시 눌림 상태가 바뀌고,
 *   서버 반영(router.replace) 동안 그룹을 흐리게 + 진행 커서로 표시한다
 * 서버 필터(searchParams)라 화면·인쇄·PDF에 동일하게 적용된다. 화면 전용(no-print).
 */
export function SegmentedQueryToggle({
  param,
  value,
  defaultValue,
  options,
  legend,
}: {
  param: string;
  value: string;
  /** 이 값이면 파라미터를 지워 URL을 짧게 유지 */
  defaultValue: string;
  options: { value: string; label: string }[];
  legend: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const [current, setCurrent] = useOptimistic(value);

  const setValue = (next: string) => {
    startTransition(() => {
      setCurrent(next);
      const params = new URLSearchParams(searchParams.toString());
      if (next === defaultValue) params.delete(param);
      else params.set(param, next);
      const qs = params.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    });
  };

  return (
    <div role="group" aria-label={legend} aria-busy={isPending} className="no-print mb-6 flex flex-wrap items-center gap-2">
      <span className="text-sm font-bold text-[var(--color-ink-soft)]">{legend}</span>
      <div
        className={`flex gap-1 rounded border-[1.5px] border-[var(--color-ink)] bg-[var(--color-paper)] p-1 transition-opacity ${
          isPending ? "opacity-60 [&_button]:cursor-progress" : ""
        }`}
      >
        {options.map((opt) => (
          <button
            key={opt.value}
            type="button"
            aria-pressed={current === opt.value}
            onClick={() => setValue(opt.value)}
            className={`rounded-[3px] px-3 py-1 text-sm font-semibold transition-colors ${
              current === opt.value
                ? "bg-[var(--color-seal)] text-[var(--color-paper)]"
                : "text-[var(--color-ink-soft)] hover:bg-[var(--color-paper-warm)] hover:text-[var(--color-ink)]"
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  );
}
