const STYLE: Record<string, string> = {
  queued: "border-[var(--color-line)] text-[var(--color-ink-faint)]",
  running: "border-[var(--color-seal)] text-[var(--color-seal)]",
  done: "border-[var(--color-seal)] bg-[var(--color-seal)] text-[var(--color-paper)]",
  failed: "border-[var(--color-crit)] text-[var(--color-crit)]",
};

export function StatusBadge({ status, label }: { status: string; label: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border-[1.5px] px-2.5 py-0.5 text-xs font-bold ${STYLE[status] ?? STYLE.queued}`}
    >
      {status === "running" && <span aria-hidden="true" className="pulse-dot inline-block h-1.5 w-1.5 rounded-full bg-current" />}
      {label}
    </span>
  );
}
