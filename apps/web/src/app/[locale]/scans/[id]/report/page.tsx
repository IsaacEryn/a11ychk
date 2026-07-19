import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import {
  KWCAG_BY_ID,
  KWCAG_PRINCIPLE_LABEL,
  WCAG_BY_ID,
  getManualCheckItems,
  getRuleEntry,
  type Impact,
  type PageCategory,
  type PageSignature,
  type SampleType,
  type WcagOutcome,
} from "@a11ychk/core/catalog";
import { classifyScanError } from "@/lib/scanError";
import { loadReport } from "./loadReport";
import { computeKwcagPageRates } from "./kwcagPageRate";
import { computeCertReadiness } from "./certReadiness";
import { GuideText } from "@/components/GuideText";
import { PrintButton } from "./PrintButton";
import { ReviewCell } from "./ReviewCell";
import { ReportMetaForm } from "./ReportMetaForm";
import { MatrixDetail } from "./MatrixDetail";
import { RerunScanButton, RescanPageButton } from "./RescanButtons";
import { ShareLinkButton } from "./ShareLinkButton";
import { ViewToggle } from "./ViewToggle";
import { StandardToggle } from "./StandardToggle";
import { CompareSelect } from "./CompareSelect";

export async function generateMetadata({ params }: { params: Promise<{ locale: string; id: string }> }) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "report" });
  return { title: t("docTitle"), robots: { index: false } };
}

const IMPACT_ORDER: Impact[] = ["critical", "serious", "moderate", "minor"];

function pick(text: { ko: string; en?: string }, locale: string): string {
  return locale === "en" && text.en ? text.en : text.ko;
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
  const format = await getFormatter();

  const { scan, summary, scope, meta, wcagReviews, kwcagReviews, pages, ruleGroups, compare, compareOptions, canEdit, preferredStandard } =
    await loadReport(locale, id, token, compareParam);

  // 우선 표준: 쿼리 > 사용자 설정(설정한 적 있으면) > 언어 기반 기본값(en=WCAG, ko=KWCAG)
  const preferred: "wcag" | "kwcag" = prefParam ?? preferredStandard ?? (locale === "en" ? "wcag" : "kwcag");
  const hasWcag = !!(summary.wcagMatrix && summary.wcagMatrix.length > 0);
  // 구형 스캔(wcagMatrix 없음)은 KWCAG만 표시하고 토글을 숨긴다
  const std: "both" | "wcag" | "kwcag" = !hasWcag ? "kwcag" : (stdParam ?? "both");

  const failedPages = (pages ?? []).filter((p) => p.status === "failed");
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
  const manualItems = getManualCheckItems();

  // ── 수동 판정 진행률 — 자동 도구가 확정하지 못한 항목 중 점검자 판정이 기입된 비율 ──
  const wcagManualRows = (summary.wcagMatrix ?? []).filter(
    (r) => r.outcome === "notChecked" || r.outcome === "cannotTell",
  );
  const wcagManualDone = wcagManualRows.filter((r) => wcagReviews.has(r.scId)).length;
  const kwcagManualRows = (summary.kwcagMatrix ?? []).filter((r) => r.status === "manual" || r.status === "review");
  const kwcagManualDone = kwcagManualRows.filter((r) => kwcagReviews.has(r.itemId)).length;
  // 우선 표준이 먼저 오고, 단일 표준 보기에서는 해당 표준만 표시
  const stdOrder: ("kwcag" | "wcag")[] = preferred === "wcag" ? ["wcag", "kwcag"] : ["kwcag", "wcag"];
  const manualProgress: { key: string; label: string; done: number; total: number }[] = stdOrder
    .filter((s) => std === "both" || std === s)
    .map((s) =>
      s === "kwcag"
        ? { key: "kwcag", label: "KWCAG 2.2", done: kwcagManualDone, total: kwcagManualRows.length }
        : { key: "wcag", label: "WCAG 2.2", done: wcagManualDone, total: wcagManualRows.length },
    )
    .filter((x) => x.total > 0);

  // 확인용 수집 자료 (signature.review) — 값이 하나라도 있는 페이지만
  const reviewPages = (pages ?? [])
    .filter((p) => p.status === "done")
    .map((p) => ({ url: p.url as string, review: (p.signature as PageSignature | null)?.review }))
    .filter(
      (p): p is { url: string; review: NonNullable<PageSignature["review"]> } =>
        !!p.review && (p.review.alts.length > 0 || p.review.labels.length > 0 || p.review.genericLinks.length > 0),
    );
  const maxImpact = Math.max(1, ...IMPACT_ORDER.map((k) => summary.byImpact[k]));

  // 출력 범위 필터 — 점검자 판정이 있으면 그것을 우선한다 (매트릭스 표시 규칙과 동일)
  const wcagRowVisible = (outcome: WcagOutcome, review: { outcome: string } | null): boolean => {
    if (view === "all") return true;
    // auto: 자동 도구가 판정을 낸 항목만 (notChecked = 수동 필요 → 제외). 점검자 판정과 무관
    if (view === "auto") return outcome !== "notChecked";
    const effective = (review?.outcome as WcagOutcome | undefined) ?? outcome;
    if (view === "issues") return effective === "failed";
    // done: 점검자가 판정했거나 자동으로 확정 판정된 항목
    return review !== null || effective === "passed" || effective === "failed" || effective === "cannotTell";
  };
  const kwcagRowVisible = (status: string, review: { outcome: string } | null): boolean => {
    if (view === "all") return true;
    if (view === "auto") return status !== "manual";
    if (review) return view === "issues" ? review.outcome === "failed" : true;
    if (view === "issues") return status === "fail";
    return status === "pass" || status === "fail" || status === "review";
  };

  const statusStyle: Record<string, string> = {
    pass: "bg-[var(--color-seal-tint)] text-[var(--color-pass)] border-[var(--color-seal)]",
    fail: "bg-[var(--color-crit-tint)] text-[var(--color-crit)] border-[var(--color-crit)]",
    review: "bg-[var(--color-warn-tint)] text-[var(--color-ink)] border-[var(--color-line)]",
    manual: "bg-[var(--color-paper-warm)] text-[var(--color-ink-soft)] border-[var(--color-line)]",
    "not-applicable": "text-[var(--color-ink-faint)] border-[var(--color-line)]",
  };

  const outcomeStyle: Record<WcagOutcome, string> = {
    passed: "bg-[var(--color-seal-tint)] text-[var(--color-pass)] border-[var(--color-seal)]",
    failed: "bg-[var(--color-crit-tint)] text-[var(--color-crit)] border-[var(--color-crit)]",
    cannotTell: "bg-[var(--color-warn-tint)] text-[var(--color-ink)] border-[var(--color-line)]",
    notChecked: "bg-[var(--color-paper-warm)] text-[var(--color-ink-soft)] border-[var(--color-line)]",
    notPresent: "text-[var(--color-ink-faint)] border-[var(--color-line)]",
  };

  return (
    <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6">
      {/* 액션 바 */}
      <div className="no-print mb-8 flex flex-wrap items-center justify-between gap-2">
        <div>{canEdit && <ShareLinkButton scanId={scan.id} initialToken={(scan.share_token as string | null) ?? null} />}</div>
        <div className="flex flex-wrap items-center justify-end gap-2">
        {canEdit && <RerunScanButton scanId={scan.id} />}
        <PrintButton label={t("print")} />
        {/* 내보내기 묶음 — 형식이 많아져 드롭다운으로 정리 (details = JS 없이 동작) */}
        <details className="relative">
          <summary className="cursor-pointer list-none rounded border-[1.5px] border-[var(--color-ink)] px-4 py-2 font-semibold hover:bg-[var(--color-paper-warm)]">
            {t("export.menu")} ▾
          </summary>
          <ul className="absolute right-0 z-10 mt-1 w-72 border-[1.5px] border-[var(--color-ink)] bg-[var(--color-paper)] py-1 shadow-[4px_4px_0_0_var(--color-line)]">
            {[
              { href: `/api/scans/${scan.id}/csv?type=findings&lang=${locale}`, label: t("export.csvFindings") },
              { href: `/api/scans/${scan.id}/csv?type=kwcag&lang=${locale}`, label: t("export.csvKwcag") },
              { href: `/api/scans/${scan.id}/ai-fix?lang=${locale}`, label: t("downloadAiFix") },
              { href: `/api/scans/${scan.id}/ai-fix?format=json&lang=${locale}`, label: t("export.aiFixJson") },
              { href: `/api/scans/${scan.id}/earl`, label: t("downloadEarl") },
              { href: `/api/scans/${scan.id}/report-tool`, label: t("downloadReportTool") },
            ].map((item) => (
              <li key={item.href}>
                <a href={item.href} className="block px-4 py-2 text-sm font-semibold hover:bg-[var(--color-paper-warm)]">
                  {item.label}
                </a>
              </li>
            ))}
          </ul>
        </details>
        <a
          href={`/api/scans/${scan.id}/pdf?view=${view}&lang=${locale}${compareParam ? `&compare=${compareParam}` : ""}${
            std !== "both" ? `&std=${std}` : `&pref=${preferred}`
          }`}
          className="rounded border-[1.5px] border-[var(--color-seal)] bg-[var(--color-seal)] px-4 py-2 font-semibold text-[var(--color-paper)] hover:bg-[var(--color-seal-deep)]"
        >
          {t("downloadPdf")}
        </a>
        </div>
      </div>

      {/* ─── 출력 범위·표시 표준 (화면 전용 토글 + 인쇄 포함 안내문) ─── */}
      <ViewToggle
        view={view}
        labels={{ legend: t("view.legend"), all: t("view.all"), auto: t("view.auto"), done: t("view.done"), issues: t("view.issues") }}
      />
      {hasWcag && (
        <StandardToggle
          std={std}
          labels={{ legend: t("std.legend"), both: t("std.both"), wcag: t("std.wcag"), kwcag: t("std.kwcag") }}
        />
      )}
      {view !== "all" && (
        <p
          role="note"
          className="mb-6 border-l-[3px] border-[var(--color-mark)] bg-[var(--color-warn-tint)] px-4 py-3 text-sm font-medium"
        >
          {t(`view.notice.${view}`)}
        </p>
      )}
      {hasWcag && std !== "both" && (
        <p
          role="note"
          className="mb-6 border-l-[3px] border-[var(--color-mark)] bg-[var(--color-warn-tint)] px-4 py-3 text-sm font-medium"
        >
          {t(`std.notice.${std}`)}
        </p>
      )}

      {/* ─── 보고서 정보 입력 (점검자, 화면 전용) ─── */}
      {canEdit && <ReportMetaForm scanId={scan.id} meta={meta} />}

      {/* ─── 표지/메타 ─── */}
      <header className="doc-card p-8">
        <p className="flex items-center gap-2 text-sm font-bold tracking-widest text-[var(--color-seal)]">
          {/* 브랜드 마크 (brand/a11y-check-mark.svg) — 인쇄물 표지에도 포함 */}
          <svg aria-hidden="true" viewBox="0 0 64 64" className="h-5 w-5 shrink-0">
            <rect width="64" height="64" rx="14" fill="#0f1c2e" />
            <circle cx="11" cy="53" r="5" fill="#4d8dff" />
            <circle cx="24" cy="53" r="3.5" fill="#4d8dff" opacity="0.8" />
            <circle cx="11" cy="40" r="3.5" fill="#4d8dff" opacity="0.8" />
            <path d="M20 34 L30 44 L52 15" fill="none" stroke="#ffffff" strokeWidth="9" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          A11Y CHECK · a11ychk.com
        </p>
        <h1 className="font-display mt-2 text-3xl font-extrabold sm:text-4xl">{meta?.title || t("docTitle")}</h1>
        <dl className="mt-6 grid gap-x-8 gap-y-2 text-sm sm:grid-cols-2">
          {meta?.siteName && (
            <div className="flex gap-2">
              <dt className="shrink-0 font-bold">{t("meta.siteName")}</dt>
              <dd>{meta.siteName}</dd>
            </div>
          )}
          {meta?.evaluatorName && (
            <div className="flex gap-2">
              <dt className="shrink-0 font-bold">{t("meta.evaluator")}</dt>
              <dd>{meta.evaluatorName}</dd>
            </div>
          )}
          {meta?.organization && (
            <div className="flex gap-2">
              <dt className="shrink-0 font-bold">{t("meta.organization")}</dt>
              <dd>{meta.organization}</dd>
            </div>
          )}
          <div className="flex gap-2">
            <dt className="shrink-0 font-bold">{t("meta.url")}</dt>
            <dd className="break-all">{scan.root_url}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="shrink-0 font-bold">{t("meta.date")}</dt>
            <dd>
              {format.dateTime(new Date(scan.finished_at ?? scan.created_at), { dateStyle: "long", timeStyle: "short" })}
            </dd>
          </div>
          <div className="flex gap-2">
            <dt className="shrink-0 font-bold">{t("meta.pages")}</dt>
            <dd>{t("meta.pagesUnit", { count: summary.scannedPageCount })}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="shrink-0 font-bold">{t("meta.engine")}</dt>
            <dd>
              {summary.engine.name} v{summary.engine.axeVersion} · WCAG 2.2 · KWCAG 2.2
            </dd>
          </div>
        </dl>
      </header>

      {/* ─── Executive Summary (총평) ─── */}
      {meta?.executiveSummary && (
        <section aria-labelledby="exec-heading" className="print-avoid-break doc-card mt-8 p-6">
          <h2 id="exec-heading" className="font-display text-xl font-bold">
            {t("execSummary")}
          </h2>
          <p className="mt-2 whitespace-pre-wrap leading-relaxed">{meta.executiveSummary}</p>
        </section>
      )}

      {/* ─── WCAG-EM Step 1·2·3: 평가 범위 + 표본 ─── */}
      {(scope || summary.sample) && (
        <section aria-labelledby="scope-heading" className="print-avoid-break mt-8 grid gap-5 md:grid-cols-2">
          {scope && (
            <div className="doc-card p-6">
              <h2 id="scope-heading" className="font-display text-lg font-bold">
                {t("em.scopeTitle")}
              </h2>
              <dl className="mt-3 space-y-2 text-sm">
                <div className="flex gap-2">
                  <dt className="shrink-0 font-bold">{t("em.target")}</dt>
                  <dd>WCAG 2.2 {scope.conformanceTarget}</dd>
                </div>
                <div>
                  <dt className="font-bold">{t("em.baseline")}</dt>
                  <dd className="mt-1 text-[var(--color-ink-soft)]">
                    {scope.accessibilitySupportBaseline.join(" · ")}
                  </dd>
                </div>
                {scope.notes && (
                  <div>
                    <dt className="font-bold">{t("em.notes")}</dt>
                    <dd className="mt-1 whitespace-pre-wrap text-[var(--color-ink-soft)]">{scope.notes}</dd>
                  </div>
                )}
              </dl>
            </div>
          )}
          {summary.sample && (
            <div className="doc-card p-6">
              <h2 className="font-display text-lg font-bold">{t("em.sampleTitle")}</h2>
              <dl className="mt-3 space-y-2 text-sm">
                <div className="flex gap-2">
                  <dt className="shrink-0 font-bold">{t("em.technologies")}</dt>
                  <dd>{summary.sample.technologies.join(", ")}</dd>
                </div>
                <div className="flex gap-2">
                  <dt className="shrink-0 font-bold">{t("em.sampleCounts")}</dt>
                  <dd>
                    {t("em.structured")} {summary.sample.structuredCount} · {t("em.random")} {summary.sample.randomCount}
                    {summary.sample.processCount > 0 ? ` · ${t("em.process")} ${summary.sample.processCount}` : ""}
                  </dd>
                </div>
                <div>
                  <dt className="font-bold">{t("em.method")}</dt>
                  <dd className="mt-1 text-[var(--color-ink-soft)]">{summary.sample.method}</dd>
                </div>
                <div>
                  <dt className="font-bold">{t("em.representativeness")}</dt>
                  <dd className="mt-1 text-[var(--color-ink-soft)]">
                    {summary.sample.randomSurfacedNewRules.length === 0
                      ? t("em.repOk")
                      : t("em.repNew", { count: summary.sample.randomSurfacedNewRules.length })}
                  </dd>
                </div>
              </dl>
            </div>
          )}
        </section>
      )}

      {/* ─── 표본 페이지 상세 (Step 3 + 검사 상태) ─── */}
      {(pages ?? []).length > 0 && (
        <section aria-labelledby="pages-heading" className="mt-8">
          <h2 id="pages-heading" className="font-display text-xl font-bold">
            {t("pages.title")}
          </h2>
          <p className="mt-1 text-sm text-[var(--color-ink-soft)]">
            {t("pages.summary", {
              total: (pages ?? []).length,
              done: (pages ?? []).filter((p) => p.status === "done").length,
              failed: failedPages.length,
            })}
          </p>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full border-collapse border-y-[1.5px] border-[var(--color-ink)] text-sm">
              <caption className="sr-only">{t("pages.title")}</caption>
              <thead>
                <tr className="border-b-[1.5px] border-[var(--color-ink)] text-left">
                  <th scope="col" className="py-2 pr-3 font-bold">{t("pages.colUrl")}</th>
                  <th scope="col" className="w-24 py-2 pr-3 font-bold">{t("pages.colCategory")}</th>
                  <th scope="col" className="w-20 py-2 pr-3 font-bold">{t("pages.colSample")}</th>
                  <th scope="col" className="w-24 py-2 pr-3 text-right font-bold">{t("pages.colViolations")}</th>
                  <th scope="col" className="w-40 py-2 font-bold">{t("pages.colStatus")}</th>
                </tr>
              </thead>
              <tbody>
                {(pages ?? []).map((p) => {
                  const category = (p.category ?? "content") as PageCategory;
                  const sampleType = (p.sample_type ?? "structured") as SampleType;
                  const viaExtension = p.via === "extension";
                  const vc = (p.violation_counts ?? {}) as Record<string, number>;
                  const critSer = (vc.critical ?? 0) + (vc.serious ?? 0);
                  const totalV = critSer + (vc.moderate ?? 0) + (vc.minor ?? 0);
                  return (
                    <tr key={p.id} className="border-b border-[var(--color-line)] align-top">
                      <td className="break-all py-2 pr-3">
                        {p.url}
                        {viaExtension && (
                          <span className="ml-2 inline-block whitespace-nowrap rounded-full border border-[var(--color-seal)] px-2 py-0.5 text-xs font-bold text-[var(--color-seal)]">
                            {t("pages.viaExtension")}
                          </span>
                        )}
                      </td>
                      <td className="py-2 pr-3 text-[var(--color-ink-soft)]">{t(`pages.category.${category}`)}</td>
                      <td className="py-2 pr-3 text-[var(--color-ink-soft)]">{t(`pages.sample.${sampleType}`)}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">
                        {p.status === "done" ? (
                          totalV === 0 ? (
                            <span className="text-[var(--color-pass)]">0</span>
                          ) : (
                            <span className={critSer > 0 ? "font-bold text-[var(--color-crit)]" : "text-[var(--color-ink-soft)]"}>
                              {totalV}
                            </span>
                          )
                        ) : (
                          <span className="text-[var(--color-ink-faint)]">–</span>
                        )}
                      </td>
                      <td className="py-2">
                        {p.status === "done" ? (
                          <span className="font-bold text-[var(--color-pass)]">{t("pages.statusDone")}</span>
                        ) : p.status === "failed" ? (
                          <>
                            <span className="mr-2 font-bold text-[var(--color-crit)]">{t("pages.statusFailed")}</span>
                            {canEdit && <RescanPageButton scanId={scan.id} pageId={p.id} />}
                            <p className="mt-0.5 text-xs leading-relaxed text-[var(--color-ink-soft)]">
                              {t(`failedPages.reasons.${classifyScanError(p.error as string | null)}`)}
                            </p>
                          </>
                        ) : (
                          <span className="text-[var(--color-ink-faint)]">{t("pages.statusSkipped")}</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* ─── 요약: 자동/수동/통합 준수율 + 심각도별 위반 ─── */}
      <section aria-labelledby="score-heading" className="print-avoid-break mt-8">
        <h2 id="score-heading" className="sr-only">
          {summary.scores ? t("scores.combined") : t("score.title")}
        </h2>
        <div className="grid gap-5 lg:grid-cols-[1.15fr_1fr]">
          {summary.scores ? (
            <div className="doc-card p-6">
              {/* 통합 준수율 (headline) */}
              <div className="flex items-baseline justify-between gap-4">
                <div>
                  <p className="text-sm font-bold text-[var(--color-ink-soft)]">{t("scores.combined")}</p>
                  <p className="font-display mt-1 text-6xl font-extrabold leading-none text-[var(--color-seal)]">
                    {summary.scores.combined.rate}
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
                  const s = summary.scores![kind];
                  return (
                    <div key={kind} className="rounded-md border border-[var(--color-line)] bg-[var(--color-paper-warm)] p-3.5">
                      <p className="text-xs font-bold text-[var(--color-ink-soft)]">{t(`scores.${kind}`)}</p>
                      <p className="font-display mt-0.5 text-3xl font-extrabold leading-none">
                        {s.evaluated === 0 ? "—" : `${s.rate}%`}
                      </p>
                      <p className="mt-1.5 text-[11px] leading-tight text-[var(--color-ink-faint)]">
                        {s.evaluated === 0
                          ? t("scores.noManual")
                          : t("scores.passFail", { passed: s.passed, failed: s.failed })}
                      </p>
                      <p className="text-[11px] leading-tight text-[var(--color-ink-faint)]">
                        {t("scores.coverage", { evaluated: s.evaluated, total: summary.scores!.totalCriteria })}
                      </p>
                    </div>
                  );
                })}
              </div>
              <p className="mt-3.5 flex flex-wrap gap-x-4 gap-y-1 text-sm">
                <span>
                  {t("scores.violations")}{" "}
                  <strong className="text-[var(--color-crit)]">{t("scores.unit", { count: summary.totalViolations })}</strong>
                </span>
                <span>
                  {t("scores.violationNodes")}{" "}
                  <strong className="text-[var(--color-crit)]">{t("scores.unit", { count: summary.totalViolationNodes })}</strong>
                </span>
              </p>
              <p className="mt-3 text-xs leading-relaxed text-[var(--color-ink-faint)]">{t("scores.legend")}</p>
            </div>
          ) : (
            <div className="doc-card flex flex-col items-center justify-center px-10 py-8 text-center">
              <p className="text-sm font-bold text-[var(--color-ink-soft)]">{t("score.title")}</p>
              <p className="font-display mt-1 text-6xl font-extrabold text-[var(--color-seal)]">
                {summary.complianceRate}
                <span className="text-2xl">%</span>
              </p>
              <p className="mt-3 flex gap-4 text-sm">
                <span>
                  {t("score.violations")}{" "}
                  <strong className="text-[var(--color-crit)]">{t("score.unit", { count: summary.totalViolations })}</strong>
                </span>
                <span>
                  {t("score.violationNodes")}{" "}
                  <strong className="text-[var(--color-crit)]">{t("score.unit", { count: summary.totalViolationNodes })}</strong>
                </span>
              </p>
              <p className="mt-4 text-xs leading-relaxed text-[var(--color-ink-faint)]">{t("score.desc")}</p>
            </div>
          )}
          <div className="doc-card p-6">
            <h3 className="text-sm font-bold text-[var(--color-ink-soft)]">{t("impact.title")}</h3>
            <ul className="mt-4 space-y-2.5">
              {IMPACT_ORDER.map((key) => (
                <li key={key} className="grid grid-cols-[5rem_1fr_3rem] items-center gap-3 text-sm">
                  <span className="font-semibold">{t(`impact.${key}`)}</span>
                  <span aria-hidden="true" className="h-4 overflow-hidden rounded-sm bg-[var(--color-paper-warm)]">
                    <span
                      className={`block h-full ${key === "critical" || key === "serious" ? "bg-[var(--color-crit)]" : "bg-[var(--color-ink-faint)]"}`}
                      style={{ width: `${(summary.byImpact[key] / maxImpact) * 100}%` }}
                    />
                  </span>
                  <span className="text-right font-bold tabular-nums">{summary.byImpact[key]}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* ─── 전후 비교 — 같은 대상의 직전 검사와 비교해 개선 효과를 보여준다 ─── */}
      {compare && (
        <section
          aria-labelledby="compare-heading"
          className="print-avoid-break mt-6 border-[1.5px] border-[var(--color-seal)] bg-[var(--color-seal-tint)] p-6"
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 id="compare-heading" className="font-display text-xl font-bold">
              {t("compare.title")}
            </h2>
            {compareOptions.length > 1 && (
              <CompareSelect
                label={t("compare.pickerLabel")}
                selected={compareOptions.find((o) => o.id === compareParam)?.id ?? compareOptions[0].id}
                options={compareOptions.map((o, i) => ({
                  id: o.id,
                  label:
                    format.dateTime(new Date(o.created_at), { dateStyle: "medium", timeStyle: "short" }) +
                    (i === compareOptions.length - 1 ? ` — ${t("compare.pickerFirst")}` : i === 0 ? ` — ${t("compare.pickerPrev")}` : ""),
                }))}
              />
            )}
          </div>
          <p className="mt-1.5 text-sm text-[var(--color-ink-soft)]">
            {t("compare.desc", { date: format.dateTime(new Date(compare.prevDate), { dateStyle: "medium" }) })}
          </p>
          <dl className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
            <div>
              <dt className="text-sm font-medium text-[var(--color-ink-soft)]">{t("compare.rate")}</dt>
              <dd
                className={`font-display text-3xl font-extrabold tabular-nums ${
                  compare.rateDelta > 0 ? "text-[var(--color-seal)]" : compare.rateDelta < 0 ? "text-[var(--color-crit)]" : ""
                }`}
              >
                {compare.rateDelta > 0 ? "+" : ""}
                {compare.rateDelta}%p
              </dd>
            </div>
            <div>
              <dt className="text-sm font-medium text-[var(--color-ink-soft)]">{t("compare.nodes")}</dt>
              <dd
                className={`font-display text-3xl font-extrabold tabular-nums ${
                  compare.nodesDelta < 0 ? "text-[var(--color-seal)]" : compare.nodesDelta > 0 ? "text-[var(--color-crit)]" : ""
                }`}
              >
                {compare.nodesDelta > 0 ? "+" : ""}
                {compare.nodesDelta}
              </dd>
            </div>
            <div>
              <dt className="text-sm font-medium text-[var(--color-ink-soft)]">{t("compare.resolved")}</dt>
              <dd className="font-display text-3xl font-extrabold tabular-nums text-[var(--color-seal)]">
                {compare.resolvedRules.length}
              </dd>
            </div>
            <div>
              <dt className="text-sm font-medium text-[var(--color-ink-soft)]">{t("compare.new")}</dt>
              <dd className="font-display text-3xl font-extrabold tabular-nums">{compare.newRules.length}</dd>
            </div>
          </dl>
          {compare.resolvedRules.length > 0 && (
            <p className="mt-3 text-sm text-[var(--color-ink-soft)]">
              <strong>{t("compare.resolvedList")}:</strong>{" "}
              {compare.resolvedRules.map((r) => pick(getRuleEntry(r).title, locale)).join(" · ")}
            </p>
          )}
          {compare.newRules.length > 0 && (
            <p className="mt-1.5 text-sm text-[var(--color-ink-soft)]">
              <strong>{t("compare.newList")}:</strong>{" "}
              {compare.newRules.map((r) => pick(getRuleEntry(r).title, locale)).join(" · ")}
            </p>
          )}
        </section>
      )}

      {/* ─── 수동 판정 진행률 ─── */}
      {manualProgress.length > 0 && (
        <section aria-labelledby="manual-progress-heading" className="print-avoid-break mt-6 doc-card p-6">
          <h2 id="manual-progress-heading" className="font-display text-xl font-bold">
            {t("manualProgress.title")}
          </h2>
          <p className="mt-1.5 text-sm text-[var(--color-ink-soft)]">{t("manualProgress.desc")}</p>
          <div className="mt-4 space-y-4">
            {manualProgress.map((x) => {
              const pct = Math.round((x.done / x.total) * 100);
              return (
                <div key={x.key}>
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-sm font-bold">{x.label}</span>
                    <span className="text-sm tabular-nums text-[var(--color-ink-soft)]">
                      {t("manualProgress.line", { done: x.done, total: x.total })} ({pct}%)
                    </span>
                  </div>
                  <div
                    role="progressbar"
                    aria-valuenow={x.done}
                    aria-valuemin={0}
                    aria-valuemax={x.total}
                    aria-label={`${x.label} ${t("manualProgress.title")}`}
                    className="mt-1.5 h-2.5 overflow-hidden rounded-full border border-[var(--color-line)] bg-[var(--color-paper-warm)]"
                  >
                    <div className="h-full bg-[var(--color-seal)]" style={{ width: `${pct}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* ─── 표준별 매트릭스 — std로 선택, preferred로 순서 결정 ─── */}
      {(() => {
        // WCAG 2.2 성공기준 매트릭스 (WCAG-EM Step 4)
        const wcagBlock = hasWcag ? (
        <section aria-labelledby="wcag-heading" className="print-break-before mt-10">
          <h2 id="wcag-heading" className="font-display text-2xl font-bold">
            {t("wcag.title")}
          </h2>
          <p className="mt-1.5 text-sm text-[var(--color-ink-soft)]">{t("wcag.desc")}</p>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full border-collapse border-y-[1.5px] border-[var(--color-ink)] text-sm">
              <caption className="sr-only">{t("wcag.title")}</caption>
              <thead>
                <tr className="border-b-[1.5px] border-[var(--color-ink)] text-left">
                  <th scope="col" className="py-2 pr-3 font-bold">{t("wcag.colSc")}</th>
                  <th scope="col" className="w-16 py-2 pr-3 font-bold">{t("wcag.colLevel")}</th>
                  <th scope="col" className="w-32 py-2 pr-3 font-bold">{t("wcag.colOutcome")}</th>
                  <th scope="col" className="w-14 py-2 pr-3 text-right font-bold">{t("wcag.colCount")}</th>
                  {canEdit && (
                    <th scope="col" className="no-print w-24 py-2 font-bold">{t("review.col")}</th>
                  )}
                </tr>
              </thead>
              <tbody>
                {summary.wcagMatrix.map((row) => {
                  const c = WCAG_BY_ID.get(row.scId);
                  if (!c) return null;
                  const review = wcagReviews.get(row.scId) ?? null;
                  if (!wcagRowVisible(row.outcome, review)) return null;
                  const effective = (review?.outcome as WcagOutcome | undefined) ?? row.outcome;
                  return (
                    <tr key={row.scId} className="border-b border-[var(--color-line)] align-top">
                      <th scope="row" className="py-2 pr-3 text-left font-medium">
                        <span className="mr-2 tabular-nums text-[var(--color-ink-faint)]">{row.scId}</span>
                        {pick(c.name, locale)}
                        {review?.note && (
                          <p className="mt-1 text-xs font-normal leading-relaxed text-[var(--color-ink-soft)]">
                            <strong>{t("review.noteLabel")}:</strong> {review.note}
                          </p>
                        )}
                        {review?.pages && review.pages.length > 0 && (
                          <p className="mt-1 break-all text-xs font-normal leading-relaxed text-[var(--color-ink-soft)]">
                            <strong>{t("review.relatedPages")}:</strong> {review.pages.join(" · ")}
                          </p>
                        )}
                        {/* 스크롤 없이 그 자리에서: 위반→개선 방법 / 확인 필요→확인 방법 / 수동→검사 방법 */}
                        {row.outcome === "failed" && row.ruleIds.length > 0 && (
                          <MatrixDetail kind="fix" ruleIds={row.ruleIds} scId={row.scId} locale={locale} />
                        )}
                        {row.outcome === "cannotTell" && (row.reviewRuleIds?.length ?? 0) > 0 && (
                          <MatrixDetail kind="review" ruleIds={row.reviewRuleIds} scId={row.scId} locale={locale} />
                        )}
                        {row.outcome === "notChecked" && (
                          <MatrixDetail kind="manual" scId={row.scId} locale={locale} />
                        )}
                      </th>
                      <td className="py-2 pr-3 text-[var(--color-ink-faint)]">{c.level}</td>
                      <td className="py-2 pr-3">
                        <span className={`inline-block rounded-sm border px-2 py-0.5 text-xs font-bold ${outcomeStyle[effective]}`}>
                          {t(`wcag.outcome.${effective}`)}
                        </span>
                        {review && (
                          <span className="ml-1 inline-block rounded-sm bg-[var(--color-mark)] px-1.5 py-0.5 text-[0.65rem] font-extrabold text-[var(--color-ink-on-mark)]">
                            {t("review.badge")}
                          </span>
                        )}
                      </td>
                      <td className="py-2 pr-3 text-right font-bold tabular-nums">
                        {row.violationCount > 0 ? row.violationCount : "—"}
                      </td>
                      {canEdit && (
                        <td className="no-print py-2">
                          <ReviewCell scanId={scan.id} standard="wcag" itemId={row.scId} current={review} pageUrls={donePageUrls} />
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-xs leading-relaxed text-[var(--color-ink-faint)]">{t("wcag.notCheckedNote")}</p>
        </section>
        ) : null;

        // KWCAG 블록 — 인증 준비 요약(KWCAG 인증 기준 귀속)과 33항목 매트릭스
        const kwcagBlock = (
        <>
        {/* ─── 인증 준비 요약 — 전문가 심사 합격선(평균 95%) 근사 ─── */}
        {cert.averageRate != null && (
        <section aria-labelledby="cert-heading" className="print-avoid-break mt-10 doc-card p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 id="cert-heading" className="font-display text-xl font-bold">
              {t("cert.title")}
            </h2>
            <span
              className={`rounded-full border-[1.5px] px-3 py-1 text-sm font-bold ${
                cert.band === "pass"
                  ? "border-[var(--color-seal)] bg-[var(--color-seal-tint)] text-[var(--color-pass)]"
                  : cert.band === "second"
                    ? "border-[var(--color-line)] bg-[var(--color-warn-tint)] text-[var(--color-ink)]"
                    : "border-[var(--color-crit)] bg-[var(--color-crit-tint)] text-[var(--color-crit)]"
              }`}
            >
              {t(`cert.band.${cert.band}`)}
            </span>
          </div>
          <div className="mt-3 flex items-end gap-3">
            <span className="font-display text-5xl font-extrabold tabular-nums">{cert.averageRate}</span>
            <span className="pb-1.5 text-sm text-[var(--color-ink-faint)]">
              % · {t("cert.evaluated", { evaluated: cert.evaluatedCount, total: cert.totalCount })}
            </span>
          </div>
          {cert.belowItems.length > 0 && (
            <div className="mt-4">
              <p className="text-sm font-bold">{t("cert.belowTitle", { count: cert.belowItems.length })}</p>
              <ul className="mt-2 flex flex-wrap gap-2">
                {cert.belowItems.map((b) => {
                  const item = KWCAG_BY_ID.get(b.itemId);
                  return (
                    <li
                      key={b.itemId}
                      className="rounded border-[1.5px] border-[var(--color-crit)] bg-[var(--color-crit-tint)] px-2 py-1 text-xs font-semibold text-[var(--color-crit)]"
                    >
                      {b.itemId} {item ? pick(item.name, locale) : ""} · {b.rate}%
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
          <p className="mt-4 text-xs leading-relaxed text-[var(--color-ink-faint)]">{t("cert.note")}</p>
        </section>
        )}

        {/* ─── KWCAG 매트릭스 ─── */}
        <section aria-labelledby="kwcag-heading" className="print-break-before mt-10">
        <h2 id="kwcag-heading" className="font-display text-2xl font-bold">
          {t("kwcag.title")}
        </h2>
        <p className="mt-1.5 text-sm text-[var(--color-ink-soft)]">{t("kwcag.desc")}</p>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full border-collapse border-y-[1.5px] border-[var(--color-ink)] text-sm">
            <caption className="sr-only">{t("kwcag.title")}</caption>
            <thead>
              <tr className="border-b-[1.5px] border-[var(--color-ink)] text-left">
                <th scope="col" className="py-2 pr-3 font-bold">
                  {t("kwcag.colItem")}
                </th>
                <th scope="col" className="w-32 py-2 pr-3 font-bold">
                  {t("kwcag.colStatus")}
                </th>
                <th scope="col" className="w-14 py-2 pr-3 text-right font-bold">
                  {t("kwcag.colCount")}
                </th>
                <th scope="col" className="w-24 py-2 pr-3 text-right font-bold">
                  {t("kwcag.colPageRate")}
                </th>
                {canEdit && (
                  <th scope="col" className="no-print w-24 py-2 font-bold">{t("review.col")}</th>
                )}
              </tr>
            </thead>
            <tbody>
              {summary.kwcagMatrix.map((row) => {
                const item = KWCAG_BY_ID.get(row.itemId);
                if (!item) return null;
                const review = kwcagReviews.get(row.itemId) ?? null;
                if (!kwcagRowVisible(row.status, review)) return null;
                return (
                  <tr key={row.itemId} className="border-b border-[var(--color-line)] align-top">
                    <th scope="row" className="py-2 pr-3 text-left font-medium">
                      <span className="mr-2 tabular-nums text-[var(--color-ink-faint)]">{item.id}</span>
                      {pick(item.name, locale)}
                      {item.addedIn22 && (
                        <span className="ml-2 rounded-sm bg-[var(--color-seal-tint)] px-1.5 py-0.5 text-[0.7rem] font-bold text-[var(--color-seal)]">
                          {t("kwcag.new22")}
                        </span>
                      )}
                      <span className="ml-2 text-xs text-[var(--color-ink-faint)]">
                        {KWCAG_PRINCIPLE_LABEL[item.principle][locale === "en" ? "en" : "ko"]}
                      </span>
                      {review?.note && (
                        <p className="mt-1 text-xs font-normal leading-relaxed text-[var(--color-ink-soft)]">
                          <strong>{t("review.noteLabel")}:</strong> {review.note}
                        </p>
                      )}
                      {row.status === "fail" && row.ruleIds.length > 0 && (
                        <MatrixDetail kind="fix" ruleIds={row.ruleIds} locale={locale} />
                      )}
                      {row.status === "review" && (row.reviewRuleIds?.length ?? 0) > 0 && (
                        <MatrixDetail kind="review" ruleIds={row.reviewRuleIds} locale={locale} />
                      )}
                      {(row.status === "manual" || row.status === "not-applicable") && item.howToTest && (
                        <MatrixDetail kind="manual" howToTest={item.howToTest} locale={locale} />
                      )}
                    </th>
                    <td className="py-2 pr-3">
                      {review ? (
                        <>
                          <span
                            className={`inline-block rounded-sm border px-2 py-0.5 text-xs font-bold ${outcomeStyle[review.outcome as WcagOutcome]}`}
                          >
                            {t(`wcag.outcome.${review.outcome as WcagOutcome}`)}
                          </span>
                          <span className="ml-1 inline-block rounded-sm bg-[var(--color-mark)] px-1.5 py-0.5 text-[0.65rem] font-extrabold text-[var(--color-ink-on-mark)]">
                            {t("review.badge")}
                          </span>
                        </>
                      ) : (
                        <span className={`inline-block rounded-sm border px-2 py-0.5 text-xs font-bold ${statusStyle[row.status]}`}>
                          {t(`kwcag.status.${row.status}`)}
                        </span>
                      )}
                    </td>
                    <td className="py-2 pr-3 text-right font-bold tabular-nums">{row.violationCount > 0 ? row.violationCount : "—"}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">
                      {(() => {
                        const applicable = row.status === "pass" || row.status === "fail" || row.status === "review";
                        const rate = kwcagRates.get(row.itemId)?.rate;
                        if (!applicable || rate == null) return <span className="text-[var(--color-ink-faint)]">—</span>;
                        return (
                          <span className={rate >= 95 ? "font-bold text-[var(--color-pass)]" : "font-bold text-[var(--color-crit)]"}>
                            {rate}%
                          </span>
                        );
                      })()}
                    </td>
                    {canEdit && (
                      <td className="no-print py-2">
                        <ReviewCell scanId={scan.id} standard="kwcag" itemId={row.itemId} current={review} pageUrls={donePageUrls} />
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-xs leading-relaxed text-[var(--color-ink-faint)]">{t("kwcag.certNote")}</p>
        </section>
        </>
        );

        const first = std !== "kwcag" ? wcagBlock : null;
        const second = std !== "wcag" ? kwcagBlock : null;
        return preferred === "wcag" ? (
          <>
            {first}
            {second}
          </>
        ) : (
          <>
            {second}
            {first}
          </>
        );
      })()}

      {/* ─── 위반 상세 ─── */}
      {/* ─── 우선 수정 권고 — 심각도·규모 기준 상위 규칙 액션 플랜 ─── */}
      {ruleGroups.length > 0 && (
        <section aria-labelledby="priority-heading" className="print-avoid-break mt-12">
          <h2 id="priority-heading" className="font-display text-2xl font-bold">
            {t("priority.title")}
          </h2>
          <p className="mt-1.5 text-sm text-[var(--color-ink-soft)]">{t("priority.desc")}</p>
          <ol className="mt-4 space-y-3">
            {ruleGroups.slice(0, 5).map(({ ruleId, rows, entry, impact }, idx) => {
              const pageCount = new Set(rows.map((r) => r.scan_pages?.url ?? "?")).size;
              // 가이드 첫 문장 = 핵심 조치 (마크다운 기호 제거)
              const firstSentence = pick(entry.guide, locale)
                .split("\n")[0]!
                .replace(/[`*]/g, "")
                .slice(0, 160);
              return (
                <li key={ruleId} className="doc-card flex flex-wrap items-start gap-3 p-4">
                  <span className="font-display text-2xl font-extrabold text-[var(--color-ink-faint)]">{idx + 1}</span>
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2">
                      <span
                        className={`rounded-sm border-[1.5px] px-2 py-0.5 text-xs font-extrabold ${
                          impact === "critical" || impact === "serious"
                            ? "border-[var(--color-crit)] bg-[var(--color-crit-tint)] text-[var(--color-crit)]"
                            : "border-[var(--color-line)] bg-[var(--color-paper-warm)] text-[var(--color-ink-soft)]"
                        }`}
                      >
                        {t(`impact.${impact}`)}
                      </span>
                      <a href={`#rule-${ruleId}`} className="font-bold underline underline-offset-4 hover:text-[var(--color-seal)]">
                        {pick(entry.title, locale)}
                      </a>
                    </p>
                    <p className="mt-1 text-xs text-[var(--color-ink-faint)]">
                      {t("priority.stats", { nodes: rows.length, pages: pageCount })}
                    </p>
                    <p className="mt-1.5 text-sm text-[var(--color-ink-soft)]">{firstSentence}</p>
                  </div>
                </li>
              );
            })}
          </ol>
        </section>
      )}

      <section aria-labelledby="violations-heading" className="print-break-before mt-12">
        <h2 id="violations-heading" className="font-display text-2xl font-bold">
          {t("violations.title")}
        </h2>
        {ruleGroups.length === 0 ? (
          <p className="mt-4 border-[1.5px] border-[var(--color-seal)] bg-[var(--color-seal-tint)] p-4 font-medium">
            {t("violations.empty")}
          </p>
        ) : (
          <div className="mt-5 space-y-8">
            {ruleGroups.map(({ ruleId, rows, entry, impact }) => {
              // 규칙별 영향 페이지 → 위반 요소 수
              const pageCounts = new Map<string, number>();
              for (const row of rows) {
                const u = row.scan_pages?.url ?? "?";
                pageCounts.set(u, (pageCounts.get(u) ?? 0) + 1);
              }
              const affected = [...pageCounts.entries()].sort((a, b) => b[1] - a[1]);
              return (
              <article key={ruleId} id={`rule-${ruleId}`} className="print-avoid-break doc-card scroll-mt-4 p-6">
                <header className="flex flex-wrap items-center gap-2">
                  <span
                    className={`rounded-sm border-[1.5px] px-2 py-0.5 text-xs font-extrabold ${
                      impact === "critical" || impact === "serious"
                        ? "border-[var(--color-crit)] bg-[var(--color-crit-tint)] text-[var(--color-crit)]"
                        : "border-[var(--color-line)] bg-[var(--color-paper-warm)] text-[var(--color-ink-soft)]"
                    }`}
                  >
                    {t(`impact.${impact}`)}
                  </span>
                  <h3 className="font-display min-w-0 flex-1 text-lg font-bold">{pick(entry.title, locale)}</h3>
                  <span className="text-sm font-bold tabular-nums text-[var(--color-ink-soft)]">
                    {t("violations.nodes", { count: rows.length })}
                  </span>
                </header>

                <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-[var(--color-ink-faint)]">
                  <span>
                    {t("violations.level")}: {entry.level === "BP" ? t("violations.bp") : `WCAG ${entry.level}`}
                  </span>
                  {entry.wcag.length > 0 && <span>{t("violations.wcag")} {entry.wcag.join(", ")}</span>}
                  {entry.kwcag.length > 0 && <span>{t("violations.kwcag")} {entry.kwcag.join(", ")}</span>}
                  <span className="font-mono">{ruleId}</span>
                </p>

                {affected.length > 0 && (
                  <div className="mt-3 border-l-[3px] border-[var(--color-crit)] bg-[var(--color-crit-tint)] py-2 pl-3">
                    <p className="text-sm font-bold">
                      {t("violations.affectedPages", { count: affected.length })}
                    </p>
                    <ul className="mt-1 space-y-0.5 text-xs text-[var(--color-ink-soft)]">
                      {affected.map(([url, count]) => (
                        <li key={url} className="flex flex-wrap gap-x-2">
                          <span className="break-all">{url}</span>
                          <span className="whitespace-nowrap font-bold tabular-nums">
                            {t("violations.nodes", { count })}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                <h4 className="mt-4 text-sm font-bold">{t("violations.guideTitle")}</h4>
                <div className="mt-2">
                  <GuideText text={pick(entry.guide, locale)} />
                </div>

                <h4 className="mt-5 text-sm font-bold">{t("violations.exampleTitle")}</h4>
                <ul className="mt-2 space-y-3">
                  {rows.slice(0, 5).map((row, i) => (
                    <li key={i} className="border-l-[3px] border-[var(--color-line)] pl-3 text-sm">
                      <p className="break-all text-xs text-[var(--color-ink-faint)]">
                        {t("violations.pageLabel")}: {row.scan_pages?.url} · {t("violations.selectorLabel")}:{" "}
                        <code>{row.selector}</code>
                      </p>
                      <pre tabIndex={0} className="mt-1.5 overflow-x-auto rounded bg-[var(--color-paper-warm)] p-2.5 text-[0.8rem]">
                        <code>{row.html_snippet}</code>
                      </pre>
                      {row.failure_summary && (
                        <p className="mt-1.5 text-xs leading-relaxed text-[var(--color-ink-soft)]">
                          <span className="font-bold">{t("violations.diagLabel")}:</span>{" "}
                          <span className="whitespace-pre-wrap">{row.failure_summary}</span>
                        </p>
                      )}
                    </li>
                  ))}
                  {rows.length > 5 && (
                    <li className="text-xs text-[var(--color-ink-faint)]">+ {rows.length - 5}</li>
                  )}
                </ul>

                {rows[0]?.help_url && (
                  <a
                    href={rows[0].help_url}
                    rel="noopener"
                    className="no-print mt-4 inline-block text-sm font-semibold text-[var(--color-seal)] underline underline-offset-4"
                  >
                    {t("violations.axeHelp")} ↗
                  </a>
                )}
              </article>
              );
            })}
          </div>
        )}
      </section>

      {/* ─── 확인용 수집 자료 — 값은 존재하나 품질은 사람이 확증 (1.1.1·2.4.4·3.3.2 등) ─── */}
      {view === "all" && reviewPages.length > 0 && (
        <section aria-labelledby="review-data-heading" className="print-break-before mt-12">
          <h2 id="review-data-heading" className="font-display text-2xl font-bold">
            {t("reviewData.title")}
          </h2>
          <p className="mt-1.5 text-sm text-[var(--color-ink-soft)]">{t("reviewData.desc")}</p>
          <div className="mt-4 space-y-3">
            {reviewPages.map(({ url, review }) => (
              <details key={url} className="border-[1.5px] border-[var(--color-line)] bg-[var(--color-paper-warm)]">
                <summary className="cursor-pointer break-all p-4 text-sm font-bold">{url}</summary>
                <div className="space-y-4 border-t border-dashed border-[var(--color-line)] p-4">
                  {(
                    [
                      ["alts", t("reviewData.alts"), t("reviewData.altsHint")],
                      ["labels", t("reviewData.labels"), t("reviewData.labelsHint")],
                      ["genericLinks", t("reviewData.genericLinks"), t("reviewData.genericLinksHint")],
                    ] as const
                  ).map(([key, label, hint]) =>
                    review[key].length > 0 ? (
                      <div key={key}>
                        <h3 className="text-sm font-bold">{label}</h3>
                        <p className="mt-0.5 text-xs text-[var(--color-ink-faint)]">{hint}</p>
                        <ul className="mt-2 space-y-1">
                          {review[key].map((s, i) => (
                            <li key={i} className="flex flex-wrap items-baseline gap-x-3 text-sm">
                              <span className="font-semibold">“{s.text}”</span>
                              <code className="break-all font-mono text-xs text-[var(--color-ink-faint)]">{s.selector}</code>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : null,
                  )}
                </div>
              </details>
            ))}
          </div>
        </section>
      )}

      {/* ─── 수동 검사 항목 (출력 범위 all일 때만) ─── */}
      {view === "all" && (
      <section aria-labelledby="manual-heading" className="print-break-before mt-12">
        <h2 id="manual-heading" className="font-display text-2xl font-bold">
          {t("manual.title")}
        </h2>
        <p className="mt-1.5 text-sm text-[var(--color-ink-soft)]">{t("manual.desc")}</p>
        <ul className="mt-5 space-y-4">
          {manualItems.map((item) => (
            <li key={item.id} className="print-avoid-break border-[1.5px] border-[var(--color-line)] bg-[var(--color-paper-warm)] p-5">
              <h3 className="font-bold">
                <span className="mr-2 tabular-nums text-[var(--color-ink-faint)]">{item.id}</span>
                {pick(item.name, locale)}
              </h3>
              {item.howToTest && (
                <p className="mt-2 text-sm leading-relaxed text-[var(--color-ink-soft)]">
                  <strong className="text-[var(--color-ink)]">{t("manual.howToTest")}:</strong> {pick(item.howToTest, locale)}
                </p>
              )}
            </li>
          ))}
        </ul>
      </section>
      )}

      {/* ─── WCAG-EM 적합성 진술 (Step 5.c) ─── */}
      <section aria-labelledby="statement-heading" className="print-avoid-break mt-12 border-[1.5px] border-[var(--color-ink)] bg-[var(--color-paper-warm)] p-6">
        <h2 id="statement-heading" className="font-display text-xl font-bold">
          {t("em.statementTitle")}
        </h2>
        <p className="mt-2 leading-relaxed">{t("em.statement", { target: scope?.conformanceTarget ?? "AA" })}</p>
      </section>

      {/* ─── 고지 ─── */}
      <footer className="mt-8 border-t-[1.5px] border-[var(--color-ink)] pt-5 text-sm leading-relaxed text-[var(--color-ink-faint)]">
        <p>{t("disclaimer")}</p>
        <p className="mt-2">{t("generatedBy")}</p>
      </footer>
    </div>
  );
}
