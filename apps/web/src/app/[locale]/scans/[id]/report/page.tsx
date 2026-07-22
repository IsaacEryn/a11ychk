import { getTranslations, setRequestLocale } from "next-intl/server";
import type { WcagOutcome } from "@a11ychk/core/catalog";
import { loadReport } from "./loadReport";
import { computeKwcagPageRates } from "./kwcagPageRate";
import { computeCertReadiness } from "./certReadiness";
import { PrintButton } from "./PrintButton";
import { ReportMetaForm } from "./ReportMetaForm";
import { RerunScanButton } from "./RescanButtons";
import { ShareLinkButton } from "./ShareLinkButton";
import { ReportControls } from "./ReportControls";
import { ExportMenu } from "./sections/ExportMenu";
import { CoverHeader } from "./sections/CoverHeader";
import { ExecSummary } from "./sections/ExecSummary";
import { ScopeSection } from "./sections/ScopeSection";
import { PagesSection } from "./sections/PagesSection";
import { ScoreSection } from "./sections/ScoreSection";
import { CompareSection } from "./sections/CompareSection";
import { ManualProgressSection } from "./sections/ManualProgressSection";
import { WcagMatrixSection } from "./sections/WcagMatrixSection";
import { CertSection } from "./sections/CertSection";
import { KwcagMatrixSection } from "./sections/KwcagMatrixSection";
import { PrioritySection } from "./sections/PrioritySection";
import { ViolationsSection } from "./sections/ViolationsSection";
import { ReviewDataSection } from "./sections/ReviewDataSection";
import { ManualSection } from "./sections/ManualSection";
import { StatementSection } from "./sections/StatementSection";
import { ViewerCta } from "./sections/ViewerCta";

export async function generateMetadata({ params }: { params: Promise<{ locale: string; id: string }> }) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "report" });
  return { title: t("docTitle"), robots: { index: false } };
}

export default async function ReportPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; id: string }>;
  searchParams: Promise<{ token?: string; view?: string; compare?: string; std?: string; pref?: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const { token, view: viewParam, compare: compareParam, std: stdRaw, pref: prefRaw } = await searchParams;
  // 출력 범위: all(전체, 기본) | auto(자동 검사 항목만) | done(판정 완료 항목만) | issues(오류 항목만)
  const view =
    viewParam === "done" || viewParam === "issues" || viewParam === "auto" ? viewParam : "all";
  // 표시 표준: 없으면 both. pref는 both일 때의 순서(주로 PDF 렌더에 소유자 설정 전달용)
  const stdParam = stdRaw === "wcag" || stdRaw === "kwcag" ? stdRaw : null;
  const prefParam = prefRaw === "wcag" || prefRaw === "kwcag" ? prefRaw : null;
  const t = await getTranslations("report");

  const { scan, summary, scope, meta, wcagReviews, kwcagReviews, pages, ruleGroups, compare, compareOptions, canEdit, preferredStandard } =
    await loadReport(locale, id, token, compareParam);

  // 우선 표준: 쿼리 > 사용자 설정(설정한 적 있으면) > 언어 기반 기본값(en=WCAG, ko=KWCAG)
  const preferred: "wcag" | "kwcag" = prefParam ?? preferredStandard ?? (locale === "en" ? "wcag" : "kwcag");
  const hasWcag = !!(summary.wcagMatrix && summary.wcagMatrix.length > 0);
  // 구형 스캔(wcagMatrix 없음)은 KWCAG만 표시하고 토글을 숨긴다
  const std: "both" | "wcag" | "kwcag" = !hasWcag ? "kwcag" : (stdParam ?? "both");

  // 공유 보기(비소유자): 소유자가 지정한 표시 모드(report_meta.public*)로 고정 노출.
  // 소유자는 URL 토글로 자유롭게 미리보고, 저장하면 이 값이 비소유자에게 반영된다.
  const effView = canEdit ? view : ((meta?.publicView as typeof view | undefined) ?? "all");
  const effStd = !hasWcag ? "kwcag" : canEdit ? std : ((meta?.publicStd as typeof std | undefined) ?? "both");

  // KWCAG 항목별 페이지 준수율 (인증 기준 95% 대비 근사치) — 추가 쿼리 없이 계산
  const kwcagRates = computeKwcagPageRates(
    summary.kwcagMatrix ?? [],
    ruleGroups.flatMap((g) => g.rows),
    (pages ?? []).filter((p) => p.status === "done").length,
  );
  const donePageUrls = (pages ?? []).filter((p) => p.status === "done").map((p) => p.url as string);
  // 인증 준비 요약 — 항목별 페이지 준수율·판정을 평균해 인증 합격선(95%/85%)과 대응
  const cert = computeCertReadiness(
    summary.kwcagMatrix ?? [],
    kwcagRates,
    kwcagReviews,
    (pages ?? []).filter((p) => p.status === "done").length,
  );

  // 판정(outcome) 배지 스타일 — WCAG·KWCAG 매트릭스가 공유
  const outcomeStyle: Record<WcagOutcome, string> = {
    passed: "bg-[var(--color-seal-tint)] text-[var(--color-pass)] border-[var(--color-seal)]",
    failed: "bg-[var(--color-crit-tint)] text-[var(--color-crit)] border-[var(--color-crit)]",
    cannotTell: "bg-[var(--color-warn-tint)] text-[var(--color-ink)] border-[var(--color-line)]",
    notChecked: "bg-[var(--color-paper-warm)] text-[var(--color-ink-soft)] border-[var(--color-line)]",
    notPresent: "text-[var(--color-ink-faint)] border-[var(--color-line)]",
  };

  return (
    <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6">
      {/* 출력 범위(view)·표시 표준(std) 토글 — 클라이언트 상태로 서버 재페치 없이 CSS 필터 */}
      <ReportControls
        canEdit={canEdit}
        scanId={scan.id}
        initialView={effView}
        initialStd={effStd}
        preferred={preferred}
        hasWcag={hasWcag}
        pdfBase={{ scanId: scan.id, locale, compareParam }}
        labels={{
          view: { legend: t("view.legend"), all: t("view.all"), auto: t("view.auto"), done: t("view.done"), issues: t("view.issues") },
          std: { legend: t("std.legend"), both: t("std.both"), wcag: t("std.wcag"), kwcag: t("std.kwcag") },
          viewNotice: { auto: t("view.notice.auto"), done: t("view.notice.done"), issues: t("view.notice.issues") },
          stdNotice: { wcag: t("std.notice.wcag"), kwcag: t("std.notice.kwcag") },
          downloadPdf: t("downloadPdf"),
          displayGroup: t("displayGroup"),
          savePublic: t("savePublic"),
          savePublicHint: t("savePublicHint"),
          savedPublic: t("savedPublic"),
          blind: { label: t("blind.label"), hint: t("blind.hint"), notice: t("blind.notice") },
        }}
        leftActions={canEdit && <ShareLinkButton scanId={scan.id} initialToken={(scan.share_token as string | null) ?? null} />}
        rightActions={
          <>
            {canEdit && <RerunScanButton scanId={scan.id} />}
            <PrintButton label={t("print")} />
            <ExportMenu scanId={scan.id} locale={locale} />
          </>
        }
      >

      {/* ─── 보고서 정보 입력 (점검자, 화면 전용) ─── */}
      {canEdit && <ReportMetaForm scanId={scan.id} meta={meta} />}

      {/* ─── 표지/메타 ─── */}
      <CoverHeader
        meta={meta}
        rootUrl={scan.root_url}
        finishedAt={scan.finished_at}
        createdAt={scan.created_at}
        summary={summary}
      />

      {/* ─── Executive Summary (총평) ─── */}
      <ExecSummary meta={meta} />

      {/* ─── WCAG-EM Step 1·2·3: 평가 범위 + 표본 ─── */}
      <ScopeSection scope={scope} sample={summary.sample} />

      {/* ─── 표본 페이지 상세 (Step 3 + 검사 상태) ─── */}
      <PagesSection pages={pages} canEdit={canEdit} scanId={scan.id} />

      {/* ─── 요약: 자동/수동/통합 준수율 + 심각도별 위반 ─── */}
      <ScoreSection summary={summary} />

      {/* ─── 전후 비교 — 같은 대상의 직전 검사와 비교해 개선 효과를 보여준다 ─── */}
      <CompareSection locale={locale} compare={compare} compareOptions={compareOptions} compareParam={compareParam} />

      {/* ─── 수동 판정 진행률 ─── */}
      <ManualProgressSection summary={summary} wcagReviews={wcagReviews} kwcagReviews={kwcagReviews} preferred={preferred} />

      {/* ─── 표준별 매트릭스 — std로 선택, preferred로 순서 결정 ─── */}
      {(() => {
        // WCAG 2.2 성공기준 매트릭스 (WCAG-EM Step 4)
        const wcagBlock = hasWcag ? (
          <WcagMatrixSection
            locale={locale}
            summary={summary}
            wcagReviews={wcagReviews}
            canEdit={canEdit}
            scanId={scan.id}
            donePageUrls={donePageUrls}
            outcomeStyle={outcomeStyle}
          />
        ) : null;

        // KWCAG 블록 — 인증 준비 요약(KWCAG 인증 기준 귀속)과 33항목 매트릭스
        const kwcagBlock = (
          <div data-block="kwcag">
            <CertSection locale={locale} cert={cert} />
            <KwcagMatrixSection
              locale={locale}
              summary={summary}
              kwcagReviews={kwcagReviews}
              kwcagRates={kwcagRates}
              canEdit={canEdit}
              scanId={scan.id}
              donePageUrls={donePageUrls}
              outcomeStyle={outcomeStyle}
            />
          </div>
        );

        // 두 블록을 항상 렌더(우선 표준 순서)하고, std 단일 보기 숨김은 CSS(data-std)가 담당.
        return preferred === "wcag" ? (
          <>
            {wcagBlock}
            {kwcagBlock}
          </>
        ) : (
          <>
            {kwcagBlock}
            {wcagBlock}
          </>
        );
      })()}

      {/* ─── 검사 제외 규칙 고지 — 도메인 오탐 관리 설정이 이 검사에 적용된 경우 (투명성) ─── */}
      {summary.excludedRules && summary.excludedRules.length > 0 && (
        <p className="mt-6 rounded border-l-[3px] border-[var(--color-warn)] bg-[var(--color-warn-tint)] px-3 py-2 text-sm text-[var(--color-ink)]">
          {t("excludedRulesNote", { count: summary.excludedRules.length })}{" "}
          <span className="text-[var(--color-ink-soft)]">{summary.excludedRules.join(", ")}</span>
        </p>
      )}

      {/* ─── 우선 수정 권고 — 심각도·규모 기준 상위 규칙 액션 플랜 ─── */}
      <PrioritySection locale={locale} ruleGroups={ruleGroups} />

      {/* ─── 위반 상세 ─── */}
      <ViolationsSection locale={locale} ruleGroups={ruleGroups} />

      {/* ─── 확인용 수집 자료 — 값은 존재하나 품질은 사람이 확증 (view=all 전용) ─── */}
      <ReviewDataSection pages={pages} />

      {/* ─── 수동 검사 항목 — 소유자 전용(점검 워크플로 안내). 공유·비소유자 뷰엔 미노출 ─── */}
      {canEdit && <ManualSection locale={locale} />}

      {/* ─── WCAG-EM 적합성 진술 (Step 5.c) ─── */}
      <StatementSection scope={scope} />

      {/* ─── 비소유자(배지·공유 링크 방문자) 전환 CTA — 화면 전용, 인쇄 제외 ─── */}
      {!canEdit && <ViewerCta />}

      {/* ─── 고지 ─── */}
      <footer className="mt-8 border-t-[1.5px] border-[var(--color-ink)] pt-5 text-sm leading-relaxed text-[var(--color-ink-faint)]">
        <p>{t("disclaimer")}</p>
        <p className="mt-2">{t("generatedBy")}</p>
      </footer>
      </ReportControls>
    </div>
  );
}
