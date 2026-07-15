import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { notFound, redirect } from "next/navigation";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  KWCAG_BY_ID,
  KWCAG_PRINCIPLE_LABEL,
  WCAG_BY_ID,
  getManualCheckItems,
  getRuleEntry,
  type EvaluationScope,
  type Impact,
  type PageCategory,
  type ReportMeta,
  type SampleType,
  type ScanSummary,
  type WcagOutcome,
} from "@a11ychk/core/catalog";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { classifyScanError } from "@/lib/scanError";
import { verifyReportToken } from "@/lib/reportToken";
import { GuideText } from "@/components/GuideText";
import { PrintButton } from "./PrintButton";
import { ReviewCell, type ReviewValue } from "./ReviewCell";
import { ReportMetaForm } from "./ReportMetaForm";
import { MatrixDetail } from "./MatrixDetail";
import { RerunScanButton, RescanPageButton } from "./RescanButtons";

export async function generateMetadata({ params }: { params: Promise<{ locale: string; id: string }> }) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "report" });
  return { title: t("docTitle"), robots: { index: false } };
}

interface FindingRow {
  rule_id: string;
  impact: Impact;
  tags: string[];
  help_url: string | null;
  selector: string;
  html_snippet: string;
  failure_summary: string;
  scan_pages: { url: string } | null;
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
  searchParams: Promise<{ token?: string }>;
}) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const { token } = await searchParams;
  const t = await getTranslations("report");
  const format = await getFormatter();

  // 접근 제어: PDF 생성용 단기 토큰(스캔 1건 한정) 또는 로그인 사용자(RLS)
  let db: SupabaseClient;
  let canEdit = false; // 판정 기입·보고서 정보 편집 가능 여부 (토큰 접근은 읽기 전용)
  if (token && verifyReportToken(id, token)) {
    db = createAdminClient();
  } else {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) redirect(`/${locale}/login`);
    db = supabase as unknown as SupabaseClient;
    canEdit = true; // RLS 통과 = 소유자 또는 관리자
  }

  // select("*")로 조회해 migration 0003 적용 전에도 scope 컬럼 부재로 깨지지 않게 한다
  const { data: scan } = await db.from("scans").select("*").eq("id", id).maybeSingle();
  if (!scan || scan.status !== "done" || !scan.summary) notFound();

  const summary = scan.summary as ScanSummary;
  const scope = (scan.scope ?? null) as EvaluationScope | null;
  const meta = (scan.report_meta ?? null) as ReportMeta | null;

  // 점검자 판정 (migration 0004 전에는 테이블이 없어 실패 → 빈 목록으로 진행)
  const { data: reviewRows } = await db
    .from("scan_reviews")
    .select("standard, item_id, outcome, note")
    .eq("scan_id", id);
  const wcagReviews = new Map<string, ReviewValue>();
  const kwcagReviews = new Map<string, ReviewValue>();
  for (const r of reviewRows ?? []) {
    const target = r.standard === "wcag" ? wcagReviews : kwcagReviews;
    target.set(r.item_id, { outcome: r.outcome, note: r.note });
  }

  const [{ data: pages }, { data: findings }] = await Promise.all([
    db.from("scan_pages").select("*").eq("scan_id", id).order("url"),
    db
      .from("findings")
      .select("rule_id, impact, tags, help_url, selector, html_snippet, failure_summary, scan_pages(url)")
      .in("scan_page_id", (await db.from("scan_pages").select("id").eq("scan_id", id)).data?.map((p) => p.id) ?? [])
      .limit(2000),
  ]);

  // 규칙별 그룹화
  const byRule = new Map<string, FindingRow[]>();
  for (const f of (findings ?? []) as unknown as FindingRow[]) {
    const list = byRule.get(f.rule_id) ?? [];
    list.push(f);
    byRule.set(f.rule_id, list);
  }
  const ruleGroups = [...byRule.entries()]
    .map(([ruleId, rows]) => ({
      ruleId,
      rows,
      entry: getRuleEntry(ruleId, rows[0]?.tags ?? []),
      impact: rows[0]?.impact ?? "moderate",
    }))
    .sort((a, b) => IMPACT_ORDER.indexOf(a.impact) - IMPACT_ORDER.indexOf(b.impact));

  const failedPages = (pages ?? []).filter((p) => p.status === "failed");
  const manualItems = getManualCheckItems();
  const maxImpact = Math.max(1, ...IMPACT_ORDER.map((k) => summary.byImpact[k]));

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
      <div className="no-print mb-8 flex flex-wrap items-center justify-end gap-2">
        {canEdit && <RerunScanButton scanId={scan.id} />}
        <PrintButton label={t("print")} />
        <a
          href={`/api/scans/${scan.id}/earl`}
          className="rounded border-[1.5px] border-[var(--color-ink)] px-4 py-2 font-semibold hover:bg-[var(--color-paper-warm)]"
        >
          {t("downloadEarl")}
        </a>
        <a
          href={`/api/scans/${scan.id}/report-tool`}
          className="rounded border-[1.5px] border-[var(--color-ink)] px-4 py-2 font-semibold hover:bg-[var(--color-paper-warm)]"
        >
          {t("downloadReportTool")}
        </a>
        <a
          href={`/api/scans/${scan.id}/pdf`}
          className="rounded border-[1.5px] border-[var(--color-seal)] bg-[var(--color-seal)] px-4 py-2 font-semibold text-[var(--color-paper)] hover:bg-[var(--color-seal-deep)]"
        >
          {t("downloadPdf")}
        </a>
      </div>

      {/* ─── 보고서 정보 입력 (점검자, 화면 전용) ─── */}
      {canEdit && <ReportMetaForm scanId={scan.id} meta={meta} />}

      {/* ─── 표지/메타 ─── */}
      <header className="doc-card p-8">
        <p className="text-sm font-bold tracking-widest text-[var(--color-seal)]">A11Y CHECK · a11ychk.com</p>
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
                  <th scope="col" className="w-40 py-2 font-bold">{t("pages.colStatus")}</th>
                </tr>
              </thead>
              <tbody>
                {(pages ?? []).map((p) => {
                  const category = (p.category ?? "content") as PageCategory;
                  const sampleType = (p.sample_type ?? "structured") as SampleType;
                  return (
                    <tr key={p.id} className="border-b border-[var(--color-line)] align-top">
                      <td className="break-all py-2 pr-3">{p.url}</td>
                      <td className="py-2 pr-3 text-[var(--color-ink-soft)]">{t(`pages.category.${category}`)}</td>
                      <td className="py-2 pr-3 text-[var(--color-ink-soft)]">{t(`pages.sample.${sampleType}`)}</td>
                      <td className="py-2">
                        {p.status === "done" ? (
                          <span className="font-bold text-[var(--color-pass)]">{t("pages.statusDone")}</span>
                        ) : p.status === "failed" ? (
                          <>
                            <span className="mr-2 font-bold text-[var(--color-crit)]">{t("pages.statusFailed")}</span>
                            {canEdit && <RescanPageButton scanId={scan.id} pageId={p.id} />}
                            <p className="mt-0.5 text-xs leading-relaxed text-[var(--color-ink-soft)]">
                              {t(`failedPages.reasons.${classifyScanError(p.error)}`)}
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

      {/* ─── WCAG 2.2 성공기준 매트릭스 (WCAG-EM Step 4) ─── */}
      {summary.wcagMatrix && summary.wcagMatrix.length > 0 && (
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
                          <span className="ml-1 inline-block rounded-sm bg-[var(--color-mark)] px-1.5 py-0.5 text-[0.65rem] font-extrabold text-[#1c2422]">
                            {t("review.badge")}
                          </span>
                        )}
                      </td>
                      <td className="py-2 pr-3 text-right font-bold tabular-nums">
                        {row.violationCount > 0 ? row.violationCount : "—"}
                      </td>
                      {canEdit && (
                        <td className="no-print py-2">
                          <ReviewCell scanId={scan.id} standard="wcag" itemId={row.scId} current={review} />
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
      )}

      {/* ─── KWCAG 매트릭스 ─── */}
      <section aria-labelledby="kwcag-heading" className="mt-10">
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
                          <span className="ml-1 inline-block rounded-sm bg-[var(--color-mark)] px-1.5 py-0.5 text-[0.65rem] font-extrabold text-[#1c2422]">
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
                    {canEdit && (
                      <td className="no-print py-2">
                        <ReviewCell scanId={scan.id} standard="kwcag" itemId={row.itemId} current={review} />
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* ─── 위반 상세 ─── */}
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
            {ruleGroups.map(({ ruleId, rows, entry, impact }) => (
              <article key={ruleId} className="print-avoid-break doc-card p-6">
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
            ))}
          </div>
        )}
      </section>

      {/* ─── 수동 검사 항목 ─── */}
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
