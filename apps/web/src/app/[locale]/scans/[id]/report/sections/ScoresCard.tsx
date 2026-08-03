"use client";

import { useTranslations } from "next-intl";
import type { ScanSummary } from "@a11ychk/core/catalog";
import { useReviews } from "../ReviewsProvider";

type Scores = NonNullable<ScanSummary["scores"]>;

/**
 * 점수 카드(통합/자동/수동) — 판정 저장 시 ReviewsProvider의 최신 scores로
 * 서버 재렌더 없이 즉시 갱신된다. 컨텍스트가 없으면(공유 뷰 등) 초기값 그대로.
 */
export function ScoresCard({
  initial,
  totalViolations,
  totalViolationNodes,
  bpTypes,
  bpNodes,
}: {
  initial: Scores;
  totalViolations: number;
  totalViolationNodes: number;
  bpTypes: number;
  bpNodes: number;
}) {
  const t = useTranslations("report");
  const reviews = useReviews();
  const scores = reviews?.scores ?? initial;

  return (
    <div className="doc-card p-6">
      {/* 통합 준수율 (headline) */}
      <div className="flex items-baseline justify-between gap-4">
        <div>
          <p className="text-sm font-bold text-[var(--color-ink-soft)]">{t("scores.combined")}</p>
          <p className="font-display mt-1 text-6xl font-extrabold leading-none text-[var(--color-seal)]">
            {scores.combined.rate}
            <span className="text-2xl">%</span>
          </p>
        </div>
        <p className="max-w-[13rem] text-right text-xs leading-relaxed text-[var(--color-ink-faint)]">
          {t("scores.combinedDesc")}
        </p>
      </div>
      {/* 자동 / 수동 분해 */}
      <div className="mt-5 grid grid-cols-2 gap-3">
        {(["automated", "manual"] as const).map((kind) => {
          const s = scores[kind];
          return (
            <div key={kind} className="rounded-md border border-[var(--color-line)] bg-[var(--color-paper-warm)] p-3.5">
              <p className="text-xs font-bold text-[var(--color-ink-soft)]">{t(`scores.${kind}`)}</p>
              <p className="font-display mt-0.5 text-3xl font-extrabold leading-none">
                {s.evaluated === 0 ? "—" : `${s.rate}%`}
              </p>
              <p className="mt-1.5 text-[11px] leading-tight text-[var(--color-ink-faint)]">
                {s.evaluated === 0 ? t("scores.noManual") : t("scores.passFail", { passed: s.passed, failed: s.failed })}
              </p>
              <p className="text-[11px] leading-tight text-[var(--color-ink-faint)]">
                {t("scores.coverage", { evaluated: s.evaluated, total: scores.totalCriteria })}
              </p>
            </div>
          );
        })}
      </div>
      <p className="mt-3.5 flex flex-wrap gap-x-4 gap-y-1 text-sm">
        <span>
          {t("scores.violations")}{" "}
          <strong className="text-[var(--color-crit)]">{t("scores.unit", { count: totalViolations })}</strong>
        </span>
        <span>
          {t("scores.violationNodes")}{" "}
          <strong className="text-[var(--color-crit)]">{t("scores.unit", { count: totalViolationNodes })}</strong>
        </span>
      </p>
      {bpTypes > 0 && (
        <p className="mt-2 rounded-md border border-[var(--color-line)] bg-[var(--color-paper-warm)] px-3 py-2 text-xs leading-relaxed text-[var(--color-ink-soft)]">
          {t("scores.bestPracticeNote", { types: bpTypes, nodes: bpNodes })}
        </p>
      )}
      <p className="mt-3 text-xs leading-relaxed text-[var(--color-ink-faint)]">{t("scores.legend")}</p>
    </div>
  );
}
