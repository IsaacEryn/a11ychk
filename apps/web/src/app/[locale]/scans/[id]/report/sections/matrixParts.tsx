import { getTranslations } from "next-intl/server";

/**
 * WCAG·KWCAG 매트릭스가 공유하는 조각들.
 * 두 표는 열 구성과 배지 규칙이 서로 달라 표 자체를 하나로 합치지는 않고,
 * 글자 하나까지 같은 부분(표 껍데기·위반 수 칸·판정 메모)만 여기로 모았다.
 */

/** 가로 스크롤 컨테이너 + 표 뼈대 (모바일에서 첫 열 고정은 col-sticky가 담당) */
export function MatrixShell({ caption, children }: { caption: string; children: React.ReactNode }) {
  return (
    <div className="table-scroll mt-4 overflow-x-auto">
      <table className="w-full min-w-[40rem] border-collapse border-y-[1.5px] border-[var(--color-ink)] text-sm">
        <caption className="sr-only">{caption}</caption>
        {children}
      </table>
    </div>
  );
}

/** 위반 수 칸 — 블라인드 판정 중에는 자동 집계 수치를 가린다 */
export function CountCell({ count }: { count: number }) {
  return (
    <td className="py-2 pr-3 text-right font-bold tabular-nums">
      <span className="blind-ph font-normal text-[var(--color-ink-faint)]">—</span>
      <span className="blind-mask">{count > 0 ? count : "—"}</span>
    </td>
  );
}

/** 점검자가 남긴 메모 (판정 칸이 아니라 항목명 아래에 붙는다) */
export async function ReviewNote({ note }: { note: string }) {
  const t = await getTranslations("report");
  return (
    <p className="mt-1 text-xs font-normal leading-relaxed text-[var(--color-ink-soft)]">
      <strong>{t("review.noteLabel")}:</strong> {note}
    </p>
  );
}
