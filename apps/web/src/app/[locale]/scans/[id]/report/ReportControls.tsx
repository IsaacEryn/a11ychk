"use client";

import { useActionState, useState, type ReactNode } from "react";
import { savePublicView } from "@/lib/actions";

type View = "all" | "auto" | "done" | "issues";
type Std = "both" | "wcag" | "kwcag";

/**
 * 보고서 출력 범위(view)·표시 표준(std) 제어 — 클라이언트 상태로만 동작한다.
 * 서버 렌더된 보고서 본문은 children으로 그대로 전달받고, 이 래퍼는 최상위
 * data-view/data-std/data-pref 속성만 바꾼다. 실제 행·블록 표시/숨김은 CSS가
 * 담당하므로(globals.css의 [data-view]/[data-std] 규칙) 토글 클릭이 서버 왕복
 * 없이 즉시 반영된다. URL도 history.replaceState로 동기화해 새로고침·공유·PDF
 * 링크가 현재 상태를 유지한다. (기존엔 router.replace로 매번 RSC를 재페치했음)
 */
export function ReportControls({
  canEdit,
  scanId,
  initialView,
  initialStd,
  preferred,
  hasWcag,
  pdfBase,
  labels,
  leftActions,
  rightActions,
  children,
}: {
  /** 소유자만 컨트롤(내보내기·표시 토글·공개 보기 저장)을 조작할 수 있다. 비소유자는 읽기 전용 */
  canEdit: boolean;
  scanId: string;
  initialView: View;
  initialStd: Std;
  preferred: "wcag" | "kwcag";
  hasWcag: boolean;
  /** PDF 링크 기본 경로 조각 — 상태에 따라 쿼리를 붙여 완성 */
  pdfBase: { scanId: string; locale: string; compareParam?: string };
  labels: {
    view: { legend: string; all: string; auto: string; done: string; issues: string };
    std: { legend: string; both: string; wcag: string; kwcag: string };
    viewNotice: { auto: string; done: string; issues: string };
    stdNotice: { wcag: string; kwcag: string };
    downloadPdf: string;
    savePublic: string;
    savePublicHint: string;
    savedPublic: string;
  };
  leftActions: ReactNode;
  rightActions: ReactNode;
  children: ReactNode;
}) {
  const [view, setView] = useState<View>(initialView);
  const [std, setStd] = useState<Std>(hasWcag ? initialStd : "kwcag");
  const [saveState, saveAction, saving] = useActionState(savePublicView, {} as Awaited<ReturnType<typeof savePublicView>>);

  // 비소유자(공유 링크·배지) — 읽기 전용: 소유자가 지정한 표시 모드로 고정, 컨트롤 없음.
  if (!canEdit) {
    return (
      <div data-view={initialView} data-std={hasWcag ? initialStd : "kwcag"} data-pref={preferred}>
        {children}
      </div>
    );
  }

  /** URL 쿼리 동기화 — 네비게이션 없이 주소만 갱신(새로고침·공유·PDF 일관) */
  const syncUrl = (nextView: View, nextStd: Std) => {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    if (nextView === "all") url.searchParams.delete("view");
    else url.searchParams.set("view", nextView);
    if (!hasWcag || nextStd === "both") url.searchParams.delete("std");
    else url.searchParams.set("std", nextStd);
    window.history.replaceState(null, "", url.toString());
  };

  const onView = (next: View) => {
    setView(next);
    syncUrl(next, std);
  };
  const onStd = (next: Std) => {
    setStd(next);
    syncUrl(view, next);
  };

  const pdfHref =
    `/api/scans/${pdfBase.scanId}/pdf?view=${view}&lang=${pdfBase.locale}` +
    (pdfBase.compareParam ? `&compare=${pdfBase.compareParam}` : "") +
    (std !== "both" ? `&std=${std}` : `&pref=${preferred}`);

  const viewOpts: { value: View; label: string }[] = [
    { value: "all", label: labels.view.all },
    { value: "auto", label: labels.view.auto },
    { value: "done", label: labels.view.done },
    { value: "issues", label: labels.view.issues },
  ];
  const stdOpts: { value: Std; label: string }[] = [
    { value: "both", label: labels.std.both },
    { value: "wcag", label: labels.std.wcag },
    { value: "kwcag", label: labels.std.kwcag },
  ];

  return (
    <div data-view={view} data-std={std} data-pref={preferred}>
      {/* 액션 바 — PDF 링크만 상태 의존, 나머지는 서버 노드 그대로.
          모바일은 justify-start(줄바꿈 시 좌우 벌어짐 방지), 데스크톱은 justify-between */}
      <div className="no-print mb-8 flex flex-wrap items-center justify-start gap-2 sm:justify-between">
        <div>{leftActions}</div>
        <div className="flex flex-wrap items-center justify-start gap-2 sm:justify-end">
          {rightActions}
          <a
            href={pdfHref}
            className="rounded border-[1.5px] border-[var(--color-seal)] bg-[var(--color-seal)] px-4 py-2 font-semibold text-[var(--color-paper)] hover:bg-[var(--color-seal-deep)]"
          >
            {labels.downloadPdf}
          </a>
        </div>
      </div>

      {/* 출력 범위 토글 */}
      <Segmented legend={labels.view.legend} value={view} options={viewOpts} onChange={onView} />
      {/* 표시 표준 토글 (WCAG 매트릭스가 있을 때만) */}
      {hasWcag && <Segmented legend={labels.std.legend} value={std} options={stdOpts} onChange={onStd} />}

      {/* 공개 보기 저장 — 현재 표시 모드를 공유 링크·배지로 보는 사람에게 고정 적용 */}
      <form action={saveAction} className="no-print mb-6 flex flex-wrap items-center gap-2">
        <input type="hidden" name="scanId" value={scanId} />
        <input type="hidden" name="view" value={view} />
        <input type="hidden" name="std" value={std} />
        <button
          type="submit"
          disabled={saving}
          className="rounded border-[1.5px] border-[var(--color-ink)] px-3 py-1.5 text-sm font-semibold hover:bg-[var(--color-paper-warm)] disabled:opacity-60"
        >
          {labels.savePublic}
        </button>
        <span className="text-xs text-[var(--color-ink-faint)]">
          {saveState?.ok ? labels.savedPublic : labels.savePublicHint}
        </span>
      </form>

      {/* 안내문 — 상태에 따라 표시 (인쇄·PDF 포함) */}
      {view !== "all" && (
        <p role="note" className="mb-6 border-l-[3px] border-[var(--color-mark)] bg-[var(--color-warn-tint)] px-4 py-3 text-sm font-medium">
          {labels.viewNotice[view]}
        </p>
      )}
      {hasWcag && std !== "both" && (
        <p role="note" className="mb-6 border-l-[3px] border-[var(--color-mark)] bg-[var(--color-warn-tint)] px-4 py-3 text-sm font-medium">
          {labels.stdNotice[std]}
        </p>
      )}

      {children}
    </div>
  );
}

/** 세그먼트 토글 — 상태 콜백 방식(네비게이션 없음). no-print. */
function Segmented<T extends string>({
  legend,
  value,
  options,
  onChange,
}: {
  legend: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div role="group" aria-label={legend} className="no-print mb-6 flex flex-wrap items-center gap-2">
      <span className="text-sm font-bold text-[var(--color-ink-soft)]">{legend}</span>
      <div className="flex flex-wrap gap-1.5 rounded border-[1.5px] border-[var(--color-ink)] bg-[var(--color-paper)] p-1">
        {options.map((opt) => (
          <button
            key={opt.value}
            type="button"
            aria-pressed={value === opt.value}
            onClick={() => onChange(opt.value)}
            className={`rounded-[3px] px-3 py-1.5 text-sm font-semibold transition-colors ${
              value === opt.value
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
