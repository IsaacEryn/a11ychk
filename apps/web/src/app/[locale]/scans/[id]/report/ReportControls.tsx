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
    displayGroup: string;
    savePublic: string;
    savePublicHint: string;
    savedPublic: string;
    blind: { label: string; hint: string; notice: string };
  };
  leftActions: ReactNode;
  rightActions: ReactNode;
  children: ReactNode;
}) {
  const [view, setView] = useState<View>(initialView);
  const [std, setStd] = useState<Std>(hasWcag ? initialStd : "kwcag");
  // 블라인드 판정 모드 — 자동 결과를 가린 채 판정 기입(판정자 편향 완화). 화면 전용
  // 클라이언트 상태: URL·공개 보기 저장·PDF에 반영하지 않는다.
  const [blind, setBlind] = useState(false);
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
  /** 블라인드 켜기 시 출력 범위를 '전체'로 강제 — 상태별 행 필터링 자체가 자동 결과를 누설하므로 */
  const onBlind = () => {
    const next = !blind;
    setBlind(next);
    if (next && view !== "all") onView("all");
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
    <div data-view={view} data-std={std} data-pref={preferred} data-blind={blind ? "1" : undefined}>
      {/* 공유 링크(읽기 전용) — 자체 행. 좌우 분리(justify-between) 없이 각 행이 자연 줄바꿈해
          공유 켤 때 레이아웃이 어긋나지 않게 한다. */}
      {leftActions && <div className="no-print mb-3">{leftActions}</div>}
      {/* 재검사·인쇄·내보내기·PDF — 버튼 크기 통일(px-4 py-2), 한 행에서 자연 줄바꿈 */}
      <div className="no-print mb-8 flex flex-wrap items-center gap-2">
        {rightActions}
        <a
          href={pdfHref}
          className="rounded border-[1.5px] border-[var(--color-seal)] bg-[var(--color-seal)] px-4 py-2 font-semibold text-[var(--color-paper)] hover:bg-[var(--color-seal-deep)]"
        >
          {labels.downloadPdf}
        </a>
      </div>

      {/* 표시 설정 — 출력 범위·표시 표준 토글과 '공개 보기 저장'을 한 묶음으로 그룹핑.
          토글은 소유자 미리보기이고, 저장하면 공유 링크·배지 방문자에게 그대로 적용된다. */}
      <section aria-label={labels.displayGroup} className="no-print mb-8 rounded border-[1.5px] border-[var(--color-line)] p-4">
        <p className="mb-3 text-sm font-bold text-[var(--color-ink)]">{labels.displayGroup}</p>
        <Segmented legend={labels.view.legend} value={view} options={viewOpts} onChange={onView} disabled={blind} />
        {hasWcag && <Segmented legend={labels.std.legend} value={std} options={stdOpts} onChange={onStd} />}
        {/* 블라인드 판정 모드 — 연구·심사 방법론용: 자동 결과를 가린 채 판정 기입 */}
        <div className="no-print mb-6 flex flex-wrap items-center gap-2">
          <button
            type="button"
            role="switch"
            aria-checked={blind}
            onClick={onBlind}
            className={`rounded border-[1.5px] px-4 py-2 font-semibold transition-colors ${
              blind
                ? "border-[var(--color-ink)] bg-[var(--color-ink)] text-[var(--color-paper)]"
                : "border-[var(--color-ink)] text-[var(--color-ink)] hover:bg-[var(--color-paper-warm)]"
            }`}
          >
            {labels.blind.label}
          </button>
          <span className="text-xs text-[var(--color-ink-faint)]">{labels.blind.hint}</span>
        </div>
        {/* 공개 보기 저장 — 현재 표시 모드를 공유 링크·배지로 보는 사람에게 고정 적용 */}
        <form action={saveAction} className="mt-1 flex flex-wrap items-center gap-2">
          <input type="hidden" name="scanId" value={scanId} />
          <input type="hidden" name="view" value={view} />
          <input type="hidden" name="std" value={std} />
          <button
            type="submit"
            disabled={saving}
            className="rounded border-[1.5px] border-[var(--color-seal)] px-4 py-2 font-semibold text-[var(--color-seal)] hover:bg-[var(--color-seal-tint)] disabled:opacity-60"
          >
            {labels.savePublic}
          </button>
          <span className="text-xs text-[var(--color-ink-faint)]">
            {saveState?.ok ? labels.savedPublic : labels.savePublicHint}
          </span>
        </form>
      </section>

      {/* 블라인드 안내 — 켜져 있는 동안 자동 결과가 가려져 있음을 알린다 (화면 전용) */}
      {blind && (
        <p role="note" className="no-print mb-6 border-l-[3px] border-[var(--color-ink)] bg-[var(--color-paper-warm)] px-4 py-3 text-sm font-medium">
          {labels.blind.notice}
        </p>
      )}
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

/** 세그먼트 토글 — 상태 콜백 방식(네비게이션 없음). no-print.
 * disabled: 블라인드 판정 모드처럼 다른 상태가 이 토글을 잠글 때(전환 불가 사유는 안내문이 설명). */
function Segmented<T extends string>({
  legend,
  value,
  options,
  onChange,
  disabled = false,
}: {
  legend: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  disabled?: boolean;
}) {
  return (
    <div role="group" aria-label={legend} className="no-print mb-6 flex flex-wrap items-center gap-2">
      <span className="text-sm font-bold text-[var(--color-ink-soft)]">{legend}</span>
      <div className={`flex flex-wrap gap-1.5 rounded border-[1.5px] border-[var(--color-ink)] bg-[var(--color-paper)] p-1 ${disabled ? "opacity-50" : ""}`}>
        {options.map((opt) => (
          <button
            key={opt.value}
            type="button"
            aria-pressed={value === opt.value}
            disabled={disabled}
            onClick={() => onChange(opt.value)}
            className={`rounded-[3px] px-3 py-1.5 text-sm font-semibold transition-colors disabled:cursor-not-allowed ${
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
