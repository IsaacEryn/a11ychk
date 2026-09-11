import { NextResponse } from "next/server";
import { z } from "zod";
import { WCAG_BY_ID, type EvaluationScope, type ScanSummary, type WcagOutcome } from "@a11ychk/core";
import { createClient } from "@/lib/supabase/server";
import { logReportExport } from "@/lib/apiAuth";
import { apiError, resolveApiLocale } from "@/lib/apiError";
import { loadWcagReviews } from "@/lib/exportReviews";

/**
 * WCAG-EM 2.0 Step 5.5 — 기계 판독 가능 보고서 (EARL 정렬 JSON).
 * 소유자(또는 관리자)만 접근. SC별 결과를 EARL 어휘로 제공한다.
 * 점검자 판정이 있는 SC는 그 판정이 자동 결과를 대체한다(mode=earl:manual) — Report Tool
 * 내보내기와 같은 규칙(lib/exportReviews)이라 두 형식이 같은 검사에서 다른 결론을 내지 않는다.
 * 대체된 자동 결과는 automatedOutcome으로 함께 남겨 추적 가능하게 한다.
 */
const IdSchema = z.string().uuid();

const EARL_OUTCOME: Record<WcagOutcome, string> = {
  passed: "earl:passed",
  failed: "earl:failed",
  cannotTell: "earl:cantTell",
  notChecked: "earl:untested",
  notPresent: "earl:inapplicable",
};

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // ?lang= 우선, 없으면 Accept-Language 협상 — 에러·문서 prose 언어 공통
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

  // RLS로 소유자/관리자만 조회됨
  const { data: scan } = await supabase
    .from("scans")
    .select("id, user_id, root_url, status, summary, scope, finished_at, created_at")
    .eq("id", id)
    .maybeSingle();
  if (!scan || scan.status !== "done" || !scan.summary) {
    return apiError(lang, "reportNotReady", 404);
  }
  const [, wcagReviews] = await Promise.all([logReportExport(user.id, scan, "earl"), loadWcagReviews(supabase, id)]);

  const summary = scan.summary as ScanSummary;
  const scope = (scan.scope ?? null) as EvaluationScope | null;
  const reviewed = summary.wcagMatrix.filter((row) => wcagReviews.has(row.scId)).length;

  const earl = {
    "@context": "https://www.w3.org/ns/earl",
    "@type": "earl:Software",
    assertedBy: { "@type": "earl:Assertor", name: "A11y Check", homepage: "https://a11ychk.com" },
    subject: {
      "@type": "earl:TestSubject",
      url: scan.root_url,
      scope: scope ?? { conformanceTarget: "AA" },
    },
    evaluation: {
      standard: "WCAG 2.2",
      methodology: reviewed > 0 ? "WCAG-EM 2.0 (automated + reviewer assertions)" : "WCAG-EM 2.0 (automated portion)",
      date: scan.finished_at ?? scan.created_at,
      engine: `${summary.engine.name} ${summary.engine.axeVersion}`,
      conformanceTarget: scope?.conformanceTarget ?? "AA",
      sample: summary.sample ?? null,
      reviewedCriteria: reviewed,
      note:
        reviewed > 0
          ? L(
              `자동 평가 결과에 점검자 판정 ${reviewed}건을 반영했습니다. 점검자 판정이 있는 성공기준은 그 판정이 자동 결과를 대체하며(mode=earl:manual), 대체된 자동 결과는 automatedOutcome에 남겼습니다. 판정이 없는 성공기준은 자동 평가 범위에 한정됩니다.`,
              `Reviewer assertions for ${reviewed} criteria are merged: where a reviewer outcome exists it replaces the automated one (mode=earl:manual) and the replaced automated outcome is kept as automatedOutcome. Criteria without a reviewer outcome are limited to the automatable portion.`,
            )
          : L(
              "이 결과는 자동 평가로 산출된 WCAG-EM의 자동화 가능 부분입니다. 완전한 적합성 판정에는 전문가의 수동 평가가 필요합니다.",
              "This output covers the automatable portion of WCAG-EM produced by automated evaluation. Full conformance judgment requires expert manual evaluation.",
            ),
    },
    assertions: summary.wcagMatrix.map((row) => {
      const c = WCAG_BY_ID.get(row.scId);
      const review = wcagReviews.get(row.scId);
      const effective: WcagOutcome = review?.outcome ?? row.outcome;
      return {
        "@type": "earl:Assertion",
        mode: review ? "earl:manual" : "earl:automatic",
        test: { sc: row.scId, name: c?.name.en ?? row.scId, level: c?.level },
        result: {
          "@type": "earl:TestResult",
          outcome: EARL_OUTCOME[effective],
          ...(review ? { automatedOutcome: EARL_OUTCOME[row.outcome], description: review.note || undefined } : {}),
          violationCount: row.violationCount,
          rules: row.ruleIds,
        },
      };
    }),
  };

  return NextResponse.json(earl, {
    headers: {
      "Content-Disposition": `inline; filename="a11ychk-earl-${new URL(scan.root_url).hostname}.json"`,
      "Cache-Control": "no-store",
    },
  });
}
