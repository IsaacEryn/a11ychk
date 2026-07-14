"use client";

export function PrintButton({ label }: { label: string }) {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="rounded border-[1.5px] border-[var(--color-ink)] px-4 py-2 font-semibold hover:bg-[var(--color-paper-warm)]"
    >
      {label}
    </button>
  );
}
