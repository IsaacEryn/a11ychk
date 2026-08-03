"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";

/**
 * 내보내기 메뉴 — CSV·AI 수정 프롬프트·EARL·평가 도구 형식 다운로드.
 * native details는 바깥 클릭·Esc로 닫히지 않아 클라이언트 메뉴로 전환.
 * 각 항목에 "무엇에 쓰는지" 설명 한 줄을 붙인다.
 */
export function ExportMenu({ scanId, locale }: { scanId: string; locale: string }) {
  const t = useTranslations("report");
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        rootRef.current?.querySelector("button")?.focus();
      }
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const items = [
    { href: `/api/scans/${scanId}/csv?type=findings&lang=${locale}`, label: t("export.csvFindings"), desc: t("export.descCsvFindings") },
    { href: `/api/scans/${scanId}/csv?type=kwcag&lang=${locale}`, label: t("export.csvKwcag"), desc: t("export.descCsvKwcag") },
    { href: `/api/scans/${scanId}/ai-fix?lang=${locale}`, label: t("downloadAiFix"), desc: t("export.descAiFix") },
    { href: `/api/scans/${scanId}/ai-fix?format=json&lang=${locale}`, label: t("export.aiFixJson"), desc: t("export.descAiFixJson") },
    { href: `/api/scans/${scanId}/earl?lang=${locale}`, label: t("downloadEarl"), desc: t("export.descEarl") },
    { href: `/api/scans/${scanId}/report-tool?lang=${locale}`, label: t("downloadReportTool"), desc: t("export.descReportTool") },
    { href: `/api/scans/${scanId}/report-tool?version=2&lang=${locale}`, label: t("export.reportToolV2"), desc: t("export.descReportToolV2") },
  ];

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="rounded border-[1.5px] border-[var(--color-ink)] px-4 py-2 font-semibold hover:bg-[var(--color-paper-warm)]"
      >
        {t("export.menu")} ▾
      </button>
      {open && (
        <ul className="absolute right-0 z-10 mt-1 w-[min(20rem,90vw)] border-[1.5px] border-[var(--color-ink)] bg-[var(--color-paper)] py-1 shadow-[4px_4px_0_0_var(--color-line)]">
          {items.map((item) => (
            <li key={item.href}>
              <a
                href={item.href}
                onClick={() => setOpen(false)}
                className="block px-4 py-2 hover:bg-[var(--color-paper-warm)]"
              >
                <span className="block text-sm font-semibold">{item.label}</span>
                <span className="block text-xs text-[var(--color-ink-faint)]">{item.desc}</span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
