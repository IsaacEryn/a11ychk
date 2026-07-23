import { NextResponse } from "next/server";
import { z } from "zod";
import {
  WCAG22_ANCHORS,
  WCAG_BY_ID,
  type EvaluationScope,
  type ReportMeta,
  type ScanSummary,
  type WcagOutcome,
} from "@a11ychk/core";
import { createClient } from "@/lib/supabase/server";
import { apiError, resolveApiLocale } from "@/lib/apiError";

/**
 * WCAG-EM JSON export — 두 형식 제공:
 * - 기본(1.0 호환): W3C WCAG-EM Report Tool(https://www.w3.org/WAI/eval/report-tool/)의
 *   "Open evaluation"으로 불러와 이어서 편집할 수 있도록, 도구의 EvaluationModel 스키마
 *   (w3c/wai-wcag-em-report-tool src/stores/evaluationStore.js)를 그대로 따른다.
 *   도구가 아직 WCAG-EM 1.0 포맷 기준이라 호환을 위해 유지한다.
 * - ?version=2: @context를 WCAG-EM 2.0(https://www.w3.org/TR/wcag-em-2/) 절 앵커로
 *   매핑한 자체 정의 형식. 2.0에는 공식 기계가독 포맷이 아직 없어(Step 5.5는 형식을
 *   규정하지 않음) 1.0 도구 스키마 구조를 유지한 채 참조 명세만 2.0으로 바꾼 것이다.
 *   (2.0 문서의 절 앵커는 1.0과 동일한 문자 체계 — #step1a = Step 1.1)
 */
const IdSchema = z.string().uuid();

/** 도구 export와 동일한 @context (w3c/wai-wcag-em-report-tool appContext.js) */
const EVALUATION_CONTEXT = {
  reporter: "http://github.com/w3c/wai-wcag-em-report-tool/",
  wcagem: "http://www.w3.org/TR/WCAG-EM/#",
  Evaluation: "wcagem:procedure",
  defineScope: "wcagem:step1",
  scope: "wcagem:step1a",
  step1b: { "@id": "wcagem:step1b", "@type": "@id" },
  conformanceTarget: "step1b",
  accessibilitySupportBaseline: "wcagem:step1c",
  additionalEvaluationRequirements: "wcagem:step1d",
  exploreTarget: "wcagem:step2",
  essentialFunctionality: "wcagem:step2b",
  pageTypeVariety: "wcagem:step2c",
  technologiesReliedUpon: "wcagem:step2d",
  selectSample: "wcagem:step3",
  structuredSample: "wcagem:step3a",
  randomSample: "wcagem:step3b",
  Website: "wcagem:website",
  Webpage: "wcagem:webpage",
  auditSample: "wcagem:step4",
  reportFindings: "wcagem:step5",
  documentSteps: "wcagem:step5a",
  commissioner: "wcagem:commissioner",
  evaluator: "wcagem:evaluator",
  evaluationSpecifics: "wcagem:step5b",
  WCAG: "http://www.w3.org/TR/WCAG/#",
  WCAG20: "http://www.w3.org/TR/WCAG20/#",
  WCAG21: "http://www.w3.org/TR/WCAG21/#",
  WCAG22: "http://www.w3.org/TR/WCAG22/#",
  WAI: "http://www.w3.org/WAI/",
  A: "WAI:WCAG2A-Conformance",
  AA: "WAI:WCAG2AA-Conformance",
  AAA: "WAI:WCAG2AAA-Conformance",
  wcagVersion: "WAI:standards-guidelines/wcag/#versions",
  reportToolVersion: "wcagem:reportToolVersion",
  earl: "http://www.w3.org/ns/earl#",
  Assertion: "earl:Assertion",
  TestMode: "earl:TestMode",
  TestCriterion: "earl:TestCriterion",
  TestCase: "earl:TestCase",
  TestRequirement: "earl:TestRequirement",
  TestSubject: "earl:TestSubject",
  TestResult: "earl:TestResult",
  OutcomeValue: "earl:OutcomeValue",
  Pass: "earl:Pass",
  Fail: "earl:Fail",
  CannotTell: "earl:CannotTell",
  NotApplicable: "earl:NotApplicable",
  NotTested: "earl:NotTested",
  assertedBy: "earl:assertedBy",
  mode: "earl:mode",
  result: "earl:result",
  subject: "earl:subject",
  test: "earl:test",
  outcome: "earl:outcome",
  dcterms: "http://purl.org/dc/terms/",
  title: "dcterms:title",
  description: "dcterms:description",
  summary: "dcterms:summary",
  date: "dcterms:date",
  hasPart: "dcterms:hasPart",
  isPartOf: "dcterms:isPartOf",
  id: "@id",
  type: "@type",
  language: "@language",
};

/**
 * WCAG-EM 2.0 기준 @context — 기반 명세 URL만 2.0으로 바꾸고(절 앵커 체계는 1.0과 동일),
 * 2.0에서 신설된 절(2.1 공통 뷰 #step2a, 2.5 관련 표본 #step2e, 3.3 완전한 프로세스 #step3c)을
 * 추가 등재한다. reporter는 자체 export임을 명시.
 */
const EVALUATION_CONTEXT_V2 = {
  ...EVALUATION_CONTEXT,
  reporter: "https://github.com/IsaacEryn/a11ychk",
  wcagem: "https://www.w3.org/TR/wcag-em-2/#",
  commonViews: "wcagem:step2a",
  otherRelevantSamples: "wcagem:step2e",
  completeProcesses: "wcagem:step3c",
};

const OUTCOME_MAP: Record<WcagOutcome, { id: string; type: string }> = {
  passed: { id: "earl:passed", type: "Pass" },
  failed: { id: "earl:failed", type: "Fail" },
  cannotTell: { id: "earl:cantTell", type: "CannotTell" },
  notPresent: { id: "earl:inapplicable", type: "NotApplicable" },
  notChecked: { id: "earl:untested", type: "NotTested" },
};

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // ?version=2 → WCAG-EM 2.0 참조 형식, 기본 → 1.0 호환(W3C Report Tool 가져오기용)
  const isV2 = new URL(req.url).searchParams.get("version") === "2";
  // ?lang= 우선, 없으면 Accept-Language 협상 — 에러·문서 prose·@language 공통
  const lang = resolveApiLocale(req);
  const L = (ko: string, en: string) => (lang === "en" ? en : ko);
  if (!IdSchema.safeParse(id).success) {
    return apiError(lang, "invalidRequest", 400);
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return apiError(lang, "loginRequired", 401);

  const { data: scan } = await supabase.from("scans").select("*").eq("id", id).maybeSingle();
  if (!scan || scan.status !== "done" || !scan.summary) {
    return apiError(lang, "reportNotReady", 404);
  }

  const summary = scan.summary as ScanSummary;
  const scope = (scan.scope ?? null) as EvaluationScope | null;
  const meta = (scan.report_meta ?? null) as ReportMeta | null;

  const [{ data: pages }, { data: reviews }] = await Promise.all([
    supabase.from("scan_pages").select("*").eq("scan_id", id).order("url"),
    supabase.from("scan_reviews").select("standard, item_id, outcome, note").eq("scan_id", id),
  ]);
  const wcagReviews = new Map<string, { outcome: WcagOutcome; note: string }>();
  for (const r of reviews ?? []) {
    if (r.standard === "wcag") wcagReviews.set(r.item_id, { outcome: r.outcome as WcagOutcome, note: r.note });
  }

  const hostname = new URL(scan.root_url).hostname;
  const siteTitle = meta?.siteName || hostname;

  // 표본 페이지 → TestSubject(Webpage). 첫 subject는 website 자체.
  const websiteSubject = {
    "@id": "_:website",
    type: ["TestSubject", "Website"],
    date: scan.created_at,
    title: siteTitle,
    description: scan.root_url,
  };
  const webpageSubjects = (pages ?? []).map((p, i) => ({
    "@id": `_:webpage_${i}`,
    type: ["TestSubject", "Webpage"],
    date: p.scanned_at ?? scan.created_at,
    title: p.url,
    description: p.url,
    isPartOf: "_:website",
    "reporter:tested": p.status === "done",
  }));
  const structuredSample = webpageSubjects.filter((_s, i) => (pages?.[i]?.sample_type ?? "structured") !== "random");
  const randomSample = webpageSubjects.filter((_s, i) => pages?.[i]?.sample_type === "random");

  // SC별 assertion (사이트 단위). 점검자 판정이 있으면 manual, 없으면 automatic(자동 결과).
  const auditSample = summary.wcagMatrix.map((row) => {
    const c = WCAG_BY_ID.get(row.scId);
    const review = wcagReviews.get(row.scId);
    const effective: WcagOutcome = review?.outcome ?? row.outcome;
    const outcome = OUTCOME_MAP[effective];
    const descriptionParts: string[] = [];
    if (review?.note) descriptionParts.push(review.note);
    if (row.violationCount > 0) {
      descriptionParts.push(
        L(
          `자동 검사 위반 ${row.violationCount}건 (axe 규칙: ${row.ruleIds.join(", ")})`,
          `${row.violationCount} automated-check violation(s) (axe rules: ${row.ruleIds.join(", ")})`,
        ),
      );
    }
    return {
      "@type": "Assertion",
      date: scan.finished_at ?? scan.created_at,
      mode: review ? "earl:manual" : "earl:automatic",
      subject: { "@id": "_:website" },
      result: {
        "@type": "TestResult",
        date: scan.finished_at ?? scan.created_at,
        outcome: { "@id": outcome.id, type: ["OutcomeValue", outcome.type], title: effective },
        description: descriptionParts.join("\n"),
      },
      test: {
        "@type": ["TestCriterion", "TestRequirement"],
        "@id": `WCAG22:${WCAG22_ANCHORS[row.scId] ?? row.scId}`,
        num: row.scId,
        conformanceLevel: c?.level ?? "A",
      },
      assertedBy: { "@id": "_:evaluator" },
    };
  });

  const evaluation = {
    "@context": isV2 ? EVALUATION_CONTEXT_V2 : EVALUATION_CONTEXT,
    "@type": "Evaluation",
    "@language": lang,
    reportToolVersion: isV2 ? "a11ychk-export-2.0" : "a11ychk-export-1.0",
    defineScope: {
      "@id": "_:defineScope",
      scope: { title: siteTitle, description: scan.root_url },
      wcagVersion: "2.2",
      conformanceTarget: scope?.conformanceTarget ?? "AA",
      accessibilitySupportBaseline: (scope?.accessibilitySupportBaseline ?? []).join("; "),
      additionalEvaluationRequirements: scope?.notes ?? "",
    },
    exploreTarget: {
      "@id": "_:exploreTarget",
      technologiesReliedUpon: summary.sample?.technologies ?? [],
      essentialFunctionality: "",
      pageTypeVariety: "",
    },
    selectSample: {
      "@id": "_:selectSample",
      structuredSample: [websiteSubject, ...structuredSample],
      randomSample,
    },
    auditSample,
    reportFindings: {
      documentSteps: [
        { "@id": "_:about" },
        { "@id": "_:defineScope" },
        { "@id": "_:exploreTarget" },
        { "@id": "_:selectSample" },
      ],
      commissioner: meta?.organization ?? "",
      date: scan.finished_at ?? scan.created_at,
      evaluator: meta?.evaluatorName ?? "A11y Check (a11ychk.com)",
      evaluationSpecifics: `${L("자동 검사 엔진", "Automated engine")}: ${summary.engine.name} ${summary.engine.axeVersion} · ${summary.sample?.method ?? ""}`,
      summary: meta?.executiveSummary ?? "",
      title:
        meta?.title ||
        L(`${siteTitle} 웹 접근성 평가 보고서`, `${siteTitle} Web Accessibility Evaluation Report`),
    },
  };

  return NextResponse.json(evaluation, {
    headers: {
      "Content-Disposition": `attachment; filename="a11ychk-wcag-em${isV2 ? "2" : ""}-${hostname}.json"`,
      "Cache-Control": "no-store",
    },
  });
}
