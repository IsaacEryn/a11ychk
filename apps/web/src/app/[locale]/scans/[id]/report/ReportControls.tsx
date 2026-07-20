"use client";

import { useState, type ReactNode } from "react";

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
  };
  leftActions: ReactNode;
  rightActions: ReactNode;
  children: ReactNode;
}) {
  const [view, setView] = useState<View>(initialView);
  const [std, setStd] = useState<Std>(hasWcag ? initialStd : "kwcag");

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
      {/* 액션 바 — PDF 링크만 상태 의존, 나머지는 서버 노드 그대로 */}
      <div className="no-print mb-8 flex flex-wrap items-center justify-between gap-2">
        <div>{leftActions}</div>
        <div className="flex flex-wrap items-center justify-end gap-2">
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
      <div className="flex gap-1 rounded border-[1.5px] border-[var(--color-ink)] bg-[var(--color-paper)] p-1">
        {options.map((opt) => (
          <button
            key={opt.value}
            type="button"
            aria-pressed={value === opt.value}
            onClick={() => onChange(opt.value)}
            className={`rounded-[3px] px-3 py-1 text-sm font-semibold transition-colors ${
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
