"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";

/**
 * 전후 비교 대상 선택 — 기본은 직전 검사, 드롭다운으로 이전 검사 중 선택.
 * 서버 필터(searchParams)라 화면·인쇄·PDF에 동일하게 적용된다. 화면 전용(no-print).
 */
export function CompareSelect({
  options,
  selected,
  label,
}: {
  options: { id: string; label: string }[];
  selected: string;
  label: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const setCompare = (next: string) => {
    const params = new URLSearchParams(searchParams.toString());
    // 첫 항목(직전 검사)이 기본값이라 파라미터를 지워 URL을 짧게 유지
    if (next === options[0]?.id) params.delete("compare");
    else params.set("compare", next);
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };

  return (
    <label className="no-print flex items-center gap-2 text-sm">
      <span className="font-semibold text-[var(--color-ink-soft)]">{label}</span>
      <select
        value={selected}
        onChange={(e) => setCompare(e.target.value)}
        className="rounded border-[1.5px] border-[var(--color-ink)] bg-[var(--color-paper)] px-2 py-1 text-sm"
      >
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}
