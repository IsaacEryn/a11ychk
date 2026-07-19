"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";

/**
 * 표시 표준 토글 — 모두 / WCAG만 / KWCAG만.
 * 서버 필터(searchParams)라 화면·인쇄·PDF에 동일하게 적용된다. 화면 전용(no-print).
 * 어떤 보기에서도 항상 렌더되어 다른 표준으로 즉시 전환할 수 있다.
 */
export function StandardToggle({
  std,
  labels,
}: {
  std: "both" | "wcag" | "kwcag";
  labels: { legend: string; both: string; wcag: string; kwcag: string };
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const setStd = (next: "both" | "wcag" | "kwcag") => {
    const params = new URLSearchParams(searchParams.toString());
    if (next === "both") params.delete("std");
    else params.set("std", next);
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };

  const options: { value: "both" | "wcag" | "kwcag"; label: string }[] = [
    { value: "both", label: labels.both },
    { value: "wcag", label: labels.wcag },
    { value: "kwcag", label: labels.kwcag },
  ];

  return (
    <div role="group" aria-label={labels.legend} className="no-print mb-6 flex flex-wrap items-center gap-2">
      <span className="text-sm font-bold text-[var(--color-ink-soft)]">{labels.legend}</span>
      <div className="flex overflow-hidden rounded border-[1.5px] border-[var(--color-ink)]">
        {options.map((opt, i) => (
          <button
            key={opt.value}
            type="button"
            aria-pressed={std === opt.value}
            onClick={() => setStd(opt.value)}
            className={`px-3.5 py-1.5 text-sm font-semibold ${i > 0 ? "border-l-[1.5px] border-[var(--color-ink)]" : ""} ${
              std === opt.value
                ? "bg-[var(--color-seal)] text-[var(--color-paper)]"
                : "bg-[var(--color-paper)] text-[var(--color-ink-soft)] hover:bg-[var(--color-paper-warm)]"
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  );
}
