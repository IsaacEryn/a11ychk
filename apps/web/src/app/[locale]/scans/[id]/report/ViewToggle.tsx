"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";

/**
 * 보고서 출력 범위 토글 — 전체 / 판정 완료만 / 오류만.
 * 서버 필터(searchParams)라 화면·인쇄·PDF에 동일하게 적용된다. 화면 전용(no-print).
 */
export function ViewToggle({
  view,
  labels,
}: {
  view: "all" | "done" | "issues";
  labels: { legend: string; all: string; done: string; issues: string };
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const setView = (next: "all" | "done" | "issues") => {
    const params = new URLSearchParams(searchParams.toString());
    if (next === "all") params.delete("view");
    else params.set("view", next);
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };

  const options: { value: "all" | "done" | "issues"; label: string }[] = [
    { value: "all", label: labels.all },
    { value: "done", label: labels.done },
    { value: "issues", label: labels.issues },
  ];

  return (
    <div role="group" aria-label={labels.legend} className="no-print mb-6 flex flex-wrap items-center gap-2">
      <span className="text-sm font-bold text-[var(--color-ink-soft)]">{labels.legend}</span>
      <div className="flex overflow-hidden rounded border-[1.5px] border-[var(--color-ink)]">
        {options.map((opt, i) => (
          <button
            key={opt.value}
            type="button"
            aria-pressed={view === opt.value}
            onClick={() => setView(opt.value)}
            className={`px-3.5 py-1.5 text-sm font-semibold ${i > 0 ? "border-l-[1.5px] border-[var(--color-ink)]" : ""} ${
              view === opt.value
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
