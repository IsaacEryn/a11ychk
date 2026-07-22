import { getTranslations } from "next-intl/server";

/** 내보내기 메뉴 — CSV·AI 수정 프롬프트·EARL·평가 도구 형식 다운로드 */
export async function ExportMenu({ scanId, locale }: { scanId: string; locale: string }) {
  const t = await getTranslations("report");
  return (
    <details className="relative">
      <summary className="cursor-pointer list-none rounded border-[1.5px] border-[var(--color-ink)] px-4 py-2 font-semibold hover:bg-[var(--color-paper-warm)]">
        {t("export.menu")} ▾
      </summary>
      <ul className="absolute right-0 z-10 mt-1 w-[min(18rem,90vw)] border-[1.5px] border-[var(--color-ink)] bg-[var(--color-paper)] py-1 shadow-[4px_4px_0_0_var(--color-line)]">
        {[
          { href: `/api/scans/${scanId}/csv?type=findings&lang=${locale}`, label: t("export.csvFindings") },
          { href: `/api/scans/${scanId}/csv?type=kwcag&lang=${locale}`, label: t("export.csvKwcag") },
          { href: `/api/scans/${scanId}/ai-fix?lang=${locale}`, label: t("downloadAiFix") },
          { href: `/api/scans/${scanId}/ai-fix?format=json&lang=${locale}`, label: t("export.aiFixJson") },
          { href: `/api/scans/${scanId}/earl?lang=${locale}`, label: t("downloadEarl") },
          { href: `/api/scans/${scanId}/report-tool?lang=${locale}`, label: t("downloadReportTool") },
        ].map((item) => (
          <li key={item.href}>
            <a href={item.href} className="block px-4 py-2 text-sm font-semibold hover:bg-[var(--color-paper-warm)]">
              {item.label}
            </a>
          </li>
        ))}
      </ul>
    </details>
  );
}
